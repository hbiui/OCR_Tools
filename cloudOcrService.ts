import { OCRProvider } from './types';

export interface CloudOcrResult {
  text: string;
  provider: string;
  rawResult?: any;
}

export interface CloudOcrError {
  success: false;
  error: string;
  details?: string;
}

/**
 * 通过云函数调用OCR服务
 */
export const performCloudOcr = async (
  provider: OCRProvider,
  imageBase64: string,
  language?: string,
  options?: Record<string, any>
): Promise<CloudOcrResult> => {
  // 映射提供商名称到云函数识别的名称
  const providerMap: Record<OCRProvider, string> = {
    [OCRProvider.GEMINI]: 'gemini',
    [OCRProvider.BAIDU]: 'baidu',
    [OCRProvider.WECHAT]: 'wechat',
    [OCRProvider.ALIBABA]: 'aliyun',
    [OCRProvider.LOCAL]: 'local',
    [OCRProvider.ESEARCH]: 'local',
  };
  
  const cloudProvider = providerMap[provider];
  
  // 如果是本地OCR，直接调用本地服务
  if (provider === OCRProvider.LOCAL || provider === OCRProvider.ESEARCH) {
    // 这里可以调用原来的本地OCR服务
    throw new Error('本地OCR请直接调用本地服务，无需通过云函数');
  }
  
  try {
    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: cloudProvider,
        imageBase64,
        language,
        options,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'OCR请求失败');
    }
    
    return {
      text: data.data.text,
      provider: data.data.provider,
      rawResult: data.data.rawResult,
    };
    
  } catch (error: any) {
    console.error('云函数OCR调用失败:', error);
    
    // 提供更友好的错误信息
    if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      throw new Error('网络连接失败，请检查网络后重试');
    }
    
    throw new Error(`OCR识别失败: ${error.message}`);
  }
};

/**
 * 测试云函数连接
 */
export const testCloudOcrConnection = async (
  provider: OCRProvider
): Promise<{ success: boolean; message: string }> => {
  const providerMap: Record<OCRProvider, string> = {
    [OCRProvider.GEMINI]: 'gemini',
    [OCRProvider.BAIDU]: 'baidu',
    [OCRProvider.WECHAT]: 'wechat',
    [OCRProvider.ALIBABA]: 'aliyun',
    [OCRProvider.LOCAL]: 'local',
    [OCRProvider.ESEARCH]: 'local',
  };
  
  const cloudProvider = providerMap[provider];
  
  if (provider === OCRProvider.LOCAL || provider === OCRProvider.ESEARCH) {
    return {
      success: true,
      message: '本地OCR无需云函数连接测试',
    };
  }
  
  try {
    const response = await fetch('/api/ocr/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: cloudProvider,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        message: data.error || '连接测试失败',
      };
    }
    
    return data;
    
  } catch (error: any) {
    console.error('云函数连接测试失败:', error);
    
    return {
      success: false,
      message: `连接测试失败: ${error.message || '网络错误'}`,
    };
  }
};