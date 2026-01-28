
import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult, SecurityTerm } from "../types";

/**
 * 分析海报图片。结合用户选择的 OCR 技术与自定义词库进行深度分析。
 * 此函数作为系统的“分析大脑”，负责将视觉信息或文本流与行业标准及用户自定义标准进行对齐。
 */
export const analyzePosterImage = async (
  base64Image: string,
  terminology: SecurityTerm[],
  preExtractedText?: string
): Promise<{ text: string; analysis: DetectionResult }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // 构建增强版提示词，强调自定义词库的“金标准”地位，并请求定位信息
  // 即使提供了预提取文本，也要求模型必须观察图像以执行精准的视觉定位
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
         - 坐标系为 0-1000 归一化（0,0 是左上角，1000,1000 是右下角）。
         - 必须确保定位框能够准确且紧凑地包裹住图片中该错误文本对应的视觉区域。
    
    4. **结果输出**：
       - 解释说明 (explanation) 请务必使用中文。
       - 综合评分：基于术语准确度、语言专业度和设计排版逻辑。

    ${preExtractedText ? `【预识别文本参考】：\n"""\n${preExtractedText}\n"""\n(请注意：预识别文本可能存在识别误差，请以图像中的实际像素内容为准进行最终裁定和定位)` : ''}
  `;

  // 关键修复：无论是否有预提取文本，都必须发送图片（inlineData），否则模型无法生成准确的视觉坐标
  const contents = {
    parts: [
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      { text: prompt }
    ]
  };

  // 使用 gemini-3-pro-preview 提升复杂逻辑、术语比对及视觉 GROUNDING 的成功率
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "最终提取出的完整海报文本内容" },
          analysis: {
            type: Type.OBJECT,
            properties: {
              originalText: { type: Type.STRING },
              isProfessional: { type: Type.BOOLEAN },
              score: { type: Type.NUMBER, description: "专业性评分 (0-100)" },
              errors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "发现问题的原始短语或单词" },
                    type: { type: Type.STRING, enum: ["spelling", "grammar", "terminology", "style"] },
                    suggestion: { type: Type.STRING, description: "建议的更正方案" },
                    alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, description: "其他可能的表达方式" },
                    explanation: { type: Type.STRING, description: "修正理由（需包含词库引用说明，中文）" },
                    location: {
                      type: Type.ARRAY,
                      items: { type: Type.NUMBER },
                      description: "[ymin, xmin, ymax, xmax] 归一化坐标"
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
  
  const parsed = JSON.parse(resultText);
  if (preExtractedText && !parsed.text) {
    parsed.text = preExtractedText;
  }
  
  return parsed;
};

/**
 * AI 智能提取术语。帮助设计师快速从各种文档中扩充公司词库。
 */
export const parseTerminologyFromText = async (rawText: string): Promise<SecurityTerm[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    你是一个安防行业标准委员会专家。请从以下非结构化文本中，精准提取并整理出具有行业价值的专业术语。
    
    原始文本：
    """
    ${rawText}
    """
    
    提取原则：
    1. 聚焦硬件规格 (NVR, PTZ)、智能算法 (Deep Learning, SMD)、接口标准 (PoE, ONVIF) 等。
    2. 如果文本中有推荐的写法或行业通用缩写，请放入 preferredAlternative。
    3. 分类必须清晰（如：存储、视觉感知、传输协议）。
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
