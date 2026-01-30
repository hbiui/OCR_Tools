
export enum OCRProvider {
  GEMINI = 'GEMINI',
  BAIDU = 'BAIDU',
  WECHAT = 'WECHAT',
  ALIBABA = 'ALIBABA',
  LOCAL = 'LOCAL',
  ESEARCH = 'ESEARCH'
}

export enum LLMProvider {
  GEMINI = 'GEMINI',
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  DOUBAO = 'DOUBAO',
  QWEN = 'QWEN',
  DEEPSEEK = 'DEEPSEEK'
}

export interface OCRConfig {
  provider: OCRProvider;
  apiKey?: string;
  secretKey?: string;
  appId?: string;
  language?: string; // 用于本地 OCR 的语言配置，如 'eng', 'chi_sim', 'eng+chi_sim'
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  modelName?: string;
}

export interface SecurityTerm {
  term: string;
  category: string;
  definition: string;
  preferredAlternative?: string;
}

export interface DetectionResult {
  originalText: string;
  errors: {
    text: string;
    type: 'spelling' | 'grammar' | 'terminology' | 'style';
    suggestion: string;
    alternatives: string[];
    explanation: string;
    location?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in normalized coordinates [0, 1000]
  }[];
  isProfessional: boolean;
  score: number;
}

export interface ProcessedImage {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  currentStep?: string; // 新增：用于展示更详细的进度（如：OCR处理中、AI分析中、结果生成中）
  result?: DetectionResult;
  rawOcrText?: string;
  selected?: boolean; // 新增：用于批量导出的选择状态
  ocrProvider?: OCRProvider; // 新增：记录分析该图片时使用的 OCR 厂商
  isLowRes?: boolean; // 新增：分辨率不足标识
}