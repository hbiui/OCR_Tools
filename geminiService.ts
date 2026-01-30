import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult, SecurityTerm } from "../types";
import { performCloudOcr, CloudOcrResult } from "./cloudOcrService";
import { performLocalOcr } from "./tesseractService";
import { OCRProvider } from "../types";

// 统一的API Key获取函数
const getGeminiApiKey = (): string => {
  // 云函数模式下，Gemini API Key应该在云函数中配置
  // 前端只需要知道是否使用Gemini作为分析引擎
  if (typeof window !== 'undefined') {
    const config = (window as any).__GUARDVISION_CONFIG__;
    if (config?.geminiApiKey) {
      return config.geminiApiKey;
    }
  }
  
  // 前端也可以配置自己的Gemini Key用于直接调用（可选）
  return import.meta.env.VITE_GEMINI_API_KEY || '';
};

/**
 * 根据配置选择合适的OCR方式
 */
const performOcr = async (
  provider: OCRProvider,
  base64Data: string,
  language?: string
): Promise<string> => {
  if (provider === OCRProvider.LOCAL || provider === OCRProvider.ESEARCH) {
    // 本地OCR
    return await performLocalOcr(base64Data, language);
  } else {
    // 云函数OCR
    const result = await performCloudOcr(provider, base64Data, language);
    return result.text;
  }
};

/**
 * 分析海报图片。结合用户选择的 OCR 技术与自定义词库进行深度分析。
 */
