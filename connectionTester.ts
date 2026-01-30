import { OCRProvider, OCRConfig } from "../types";
import { testCloudOcrConnection } from "./cloudOcrService";

export interface TestResult {
  success: boolean;
  message: string;
  details?: string;
}

/**
 * 测试OCR连接 - 统一通过云函数测试
 */
export const testOcrConnection = async (config: OCRConfig): Promise<TestResult> => {
  const { provider } = config;

  // 1. 本地OCR测试
  if (provider === OCRProvider.LOCAL || provider === OCRProvider.ESEARCH) {
    try {
      // 检查是否在浏览器环境
      if (typeof window === 'undefined') {
        return { 
          success: false, 
          message: "本地OCR只能在浏览器环境中使用。" 
        };
      }
      
      // 尝试加载Tesseract.js来测试
      const Tesseract = await import('https://esm.sh/tesseract.js@5.1.1');
      
      return { 
        success: true, 
        message: `${provider === OCRProvider.LOCAL ? '本地离线' : 'eSearch 内置'} OCR 模式：WASM 引擎就绪，隐私安全。注意：首次使用需要加载WASM文件，可能需要较长时间。` 
      };
    } catch (error) {
      return { 
        success: false, 
        message: "本地OCR测试失败，可能由于WASM加载问题或浏览器兼容性问题。" 
      };
    }
  }

  // 2. 云函数OCR测试
  if ([OCRProvider.BAIDU, OCRProvider.ALIBABA, OCRProvider.WECHAT, OCRProvider.GEMINI].includes(provider)) {
    return await testCloudOcrConnection(provider);
  }

  return { 
    success: false, 
    message: `未知的服务商: ${provider}` 
  };
};