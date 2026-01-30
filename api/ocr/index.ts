import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

// OCR厂商类型
type OcrProvider = 'baidu' | 'aliyun' | 'wechat' | 'gemini';

interface OcrRequest {
  provider: OcrProvider;
  imageBase64: string;
  language?: string;
  options?: Record<string, any>;
}

// 从环境变量获取API密钥
const getApiKeys = () => {
  return {
    baidu: {
      apiKey: process.env.BAIDU_OCR_API_KEY,
      secretKey: process.env.BAIDU_OCR_SECRET_KEY,
    },
    aliyun: {
      accessKeyId: process.env.ALIYUN_OCR_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_OCR_ACCESS_KEY_SECRET,
    },
    wechat: {
      appId: process.env.WECHAT_OCR_APP_ID,
      appSecret: process.env.WECHAT_OCR_APP_SECRET,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
    },
  };
};

// 获取百度OCR的Access Token
async function getBaiduAccessToken(apiKey: string, secretKey: string): Promise<string> {
  const response = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { method: 'POST' }
  );
  
  const data = await response.json() as any;
  if (data.error) {
    throw new Error(`百度OCR认证失败: ${data.error_description}`);
  }
  
  return data.access_token;
}

// 调用百度OCR
async function callBaiduOcr(imageBase64: string, language: string = 'CHN_ENG') {
  const keys = getApiKeys().baidu;
  if (!keys.apiKey || !keys.secretKey) {
    throw new Error('百度OCR API密钥未配置');
  }
  
  const accessToken = await getBaiduAccessToken(keys.apiKey, keys.secretKey);
  
  const response = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `image=${encodeURIComponent(imageBase64)}&language_type=${language}`,
    }
  );
  
  const data = await response.json() as any;
  
  if (data.error_code) {
    throw new Error(`百度OCR识别失败: ${data.error_msg}`);
  }
  
  // 提取文本
  const text = data.words_result?.map((item: any) => item.words).join('\n') || '';
  
  return {
    text,
    provider: 'baidu',
    rawResult: data,
  };
}

// 调用阿里云OCR（需要签名，这里简化实现）
async function callAliyunOcr(imageBase64: string) {
  const keys = getApiKeys().aliyun;
  if (!keys.accessKeyId || !keys.accessKeySecret) {
    throw new Error('阿里云OCR API密钥未配置');
  }
  
  // 阿里云OCR需要复杂的签名，这里使用简单示例
  // 实际生产环境需要实现完整的签名算法
  const response = await fetch(
    'https://ocr.cn-shanghai.aliyuncs.com',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.accessKeyId}:${keys.accessKeySecret}`,
      },
      body: JSON.stringify({
        ImageBase64: imageBase64,
        Scene: 'general',
      }),
    }
  );
  
  const data = await response.json() as any;
  
  if (data.Code !== '200') {
    throw new Error(`阿里云OCR识别失败: ${data.Message}`);
  }
  
  const text = data.Data?.Content || '';
  
  return {
    text,
    provider: 'aliyun',
    rawResult: data,
  };
}

// 调用微信OCR
async function callWechatOcr(imageBase64: string) {
  const keys = getApiKeys().wechat;
  if (!keys.appId || !keys.appSecret) {
    throw new Error('微信OCR API密钥未配置');
  }
  
  // 先获取Access Token
  const tokenResponse = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${keys.appId}&secret=${keys.appSecret}`
  );
  
  const tokenData = await tokenResponse.json() as any;
  
  if (tokenData.errcode) {
    throw new Error(`微信OCR认证失败: ${tokenData.errmsg}`);
  }
  
  const accessToken = tokenData.access_token;
  
  // 调用OCR接口
  const ocrResponse = await fetch(
    `https://api.weixin.qq.com/cv/ocr/comm?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        img: imageBase64,
        scene: 'general',
      }),
    }
  );
  
  const ocrData = await ocrResponse.json() as any;
  
  if (ocrData.errcode) {
    throw new Error(`微信OCR识别失败: ${ocrData.errmsg}`);
  }
  
  const text = ocrData.items?.map((item: any) => item.text).join('\n') || '';
  
  return {
    text,
    provider: 'wechat',
    rawResult: ocrData,
  };
}

// 调用Gemini多模态识别
async function callGeminiOcr(imageBase64: string, prompt?: string) {
  const keys = getApiKeys().gemini;
  if (!keys.apiKey) {
    throw new Error('Gemini API密钥未配置');
  }
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keys.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: imageBase64,
                },
              },
              {
                text: prompt || '请提取图片中的所有文字，按原始格式输出。',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      }),
    }
  );
  
  const data = await response.json() as any;
  
  if (data.error) {
    throw new Error(`Gemini识别失败: ${data.error.message}`);
  }
  
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  return {
    text,
    provider: 'gemini',
    rawResult: data,
  };
}

// 主处理函数
export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // 设置CORS头部
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  // 处理OPTIONS请求
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }
  
  // 只允许POST请求
  if (request.method !== 'POST') {
    return response.status(405).json({
      success: false,
      error: '只支持POST请求',
    });
  }
  
  try {
    const body = request.body as OcrRequest;
    
    if (!body || !body.provider || !body.imageBase64) {
      return response.status(400).json({
        success: false,
        error: '缺少必要参数: provider 和 imageBase64',
      });
    }
    
    // 检查图片大小（限制5MB）
    if (body.imageBase64.length > 7 * 1024 * 1024) { // Base64编码后大约增加33%
      return response.status(400).json({
        success: false,
        error: '图片过大，请压缩后重试（限制5MB）',
      });
    }
    
    let result;
    
    // 根据提供商调用不同的OCR服务
    switch (body.provider) {
      case 'baidu':
        result = await callBaiduOcr(body.imageBase64, body.language);
        break;
      case 'aliyun':
        result = await callAliyunOcr(body.imageBase64);
        break;
      case 'wechat':
        result = await callWechatOcr(body.imageBase64);
        break;
      case 'gemini':
        result = await callGeminiOcr(body.imageBase64, body.options?.prompt);
        break;
      default:
        return response.status(400).json({
          success: false,
          error: `不支持的OCR提供商: ${body.provider}`,
        });
    }
    
    // 成功响应
    return response.status(200).json({
      success: true,
      data: result,
    });
    
  } catch (error: any) {
    console.error('OCR处理错误:', error);
    
    // 错误响应
    return response.status(500).json({
      success: false,
      error: error.message || 'OCR处理失败',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}