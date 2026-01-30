import type { VercelRequest, VercelResponse } from '@vercel/node';

interface TestRequest {
  provider: 'baidu' | 'aliyun' | 'wechat' | 'gemini';
  apiKey?: string;
  secretKey?: string;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // 设置CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }
  
  if (request.method !== 'POST') {
    return response.status(405).json({
      success: false,
      error: '只支持POST请求',
    });
  }
  
  try {
    const body = request.body as TestRequest;
    
    if (!body || !body.provider) {
      return response.status(400).json({
        success: false,
        error: '缺少提供商参数',
      });
    }
    
    // 检查环境变量是否配置
    const envVars = {
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
    
    const providerVars = envVars[body.provider];
    let allConfigured = true;
    let missingFields: string[] = [];
    
    // 检查所有必需的字段
    Object.entries(providerVars).forEach(([key, value]) => {
      if (!value) {
        allConfigured = false;
        missingFields.push(key);
      }
    });
    
    if (!allConfigured) {
      return response.status(400).json({
        success: false,
        error: `${body.provider} OCR 环境变量未配置完整`,
        missingFields,
        message: `请在Vercel环境变量中配置: ${missingFields.join(', ')}`,
      });
    }
    
    // 简单测试：尝试获取百度Access Token或直接返回成功
    if (body.provider === 'baidu') {
      const testUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${providerVars.apiKey}&client_secret=${providerVars.secretKey}`;
      
      const testResponse = await fetch(testUrl, { method: 'POST' });
      const data = await testResponse.json() as any;
      
      if (data.error) {
        return response.json({
          success: false,
          error: `百度OCR认证失败: ${data.error_description}`,
        });
      }
      
      return response.json({
        success: true,
        message: '百度OCR连接测试成功',
        expiresIn: data.expires_in,
      });
    }
    
    // 其他厂商的测试可以类似实现
    
    return response.json({
      success: true,
      message: `${body.provider} OCR 配置验证通过`,
      configured: true,
    });
    
  } catch (error: any) {
    console.error('测试连接错误:', error);
    
    return response.status(500).json({
      success: false,
      error: error.message || '连接测试失败',
    });
  }
}