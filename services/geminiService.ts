
import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult, SecurityTerm } from "../types";

/**
 * 分析海报图片。结合用户选择的 OCR 技术与自定义词库进行深度分析。
 */
export const analyzePosterImage = async (
  base64Image: string,
  terminology: SecurityTerm[],
  preExtractedText?: string
): Promise<{ text: string; analysis: DetectionResult }> => {
  // 按照准则，在每次调用前初始化实例
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    角色：资深安防行业外贸设计师及国际化技术翻译专家。
    背景：我们是一家领先的安防外贸公司，正在进行 2026 年度旗舰产品的全球海报校对工作。
    
    任务：
    1. **内容分析**：请结合提供的图片内容${preExtractedText ? '以及下方给出的【预识别文本参考】' : ''}进行高精度分析。
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

    ${preExtractedText ? `【预识别文本参考】：\n"""\n${preExtractedText}\nmultiline\n"""\n` : ''}
  `;

  const contents = {
    parts: [
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      { text: prompt }
    ]
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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
};

/**
 * 分析纯文本内容（无图片）。支持安防文案纠错、改写与术语对齐。
 */
export const analyzeSecurityText = async (
  inputText: string,
  terminology: SecurityTerm[]
): Promise<DetectionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
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

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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
};

/**
 * AI 智能提取术语。
 */
export const parseTerminologyFromText = async (rawText: string): Promise<SecurityTerm[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    你是一个安防行业标准委员会专家。请从以下文本中提取专业术语：
    ${rawText}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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
};