export const analyzePosterImage = async (
  base64Image: string,
  terminology: SecurityTerm[],
  preExtractedText?: string,
  ocrProvider?: OCRProvider
): Promise<{ text: string; analysis: DetectionResult }> => {
  // 如果没有提供预提取文本，且指定了OCR提供商，则先进行OCR
  let ocrText = preExtractedText;
  
  if (!ocrText && ocrProvider && ocrProvider !== OCRProvider.GEMINI) {
    try {
      ocrText = await performOcr(ocrProvider, base64Image, 'CHN_ENG');
    } catch (ocrError: any) {
      console.error('OCR提取失败，尝试直接使用Gemini分析:', ocrError);
      // OCR失败时，仍然尝试使用Gemini直接分析
    }
  }
  
  // 使用Gemini进行分析
  const apiKey = getGeminiApiKey();
  
  if (!apiKey) {
    throw new Error("Gemini API Key 未配置。请在OCR配置中设置Gemini API Key。");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    角色：资深安防行业外贸设计师及国际化技术翻译专家。
    背景：我们是一家领先的安防外贸公司，正在进行 2026 年度旗舰产品的全球海报校对工作。
    
    任务：
    1. **内容分析**：请结合提供的图片内容${ocrText ? '以及下方给出的【预识别文本参考】' : ''}进行高精度分析。
    2. **强制性词库比对 (核心任务)**：
       你必须检查文本中涉及的所有技术术语是否符合下方的【公司标准词库】。
       - 如果文本中出现了词库中的 "term"，但词库建议了 "preferredAlternative" (优选词)，必须将其标记为 'terminology' 类型错误，并给出该优选词。
       - 如果文本中出现了与词库定义相同但表达不规范的非专业词汇，必须根据词库定义进行纠正。
       - 标准词库数据：${JSON.stringify(terminology)}
    
    3. **全方位质量分析与定位**：
       - **拼写与语法**：检查国际安防买家关注的拼写错误。
       - **技术参数表现**：确保参数表达（如 4K, 30fps, IP67, IK10）符合行业规范。
       - **品牌语调**：评估其是否具备高端、安全、可靠的安防品牌感觉。
       - **视觉定位 (极重要)**：对于每个发现的问题，必须在提供的原始图片中找到其所在的像素坐标。
         - 使用 [ymin, xmin, ymax, xmax] 格式。
         - 坐标系为 0-1000 归一化。
    
    4. **结果输出**：使用中文进行解释。

    ${ocrText ? `【预识别文本参考】：\n"""\n${ocrText}\nmultiline\n"""\n` : ''}
  `;

  const contents = {
    parts: [
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      { text: prompt }
    ]
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents,
      config: {
        thinkingConfig: { thinkingBudget: 16000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "提取出的完整海报文本内容" },
            analysis: {
              type: Type.OBJECT,
              properties: {
                originalText: { type: Type.STRING },
                isProfessional: { type: Type.BOOLEAN },
                score: { type: Type.NUMBER },
                errors: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      type: { type: Type.STRING, enum: ["spelling", "grammar", "terminology", "style"] },
                      suggestion: { type: Type.STRING },
                      alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
                      explanation: { type: Type.STRING },
                      location: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                        description: "[ymin, xmin, ymax, xmax]"
                      }
                    },
                    required: ["text", "type", "suggestion", "alternatives", "explanation", "location"]
                  }
                }
              },
              required: ["originalText", "isProfessional", "score", "errors"]
            }
          },
          required: ["text", "analysis"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Analysis engine returned empty response.");
    }
    
    return JSON.parse(resultText);
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    
    // 提供更友好的错误信息
    if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('authentication')) {
      throw new Error("Gemini API Key 无效或已过期。请在配置中检查并更新。");
    } else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error("API 调用次数超限或配额不足。请稍后重试或检查API配额。");
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      throw new Error("网络连接失败，请检查网络后重试。");
    } else {
      throw new Error(`分析失败: ${error.message || '未知错误'}`);
    }
  }
};

/**
 * 分析纯文本内容（无图片）。支持安防文案纠错、改写与术语对齐。
 */
export const analyzeSecurityText = async (
  inputText: string,
  terminology: SecurityTerm[]
): Promise<DetectionResult> => {
  const apiKey = getGeminiApiKey();
  
  if (!apiKey) {
    throw new Error("Gemini API Key 未配置。");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    角色：资深安防行业技术翻译官与品牌文案专家。
    任务：分析下方的安防产品文案。
    
    要求：
    1. **术语合规性**：对比下方提供的【标准词库】，纠正任何非标表达。
    2. **语法与改写**：提升文案的专业度，使其符合 2026 年国际安防展会的高端语调。
    3. **输出格式**：返回详细的纠错清单，由于没有图片，location 字段请统一返回 [0, 0, 0, 0]。
    
    标准词库数据：${JSON.stringify(terminology)}
    待分析文案：
    """
    ${inputText}
    """
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 12000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            originalText: { type: Type.STRING },
            isProfessional: { type: Type.BOOLEAN },
            score: { type: Type.NUMBER },
            errors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["spelling", "grammar", "terminology", "style"] },
                  suggestion: { type: Type.STRING },
                  alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
                  explanation: { type: Type.STRING },
                  location: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                },
                required: ["text", "type", "suggestion", "alternatives", "explanation", "location"]
              }
            }
          },
          required: ["originalText", "isProfessional", "score", "errors"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Text analysis engine returned empty response.");
    }
    
    return JSON.parse(resultText);
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(`文本分析失败: ${error.message || '未知错误'}`);
  }
};

/**
 * AI 智能提取术语。
 */
export const parseTerminologyFromText = async (rawText: string): Promise<SecurityTerm[]> => {
  const apiKey = getGeminiApiKey();
  
  if (!apiKey) {
    throw new Error("Gemini API Key 未配置。");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    你是一个安防行业标准委员会专家。请从以下文本中提取专业术语：
    ${rawText}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              category: { type: Type.STRING },
              definition: { type: Type.STRING },
              preferredAlternative: { type: Type.STRING }
            },
            required: ["term", "category", "definition"]
          }
        }
      }
    });

    const resultText = response.text;
    if (!resultText) return [];
    return JSON.parse(resultText);
  } catch (error) {
    console.error("Failed to parse terminology:", error);
    return [];
  }
};