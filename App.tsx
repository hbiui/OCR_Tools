
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { OCRProvider, LLMProvider, OCRConfig, LLMConfig, SecurityTerm, ProcessedImage } from './types';
import { INITIAL_TERMINOLOGY, OCR_PROVIDER_INFO, LLM_PROVIDER_INFO } from './constants';
import { analyzePosterImage, analyzeSecurityText } from './services/geminiService';
import { performLocalOcr, terminateLocalOcr } from './services/tesseractService';
import { testOcrConnection, TestResult } from './services/connectionTester';
import Button from './components/Button';
import TerminologyManager from './components/TerminologyManager';

const SCAN_MESSAGES = [
  "正在初始化 eSearch 核心视觉神经...",
  "深度探测图片文本图层...",
  "匹配 2026 行业标准库...",
  "逻辑建模与拼写上下文校验...",
  "评估 brand 溢价与表达专业度...",
  "生成多维度诊断分析结果..."
];

const App: React.FC = () => {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [terminology, setTerminology] = useState<SecurityTerm[]>(INITIAL_TERMINOLOGY);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'image' | 'text'>('image');
  const [textInput, setTextInput] = useState('');
  
  const [config, setConfig] = useState<OCRConfig>({ 
    provider: OCRProvider.GEMINI,
    language: 'eng+chi_sim'
  });
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: LLMProvider.GEMINI
  });

  const [providerKeys, setProviderKeys] = useState<Record<string, {apiKey?: string, secretKey?: string}>>({});
  const [llmProviderKeys, setLlmProviderKeys] = useState<Record<string, {apiKey?: string, modelName?: string}>>({});
  
  const [showConfig, setShowConfig] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState<'ocr' | 'llm'>('ocr');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [scanMessageIndex, setScanMessageIndex] = useState(0);
  const [hoveredErrorIndex, setHoveredErrorIndex] = useState<number | null>(null);
  const [isLightMode, setIsLightMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const [zoomLevel, setZoomLevel] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const stopProcessingRef = useRef(false);

  useEffect(() => {
    let interval: number | undefined;
    if (isProcessing) {
      interval = window.setInterval(() => {
        setScanMessageIndex(prev => (prev + 1) % SCAN_MESSAGES.length);
      }, 2200);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessing]);

  useEffect(() => {
    if (isLightMode) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [isLightMode]);

  useEffect(() => {
    setZoomLevel(1);
    setOffset({ x: 0, y: 0 });
    setIsPanning(false);
  }, [currentIndex]);

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      // 只有在图片模式下才拦截滚轮缩放，文本模式保留正常滚动
      if (currentIndex !== null && images[currentIndex]?.file) {
        e.preventDefault();
        const scaleStep = 1.1;
        const direction = e.deltaY < 0 ? 1 : -1;
        
        setZoomLevel(prev => {
          const next = direction > 0 ? prev * scaleStep : prev / scaleStep;
          return Math.min(5, Math.max(0.1, next));
        });
      }
    };

    container.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => container.removeEventListener('wheel', handleWheelNative);
  }, [currentIndex, images]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (currentIndex !== null && !images[currentIndex]?.file)) return; 
    setIsPanning(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleImageLoad = (id: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const isLow = img.naturalWidth < 500 || img.naturalHeight < 500;
    if (isLow) {
      setImages(prev => prev.map(item => item.id === id ? { ...item, isLowRes: true } : item));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    addFiles(files);
  };

  const addFiles = (files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/'));
    const newImages: ProcessedImage[] = validFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 11),
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
      selected: true
    }));
    const updatedImages = [...images, ...newImages];
    setImages(updatedImages);
    if (currentIndex === null && newImages.length > 0) {
        setCurrentIndex(images.length);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isProcessing) return;
    const files = Array.from(e.dataTransfer.files) as File[];
    addFiles(files);
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setImages(prev => prev.map(img => img.id === id ? { ...img, selected: !img.selected } : img));
  };

  const toggleSelectAll = () => {
    const allSelectedNow = images.length > 0 && images.every(img => img.selected);
    setImages(prev => prev.map(img => ({ ...img, selected: !allSelectedNow })));
  };

  const removeImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    const indexToRemove = images.findIndex(img => img.id === id);
    if (indexToRemove === -1) return;

    const newImagesList = images.filter(img => img.id !== id);
    setImages(newImagesList);

    if (currentIndex === indexToRemove) {
      setCurrentIndex(null);
    } else if (currentIndex !== null && currentIndex > indexToRemove) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const clearAll = () => {
    if (confirm("确定要清除所有已分析的内容吗？")) {
      setImages([]);
      setCurrentIndex(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const stopBatch = () => {
    stopProcessingRef.current = true;
    setIsStopping(true);
    terminateLocalOcr();
  };

  const retryImage = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setImages(prev => prev.map(img => img.id === id ? { ...img, status: 'pending', currentStep: undefined, result: undefined } : img));
  };

  const retryAllErrors = () => {
    setImages(prev => prev.map(img => img.status === 'error' ? { ...img, status: 'pending', currentStep: undefined, result: undefined } : img));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result?.toString().split(',')[1] || '');
      reader.onerror = reject;
    });
  };

  const analyzeWithRetry = async (base64Data: string, terms: SecurityTerm[], ocrText?: string, maxRetries = 3) => {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (stopProcessingRef.current) return null;
        return await analyzePosterImage(base64Data, terms, ocrText);
      } catch (err) {
        lastError = err;
        console.warn(`分析尝试 ${attempt + 1} 失败，正在重试...`, err);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1))); 
        }
      }
    }
    throw lastError;
  };

  const processBatch = async () => {
    if (isProcessing) {
      stopBatch();
      return;
    }

    setIsProcessing(true);
    setIsStopping(false);
    stopProcessingRef.current = false;

    try {
      for (let i = 0; i < images.length; i++) {
        if (stopProcessingRef.current) break;
        if (images[i].status !== 'pending') continue;

        const processingId = images[i].id;
        const currentProviderAtStart = config.provider;
        setImages(prev => prev.map(img => img.id === processingId ? { ...img, status: 'processing', currentStep: '图像加载中' } : img));
        
        try {
          // 纯文本分析逻辑
          if (!images[i].file && images[i].rawOcrText) {
            setImages(prev => prev.map(img => img.id === processingId ? { ...img, currentStep: 'AI 文本分析中' } : img));
            const result = await analyzeSecurityText(images[i].rawOcrText!, terminology);
            setImages(prev => prev.map(img => img.id === processingId ? { 
              ...img, 
              status: 'completed', 
              currentStep: undefined,
              result: result, 
              rawOcrText: result.originalText,
              ocrProvider: OCRProvider.GEMINI 
            } : img));
            continue;
          }

          const base64Data = await fileToBase64(images[i].file);
          
          if (stopProcessingRef.current) {
            setImages(prev => prev.map(img => img.id === processingId ? { ...img, status: 'pending', currentStep: undefined } : img));
            break;
          }

          let ocrText: string | undefined = undefined;
          
          // OCR 提取阶段：严禁回退 Gemini，失败即显式报错
          if (currentProviderAtStart !== OCRProvider.GEMINI) {
            setImages(prev => prev.map(img => img.id === processingId ? { ...img, currentStep: 'OCR 提取中' } : img));
            
            const info = OCR_PROVIDER_INFO[currentProviderAtStart as keyof typeof OCR_PROVIDER_INFO];
            
            if (currentProviderAtStart === OCRProvider.LOCAL || currentProviderAtStart === OCRProvider.ESEARCH) {
              // 离线 OCR：直接运行 WASM 引擎，不校验 API Key
              try {
                ocrText = await performLocalOcr(base64Data, config.language);
              } catch (e: any) {
                throw new Error(`${info.name} 初始化失败: ${e.message || 'WASM 加载超时'}`);
              }
            } else {
              // 在线 OCR 厂商校验
              if (info.keyLabel && !config.apiKey) {
                throw new Error(`请先填写 ${info.name} 的 API Key`);
              }
              if (info.secretLabel && !config.secretKey) {
                throw new Error(`请先填写 ${info.name} 的 Secret Key`);
              }
              // 由于浏览器前端跨域限制，暂无法直连
              throw new Error(`${info.name} 直连受 CORS 限制，建议切换至内置 eSearch 离线引擎。`);
            }

            if (!ocrText || ocrText.trim() === "") {
              throw new Error(`${info.name} 未在图片中识别到文本，任务已终止。`);
            }
          }

          if (stopProcessingRef.current) {
            setImages(prev => prev.map(img => img.id === processingId ? { ...img, status: 'pending', currentStep: undefined } : img));
            break;
          }

          // AI 诊断阶段：使用 OCR 结果进行深度纠错
          setImages(prev => prev.map(img => img.id === processingId ? { ...img, currentStep: 'AI 深度诊断中...' } : img));
          
          try {
            const result = await analyzeWithRetry(base64Data, terminology, ocrText);
            
            if (stopProcessingRef.current || !result) {
              setImages(prev => prev.map(img => img.id === processingId ? { ...img, status: 'pending', currentStep: undefined } : img));
              if (stopProcessingRef.current) break;
              continue;
            }

            setImages(prev => prev.map(img => img.id === processingId ? { 
                ...img, 
                status: 'completed', 
                currentStep: undefined,
                result: result.analysis, 
                rawOcrText: result.text,
                ocrProvider: currentProviderAtStart 
            } : img));
          } catch (geminiError: any) {
            // 特殊处理：如果 OCR 已经拿到文本，但 AI 阶段因为 Key 报错
            const isApiKeyError = geminiError.message?.includes('API key') || geminiError.status === 'INVALID_ARGUMENT';
            if (ocrText && currentProviderAtStart !== OCRProvider.GEMINI) {
              console.warn("AI 诊断阶段失败，降级显示原始 OCR 结果:", geminiError);
              setImages(prev => prev.map(img => img.id === processingId ? { 
                ...img, 
                status: 'completed', 
                currentStep: isApiKeyError ? 'OCR 成功，但 AI 诊断所需 Key 无效' : 'OCR 成功，AI 诊断引擎暂不可用', 
                rawOcrText: ocrText,
                ocrProvider: currentProviderAtStart,
                result: {
                  originalText: ocrText,
                  errors: [],
                  isProfessional: true,
                  score: 100
                }
              } : img));
              continue;
            }
            throw geminiError;
          }

        } catch (error: any) {
          console.error("处理流程中断:", error);
          setImages(prev => prev.map(img => img.id === processingId ? { 
            ...img, 
            status: 'error', 
            currentStep: error.message || '分析失败' 
          } : img));
        }
      }
    } finally {
      await terminateLocalOcr();
      setIsProcessing(false);
      setIsStopping(false);
      stopProcessingRef.current = false;
    }
  };

  const handleProcessTextInput = async () => {
    if (!textInput.trim() || isProcessing) return;
    
    const newEntry: ProcessedImage = {
      id: Math.random().toString(36).substring(2, 11),
      file: null as any, 
      preview: "",
      status: 'pending',
      rawOcrText: textInput,
      selected: true
    };

    const updatedImages = [...images, newEntry];
    setImages(updatedImages);
    setCurrentIndex(images.length);
    setTextInput('');
    
    setTimeout(() => {
      processBatch();
    }, 100);
  };

  // 计算文本高亮渲染
  const renderHighlightedText = useMemo(() => {
    if (currentIndex === null || !images[currentIndex]) return null;
    const currentItem = images[currentIndex];
    const text = currentItem.rawOcrText || "";
    const errors = currentItem.result?.errors || [];

    if (errors.length === 0) return <span>{text}</span>;

    let fragments: (string | React.ReactNode)[] = [text];

    errors.forEach((error, errorIdx) => {
      const newFragments: (string | React.ReactNode)[] = [];
      fragments.forEach((fragment) => {
        if (typeof fragment !== 'string') {
          newFragments.push(fragment);
          return;
        }

        const parts = fragment.split(new RegExp(`(${error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'g'));
        parts.forEach((part) => {
          if (part === error.text) {
            const isHovered = hoveredErrorIndex === errorIdx;
            const typeColors = {
              spelling: 'bg-amber-400/20 border-amber-400/50 text-amber-500',
              grammar: 'bg-cyan-400/20 border-cyan-400/50 text-cyan-500',
              terminology: 'bg-indigo-400/20 border-indigo-400/50 text-indigo-500',
              style: 'bg-slate-400/20 border-slate-400/50 text-slate-500'
            };
            const activeColors = {
              spelling: 'bg-amber-400 text-white shadow-[0_0_15px_rgba(251,191,36,0.6)]',
              grammar: 'bg-cyan-400 text-white shadow-[0_0_15px_rgba(34,211,238,0.6)]',
              terminology: 'bg-indigo-400 text-white shadow-[0_0_15px_rgba(129,140,248,0.6)]',
              style: 'bg-slate-400 text-white shadow-[0_0_15px_rgba(148,163,184,0.6)]'
            };

            newFragments.push(
              <span 
                key={`${errorIdx}-${Math.random()}`}
                className={`px-1 rounded-md border transition-all duration-300 cursor-help ${
                  isHovered ? activeColors[error.type] : typeColors[error.type]
                }`}
                onMouseEnter={() => setHoveredErrorIndex(errorIdx)}
                onMouseLeave={() => setHoveredErrorIndex(null)}
              >
                {part}
              </span>
            );
          } else if (part !== "") {
            newFragments.push(part);
          }
        });
      });
      fragments = newFragments;
    });

    return fragments;
  }, [currentIndex, images, hoveredErrorIndex]);

  const generateReportContent = (image: ProcessedImage): string => {
    if (!image.result) return "";
    const errorList = image.result.errors.length === 0 
      ? " - 无明显语言或术语错误。" 
      : image.result.errors.map((err, idx) => `${idx + 1}. [${err.type.toUpperCase()}] "${err.text}"\n   建议更正: "${err.suggestion}"\n   解释: ${err.explanation}`).join('\n\n');

    return `
------------------------------------------------------------
[ 分析项: ${image.file?.name || '纯文本分析'} ]
------------------------------------------------------------
状态: ${image.result.isProfessional ? '推荐发布 (PASSED)' : '建议优化 (REVIEW)'}
发现问题数: ${image.result.errors.length}
使用的 OCR 引擎: ${image.ocrProvider ? (OCR_PROVIDER_INFO[image.ocrProvider as keyof typeof OCR_PROVIDER_INFO]?.name || image.ocrProvider) : '原生文本/AI'}
原始文本内容:
${image.rawOcrText || '无文本'}

详细问题清单:
${errorList}
`;
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportResult = (image: ProcessedImage, e?: React.MouseEvent) => {
    if (e) e.stopPropagation(); 
    if (!image.result) return;
    const report = `GuardVision AI 安防文案分析报告\n生成日期: ${new Date().toLocaleString()}\n` + generateReportContent(image);
    downloadFile(report, `分析报告_${image.file?.name || '文本'}_${Date.now()}.txt`);
  };

  const batchExport = () => {
    const selectedCompleted = images.filter(img => img.status === 'completed' && img.selected);
    if (selectedCompleted.length === 0) {
      alert("请至少选择一张已完成分析的项目进行导出。");
      return;
    }

    let report = `GuardVision AI 批量分析报告\n生成日期: ${new Date().toLocaleString()}\n\n`;
    selectedCompleted.forEach(img => {
      report += generateReportContent(img);
      report += `\n============================================================\n`;
    });

    downloadFile(report, `批量分析报告_${new Date().toISOString().split('T')[0]}.txt`);
  };

  const currentProviderInfo = OCR_PROVIDER_INFO[config.provider as keyof typeof OCR_PROVIDER_INFO];
  const currentLlmProviderInfo = LLM_PROVIDER_INFO[llmConfig.provider as keyof typeof LLM_PROVIDER_INFO];
  const completedSelectedCount = images.filter(img => img.status === 'completed' && img.selected).length;
  const hasErrors = images.some(img => img.status === 'error');
  const allSelected = images.length > 0 && images.every(img => img.selected);

  const getCountColor = (count: number) => {
    if (count === 0) return 'text-emerald-400';
    if (count <= 3) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getCountBgColor = (count: number) => {
    if (count === 0) return 'bg-emerald-500/10 border-emerald-500/20';
    if (count <= 3) return 'bg-amber-500/10 border-amber-500/20';
    return 'bg-rose-500/10 border-rose-500/20';
  };

  return (
    <div className="min-h-screen">
      <nav className="glass-panel sticky top-4 mx-4 md:mx-8 z-[100] px-8 py-5 flex justify-between items-center rounded-3xl border-white/10 mt-4 transition-all">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 bg-gradient-to-tr from-indigo-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-[0_10px_30px_rgba(79,70,229,0.4)] rotate-3">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04m18.502 0a12.07 12.07 0 011.907 5.027c.282 1.638.446 3.322.446 5.048 0 8.797-7.335 15.933-16 15.933s-16-7.136-16-15.933c0-1.726.164-3.41.446-5.048a12.07 12.07 0 011.907-5.027m18.502 0a11.952 11.952 0 00-4.597-2.722M11.3 18.29l-1.26 1.26a1 1.01a1 1 0 01-1.42 0l-3.37-3.37a1 1 0 010-1.42l1.26-1.26M15 7h.01" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tighter text-white">
              GUARD<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 italic">VISION</span>
            </h1>
            <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] block mt-1">AI安防海报校对系统</span>
          </div>

          <button 
            onClick={() => setIsLightMode(!isLightMode)}
            className="ml-4 p-2.5 rounded-xl bg-slate-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 transition-all flex items-center justify-center group"
            title={isLightMode ? "切换至暗色模式" : "切换至亮色模式"}
          >
            {isLightMode ? (
              <svg className="w-5 h-5 group-hover:rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 group-hover:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex gap-4">
          <Button variant="secondary" onClick={() => setShowConfig(true)} disabled={isProcessing}>API 配置</Button>
          <Button 
            variant={isProcessing ? "danger" : "primary"} 
            onClick={processBatch} 
            disabled={images.length === 0 || isStopping}
            loading={isStopping}
          >
            {isProcessing ? (
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    <span>{isStopping ? "正在停止..." : "停止全域分析"}</span>
                </div>
            ) : "启动全域分析"}
          </Button>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-8 py-10 grid grid-cols-12 gap-x-8 gap-y-10 items-stretch">
        <div className="col-span-12 lg:col-span-4 space-y-8 flex flex-col">
          
          {/* 模式切换器 */}
          <div className="glass-panel p-1.5 rounded-2xl flex border border-white/10 shadow-lg">
             <button 
                onClick={() => setActiveSidebarTab('image')}
                className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'image' ? 'bg-indigo-500 text-white shadow-[0_5px_15px_rgba(79,70,229,0.4)]' : 'text-slate-500 hover:text-indigo-400 hover:bg-white/5'}`}
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                图片上传
             </button>
             <button 
                onClick={() => setActiveSidebarTab('text')}
                className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'text' ? 'bg-indigo-500 text-white shadow-[0_5px_15px_rgba(79,70,229,0.4)]' : 'text-slate-500 hover:text-indigo-400 hover:bg-white/5'}`}
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                文本分析
             </button>
          </div>

          {activeSidebarTab === 'image' ? (
            <div 
              className={`glass-panel rounded-[2rem] p-10 border-2 border-dashed transition-all duration-300 cursor-pointer group flex flex-col items-center justify-center text-center ${
                isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-indigo-500/10 hover:border-indigo-500/40 hover:bg-indigo-500/5'
              } ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} accept="image/*" />
              <div className="w-24 h-24 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500 shadow-inner">
                <svg className="w-12 h-12 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <h3 className="text-xl font-extrabold text-white mb-2">{isDragging ? '放置图片以添加' : '上传海报图片'}</h3>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">支持多维度批量导入，AI 自动识别安防语义</p>
            </div>
          ) : (
            <div className="glass-panel rounded-[2rem] p-8 space-y-6 flex flex-col border border-white/5 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-500">
               <div>
                  <h3 className="text-xl font-extrabold text-white mb-2">输入安防文案</h3>
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">直接粘贴海报文案或产品参数，AI 将针对行业词库进行深度纠错与改写推荐。</p>
               </div>
               <textarea 
                  className="w-full h-48 bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-sm text-white font-medium transition-all shadow-inner placeholder:text-slate-700 resize-none"
                  placeholder="例如: 4K Bullet IP Camera with Starlight technology and IP67 waterproof..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={isProcessing}
               />
               <Button 
                  variant="primary" 
                  className="w-full rounded-2xl py-4"
                  onClick={handleProcessTextInput}
                  disabled={!textInput.trim() || isProcessing}
                  loading={isProcessing && textInput.length > 0}
               >
                  立即分析文案
               </Button>
            </div>
          )}

          <div className="glass-panel rounded-[2rem] p-6 min-h-[400px] flex-1 flex flex-col relative overflow-hidden">
            <div className="flex flex-col gap-4 mb-6 px-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div 
                    onClick={!isProcessing ? toggleSelectAll : undefined}
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isProcessing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${allSelected ? 'bg-indigo-500 border-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.5)]' : 'border-slate-700'}`}
                  >
                    {allSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-slate-500">处理队列 ({images.length})</h3>
                </div>
                <div className="flex items-center gap-3">
                  {images.length > 0 && (
                    <>
                      {hasErrors && (
                        <button 
                            onClick={!isProcessing ? retryAllErrors : undefined}
                            disabled={isProcessing}
                            className={`text-[10px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors flex items-center gap-1.5 border-r border-white/10 pr-3 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title="重试所有失败项"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            重试失败
                        </button>
                      )}
                      <button 
                        onClick={batchExport}
                        disabled={completedSelectedCount === 0}
                        className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors pl-3 ${completedSelectedCount > 0 ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-600 cursor-not-allowed'}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        导出
                      </button>
                      <button 
                        onClick={!isProcessing ? clearAll : undefined}
                        disabled={isProcessing}
                        className={`text-[10px] font-black uppercase tracking-widest text-rose-500/60 hover:text-rose-400 transition-colors flex items-center gap-1.5 border-l border-white/10 pl-3 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        清空
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {images.map((img, idx) => {
                const errorCount = img.result?.errors.length || 0;
                return (
                  <div 
                    key={img.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`flex items-center gap-3 p-4 rounded-3xl cursor-pointer border-2 transition-all duration-500 group relative ${
                      currentIndex === idx ? 'bg-indigo-500/15 border-indigo-500/50 shadow-2xl scale-[1.02]' : 'bg-slate-900/30 border-transparent hover:border-white/10'
                    }`}
                  >
                    <div 
                      onClick={!isProcessing ? (e) => toggleSelect(img.id, e) : undefined}
                      className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isProcessing ? 'cursor-not-allowed opacity-50' : ''} ${img.selected ? 'bg-indigo-500 border-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.3)]' : 'border-slate-700'}`}
                    >
                      {img.selected && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                    </div>

                    <div className="relative shrink-0 w-14 h-14 rounded-2xl overflow-hidden shadow-lg ml-1 bg-indigo-500/10 flex items-center justify-center">
                      {img.file ? (
                        <img src={img.preview} alt="poster" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                      ) : (
                        <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      )}
                      {img.status === 'processing' && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-bold truncate text-white">{img.file?.name || '文案分析项目'}</p>
                        {img.isLowRes && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="分辨率较低" />}
                      </div>
                      <div className="flex items-center gap-2">
                         <span className={`w-1.5 h-1.5 rounded-full ${
                           img.status === 'completed' ? 'bg-emerald-400' : 
                           img.status === 'processing' ? 'bg-amber-400 animate-pulse' : 
                           img.status === 'error' ? 'bg-rose-500' : 'bg-slate-600'
                         }`} />
                         <span className="text-[9px] font-black uppercase tracking-tighter text-slate-500">
                           {img.status === 'pending' ? '就绪' : 
                            img.status === 'processing' ? (img.currentStep || '分析中') : 
                            img.status === 'completed' ? '成功' : (img.currentStep || '失败')}
                         </span>
                      </div>
                    </div>
                    
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {img.status === 'error' && !isProcessing && (
                        <button 
                            onClick={(e) => retryImage(img.id, e)}
                            className="p-1.5 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500 hover:text-white transition-all"
                            title="重新分析"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                      )}
                      {img.status === 'completed' && (
                        <button 
                          onClick={(e) => exportResult(img, e)}
                          className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500 hover:text-white transition-all"
                          title="导出报告"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                      )}
                      {!isProcessing && (
                        <button 
                          onClick={(e) => removeImage(img.id, e)}
                          className="p-1.5 bg-rose-500/20 text-rose-400 rounded-lg hover:bg-rose-500 hover:text-white transition-all"
                          title="移除此项"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {img.status === 'completed' && currentIndex !== idx && (
                      <div className={`w-8 h-8 rounded-lg flex flex-col items-center justify-center border shrink-0 ${
                        errorCount === 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/40 text-rose-400'
                      }`}>
                        <span className={`text-[10px] font-black leading-none ${errorCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{errorCount}</span>
                        <span className={`text-[5px] font-black uppercase tracking-tighter mt-0.5 ${errorCount === 0 ? 'text-emerald-500/50' : 'text-rose-500/50'}`}>ISSUES</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {images.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 opacity-20 grayscale">
                  <svg className="w-16 h-16 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  <span className="text-[10px] font-black tracking-widest uppercase">队列为空</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={`col-span-12 lg:col-span-8 flex flex-col ${currentIndex === null ? 'h-full' : 'h-auto'}`}>
          {currentIndex !== null && images[currentIndex] ? (
            <div className="animate-in fade-in slide-in-from-bottom-6 duration-1000 space-y-10 flex-1">
              <div className="glass-panel rounded-[3rem] overflow-hidden grid grid-cols-1 xl:grid-cols-2 min-h-[600px] border-white/5">
                <div 
                  ref={imageContainerRef}
                  className="bg-slate-950/80 flex items-center justify-center p-8 md:p-12 relative group border-r border-white/5 overflow-hidden"
                >
                  
                  {/* 缩放控制栏 - 仅在图片模式显示 */}
                  {images[currentIndex].file && (
                    <div className="absolute top-6 right-6 z-[40] flex items-center bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl transition-all opacity-0 group-hover:opacity-100">
                      <button 
                        onClick={() => setZoomLevel(prev => Math.max(0.1, prev - 0.2))}
                        className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                        title="缩小"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 12H4" /></svg>
                      </button>
                      <div className="px-3 min-w-[60px] text-center">
                        <span className="text-[10px] font-black text-indigo-400 tracking-tighter">{Math.round(zoomLevel * 100)}%</span>
                      </div>
                      <button 
                        onClick={() => setZoomLevel(prev => Math.min(5, prev + 0.2))}
                        className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                        title="放大"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1"></div>
                      <button 
                        onClick={() => { setZoomLevel(1); setOffset({ x: 0, y: 0 }); }}
                        className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-xl transition-all"
                        title="适应窗口"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
                      </button>
                    </div>
                  )}

                  {images[currentIndex].isLowRes && (
                    <div className="absolute top-6 left-6 z-[40] flex items-center gap-2 bg-amber-500/10 backdrop-blur-md border border-amber-500/40 rounded-xl px-4 py-2 animate-in slide-in-from-left-4 duration-500 shadow-lg">
                      <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_10px_#f59e0b]"></div>
                      <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">分辨率较低 (可能影响识别)</span>
                    </div>
                  )}

                  <div 
                    className={`relative z-10 mx-auto shadow-[0_40px_80px_rgba(0,0,0,0.6)] select-none ${images[currentIndex].file ? 'inline-block' : 'flex flex-col items-center justify-center overflow-y-auto custom-scrollbar p-10 bg-slate-900/40 rounded-[2rem] border border-white/5 w-full h-full max-w-full max-h-full'}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    style={{ 
                      transform: images[currentIndex].file ? `translate(${offset.x}px, ${offset.y}px) scale(${zoomLevel})` : 'none',
                      transformOrigin: 'center center',
                      transition: isPanning ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      cursor: images[currentIndex].file ? (isPanning ? 'grabbing' : zoomLevel > 1 ? 'grab' : 'default') : 'default'
                    }}
                  >
                    {images[currentIndex].file ? (
                      <>
                        <img 
                          src={images[currentIndex].preview} 
                          alt="Current preview"
                          draggable={false}
                          onLoad={(e) => handleImageLoad(images[currentIndex].id, e)}
                          className="max-h-[550px] w-auto h-auto block rounded-2xl pointer-events-none" 
                        />
                        
                        {images[currentIndex].status === 'completed' && images[currentIndex].result?.errors.map((error, idx) => {
                          if (!error.location || (error.location[0] === 0 && error.location[1] === 0 && error.location[2] === 0 && error.location[3] === 0)) return null;
                          const [ymin, xmin, ymax, xmax] = error.location;
                          return (
                            <div 
                              key={`highlight-${idx}`}
                              className={`absolute border-2 rounded-md transition-all duration-300 pointer-events-none ${
                                hoveredErrorIndex === idx 
                                  ? 'border-indigo-400 bg-indigo-400/20 shadow-[0_0_20px_rgba(129,140,248,0.8)] z-30 scale-105 opacity-100' 
                                  : 'border-rose-500/40 bg-rose-500/5 z-20 opacity-80'
                              }`}
                              style={{
                                top: `${ymin / 10}%`,
                                left: `${xmin / 10}%`,
                                width: `${(xmax - xmin) / 10}%`,
                                height: `${(ymax - ymin) / 10}%`,
                              }}
                            >
                              {hoveredErrorIndex === idx && (
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[10px] px-2 py-1 rounded font-black whitespace-nowrap shadow-xl z-[100]">
                                  发现风险点: {error.text}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="w-full text-lg leading-relaxed text-indigo-50 font-medium whitespace-pre-wrap text-left break-words">
                        {renderHighlightedText}
                      </div>
                    )}
                  </div>

                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.1),transparent_70%)] pointer-events-none"></div>
                  {images[currentIndex].status === 'processing' && <div className="scanning-line"></div>}
                </div>
                
                <div className="p-12 space-y-10 overflow-y-auto max-h-[700px] bg-slate-900/10 custom-scrollbar">
                  {images[currentIndex].status === 'completed' ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="space-y-4">
                          <h2 className="text-4xl font-black text-white tracking-tight">诊断报告</h2>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-black text-white px-3 py-1 rounded-full uppercase shadow-lg ${images[currentIndex].result?.isProfessional ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                              {images[currentIndex].result?.isProfessional ? '推荐发布' : '建议修改'}
                            </span>
                            <span className="text-[9px] font-black text-slate-500 bg-slate-500/10 px-2.5 py-1 rounded-lg border border-white/5 uppercase tracking-[0.2em] flex items-center gap-1.5">
                              <span className="w-1 h-1 bg-indigo-500 rounded-full animate-pulse"></span>
                              引擎: {images[currentIndex].file ? (OCR_PROVIDER_INFO[images[currentIndex].ocrProvider as keyof typeof OCR_PROVIDER_INFO]?.name || '默认') : '原生文本分析'}
                            </span>
                          </div>
                        </div>

                        <div className={`relative w-28 h-28 flex flex-col items-center justify-center rounded-3xl border-2 shadow-2xl transition-all duration-500 ${getCountBgColor(images[currentIndex].result?.errors.length || 0)}`}>
                            <span className={`text-5xl font-black tracking-tighter ${getCountColor(images[currentIndex].result?.errors.length || 0)}`}>
                              {images[currentIndex].result?.errors.length}
                            </span>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest -mt-1">项风险点</span>
                        </div>
                      </div>

                      <div className="space-y-8">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.4em]">多维分析诊断清单</h4>
                          <span className="text-[10px] font-bold text-slate-600">已深度扫描</span>
                        </div>

                        {images[currentIndex].result?.errors.length === 0 ? (
                          <div className="p-12 bg-emerald-500/5 rounded-[2.5rem] border border-emerald-500/20 text-emerald-400 text-center space-y-6">
                            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto shadow-inner">
                              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <div>
                                <p className="font-black text-2xl mb-2">完全符合安防标准</p>
                                <p className="text-sm opacity-60 leading-relaxed max-w-xs mx-auto">此海报或文案展示了极高的专业水准，所有表达均符合国际出口技术规范。</p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {images[currentIndex].result?.errors.map((error, idx) => (
                              <details 
                                key={`error-detail-${idx}`} 
                                open={idx === 0}
                                onMouseEnter={() => setHoveredErrorIndex(idx)}
                                onMouseLeave={() => setHoveredErrorIndex(null)}
                                className="glass-panel rounded-3xl border-white/5 hover:border-indigo-500/30 transition-all duration-300 group/card shadow-xl overflow-hidden cursor-pointer"
                              >
                                <summary className="flex items-center justify-between p-6 list-none select-none">
                                  <div className="flex items-center gap-4">
                                    <span className={`w-2 h-2 rounded-full ${
                                      error.type === 'spelling' ? 'bg-amber-400' : 
                                      error.type === 'grammar' ? 'bg-cyan-400' : 
                                      error.type === 'terminology' ? 'bg-indigo-400' : 'bg-slate-400'
                                    }`}></span>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-black uppercase text-slate-400 tracking-wider">
                                        {error.type === 'spelling' ? '拼写修正' : error.type === 'grammar' ? '语法精炼' : error.type === 'terminology' ? '术语对齐' : '风格优化'}
                                      </span>
                                      <span className="text-base font-bold text-white group-hover/card:text-indigo-300 transition-colors">{error.text}</span>
                                    </div>
                                  </div>
                                  <svg className="w-5 h-5 text-slate-700 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                </summary>
                                <div className="p-6 pt-0 space-y-6">
                                  <div className="flex items-start gap-4 bg-emerald-500/10 p-5 rounded-2xl border border-emerald-500/20 shadow-inner">
                                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                                      <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-xs font-black uppercase text-emerald-500/50 mb-1 tracking-widest">推荐表达方案</p>
                                      <p className="text-xl font-black text-emerald-400 leading-tight">{error.suggestion}</p>
                                    </div>
                                  </div>
                                  <div className="text-sm text-slate-400 leading-relaxed pl-4 border-l-2 border-slate-800 font-medium italic">
                                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2 tracking-widest">分析依据</p>
                                    {error.explanation}
                                  </div>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pt-10 flex gap-6">
                         <Button variant="outline" size="lg" className="flex-1 rounded-3xl" onClick={() => exportResult(images[currentIndex])}>
                           生成完整分析报告
                         </Button>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-12 py-16">
                      {images[currentIndex].status === 'processing' ? (
                        <>
                          <div className="relative w-40 h-40">
                             <div className="absolute inset-0 border-[8px] border-indigo-500/10 rounded-full"></div>
                             <div className="absolute inset-0 border-[8px] border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                             <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-12 h-12 text-indigo-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                             </div>
                          </div>
                          <div className="space-y-6 max-w-sm">
                            <h3 className="text-3xl font-black text-white tracking-tighter">AI 神经元深度检索</h3>
                            <p className="text-slate-500 font-black text-[11px] uppercase tracking-[0.3em] animate-pulse">
                               {SCAN_MESSAGES[scanMessageIndex]}
                            </p>
                          </div>
                        </>
                      ) : images[currentIndex].status === 'error' ? (
                        <>
                          <div className="relative w-40 h-40">
                             <div className="absolute inset-0 border-[8px] border-rose-500/10 rounded-full"></div>
                             <div className="absolute inset-0 border-[8px] border-rose-500/30 border-t-rose-500 rounded-full"></div>
                             <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-12 h-12 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                             </div>
                          </div>
                          <div className="space-y-6 max-w-sm">
                            <h3 className="text-3xl font-black text-white tracking-tighter">分析任务中断</h3>
                            <p className="text-rose-400 font-bold text-sm bg-rose-500/10 px-4 py-2 rounded-xl border border-rose-500/20">
                               {images[currentIndex].currentStep || '未知错误，请检查网络或配置'}
                            </p>
                            <Button 
                              variant="danger" 
                              className="w-full rounded-2xl py-4 shadow-[0_10px_30px_rgba(244,63,94,0.4)]" 
                              onClick={() => retryImage(images[currentIndex].id)}
                            >
                               立即重试分析
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-10 opacity-30 grayscale">
                          <svg className="w-24 h-24 mx-auto text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <p className="text-slate-500 font-black uppercase tracking-[0.5em] text-sm">等待任务启动</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-panel p-10 rounded-[2.5rem] relative overflow-hidden group shadow-2xl">
                <h3 className="text-xs font-black mb-8 flex items-center gap-4 text-slate-500 uppercase tracking-[0.3em]">
                   <div className="w-2.5 h-2.5 bg-cyan-500 rounded-full animate-pulse shadow-[0_0_10px_#06b6d4]"></div>
                   海报文本原始数据 / 输入文案
                </h3>
                <div className="bg-slate-950/60 p-8 rounded-[2rem] border border-white/5 font-mono text-[13px] leading-loose text-indigo-100/60 whitespace-pre-wrap min-h-[200px] shadow-inner">
                  {images[currentIndex].rawOcrText || (images[currentIndex].status === 'error' ? "数据分析异常..." : "等待解析数据...")}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center glass-panel rounded-[4rem] border-2 border-dashed border-white/5 group hover:border-indigo-500/20 transition-all duration-1000 placeholder-glass-panel">
               <div className="relative w-64 h-64 mb-12">
                 <div className={`absolute inset-0 blur-[100px] rounded-full transition-all duration-1000 ${isLightMode ? 'bg-indigo-400/10 group-hover:bg-indigo-400/20' : 'bg-indigo-600/10 group-hover:bg-indigo-600/20'}`}></div>
                 <svg className={`w-full h-full transition-colors duration-1000 ${isLightMode ? 'text-indigo-500/10 group-hover:text-indigo-500/20' : 'text-slate-900 group-hover:text-slate-800/50'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
               </div>
               <h2 className="text-4xl font-black text-slate-600 group-hover:text-slate-400 transition-colors duration-1000 tracking-tighter text-center px-10">
                 {images.length === 0 ? "请从左侧上传图片或输入文案" : "请从队列中选择一项查看结果"}
               </h2>
               <p className="text-slate-500 mt-6 text-center max-w-sm leading-relaxed font-bold uppercase text-[9px] tracking-[0.5em] opacity-60">GUARDVISION 2026 安全校对系统</p>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-8 lg:col-start-5">
          <TerminologyManager terms={terminology} onUpdate={setTerminology} />
        </div>
      </main>

      {showConfig && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-500 config-modal-overlay">
          <div className="glass-panel w-full max-w-5xl rounded-[3rem] p-12 border-white/10 shadow-[0_0_150px_rgba(79,70,229,0.3)] animate-in zoom-in-95 duration-500 config-modal-panel">
            <div className="flex justify-between items-center mb-10">
              <div>
                <h2 className="text-4xl font-black text-white tracking-tight">API 配置</h2>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.4em] mt-2">混合智能后端设置</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="w-14 h-14 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-indigo-500 transition-all close-config-btn">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 mb-8 w-fit">
              <button 
                onClick={() => setActiveConfigTab('ocr')}
                className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeConfigTab === 'ocr' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                OCR 引擎配置
              </button>
              <button 
                onClick={() => setActiveConfigTab('llm')}
                className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeConfigTab === 'llm' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                多模态大模型配置
              </button>
            </div>

            {activeConfigTab === 'ocr' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-8">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">提取方案 (OCR)</label>
                  <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.values(OCRProvider).map(p => (
                      <div 
                        key={`provider-${p}`} 
                        onClick={() => { 
                          const nextKeys = providerKeys[p] || {};
                          setConfig(prev => ({ 
                            ...prev, 
                            provider: p, 
                            apiKey: nextKeys.apiKey || '', 
                            secretKey: nextKeys.secretKey || '' 
                          })); 
                          setTestResult(null); 
                        }}
                        className={`p-4 rounded-3xl border-2 cursor-pointer transition-all flex items-center gap-5 ${
                          config.provider === p ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.3)]' : 'bg-white/5 border-transparent hover:border-white/10'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${config.provider === p ? 'border-indigo-500' : 'border-slate-700'}`}>
                          {config.provider === p && <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-[0_0_10px_#6366f1]"></div>}
                        </div>
                        <span className={`font-bold transition-colors uppercase text-xs tracking-wider ${config.provider === p ? 'text-white' : 'text-slate-500'}`}>
                          {OCR_PROVIDER_INFO[p as keyof typeof OCR_PROVIDER_INFO]?.name || p}
                        </span>
                        {p === OCRProvider.ESEARCH && (
                          <span className="ml-auto text-[8px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded-md uppercase tracking-widest">推荐</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-8">
                  {currentProviderInfo && (
                    <div className="space-y-6">
                      {(config.provider === OCRProvider.LOCAL || config.provider === OCRProvider.ESEARCH) ? (
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">WASM 内置识别语言</label>
                          <select 
                            className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-white font-bold transition-all shadow-inner appearance-none"
                            value={config.language || 'eng+chi_sim'}
                            onChange={e => setConfig({ ...config, language: e.target.value })}
                          >
                            <option value="eng+chi_sim">中英混合 (eng+chi_sim)</option>
                            <option value="eng">纯英文 (eng)</option>
                            <option value="chi_sim">简体中文 (chi_sim)</option>
                            <option value="fra">法语 (fra)</option>
                            <option value="deu">德语 (deu)</option>
                            <option value="spa">西班牙语 (spa)</option>
                          </select>
                        </div>
                      ) : currentProviderInfo.keyLabel && (
                        <>
                          <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">{currentProviderInfo.keyLabel}</label>
                            <input type="password" 
                              className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-white font-bold transition-all shadow-inner" 
                              value={config.apiKey || ''} 
                              onChange={e => {
                                const val = e.target.value;
                                setConfig(prev => ({ ...prev, apiKey: val }));
                                setProviderKeys(prev => ({ 
                                  ...prev, 
                                  [config.provider]: { ...prev[config.provider], apiKey: val } 
                                }));
                              }} 
                              placeholder={`请输入您的 ${currentProviderInfo.keyLabel}`} />
                          </div>
                          {currentProviderInfo.secretLabel && (
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">{currentProviderInfo.secretLabel}</label>
                              <input type="password" 
                                className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-white font-bold transition-all shadow-inner" 
                                value={config.secretKey || ''} 
                                onChange={e => {
                                  const val = e.target.value;
                                  setConfig(prev => ({ ...prev, secretKey: val }));
                                  setProviderKeys(prev => ({ 
                                    ...prev, 
                                    [config.provider]: { ...prev[config.provider], secretKey: val } 
                                  }));
                                }} 
                                placeholder={`请输入您的 ${currentProviderInfo.secretLabel}`} />
                            </div>
                          )}
                        </>
                      )}
                      
                      <div className="space-y-3 pl-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">
                            {config.provider === OCRProvider.LOCAL || config.provider === OCRProvider.ESEARCH ? '开源项目地址:' : '申请地址:'}
                          </span>
                          <a href={currentProviderInfo.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 hover:text-cyan-300 underline transition-colors break-all font-bold">
                            {currentProviderInfo.url}
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentProviderInfo.features.map((feat, i) => (
                            <span key={`feat-${i}`} className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md font-black uppercase">
                              {feat}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="p-8 bg-indigo-500/5 rounded-[2rem] border border-indigo-500/10 shadow-inner">
                     <p className="text-[12px] text-slate-400 leading-relaxed font-medium">
                        {currentProviderInfo?.description}
                     </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-8">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">模型方案 (LLM)</label>
                  <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.values(LLMProvider).map(p => (
                      <div 
                        key={`llm-provider-${p}`} 
                        onClick={() => { 
                          const nextKeys = llmProviderKeys[p] || {};
                          setLlmConfig(prev => ({ 
                            ...prev, 
                            provider: p, 
                            apiKey: nextKeys.apiKey || '',
                            modelName: nextKeys.modelName || ''
                          })); 
                          setTestResult(null); 
                        }}
                        className={`p-4 rounded-3xl border-2 cursor-pointer transition-all flex items-center gap-5 ${
                          llmConfig.provider === p ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.3)]' : 'bg-white/5 border-transparent hover:border-white/10'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${llmConfig.provider === p ? 'border-indigo-500' : 'border-slate-700'}`}>
                          {llmConfig.provider === p && <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-[0_0_10px_#6366f1]"></div>}
                        </div>
                        <span className={`font-bold transition-colors uppercase text-xs tracking-wider ${llmConfig.provider === p ? 'text-white' : 'text-slate-500'}`}>
                          {LLM_PROVIDER_INFO[p as keyof typeof LLM_PROVIDER_INFO]?.name || p}
                        </span>
                        {p === LLMProvider.GEMINI && (
                          <span className="ml-auto text-[8px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded-md uppercase tracking-widest">默认</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-8">
                  {currentLlmProviderInfo && (
                    <div className="space-y-6">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">{currentLlmProviderInfo.keyLabel}</label>
                        <input type="password" 
                          className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-white font-bold transition-all shadow-inner" 
                          value={llmConfig.apiKey || ''} 
                          onChange={e => {
                            const val = e.target.value;
                            setLlmConfig(prev => ({ ...prev, apiKey: val }));
                            setLlmProviderKeys(prev => ({ 
                              ...prev, 
                              [llmConfig.provider]: { ...prev[llmConfig.provider], apiKey: val } 
                            }));
                          }} 
                          placeholder={`请输入您的 ${currentLlmProviderInfo.keyLabel}`} />
                      </div>
                      
                      <div className="space-y-3 pl-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">
                            申请地址:
                          </span>
                          <a href={currentLlmProviderInfo.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 hover:text-cyan-300 underline transition-colors break-all font-bold">
                            {currentLlmProviderInfo.url}
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentLlmProviderInfo.features.map((feat, i) => (
                            <span key={`llm-feat-${i}`} className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md font-black uppercase">
                              {feat}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="p-8 bg-indigo-500/5 rounded-[2rem] border border-indigo-500/10 shadow-inner">
                         <p className="text-[12px] text-slate-400 leading-relaxed font-medium">
                            {currentLlmProviderInfo?.description}
                         </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-10 flex gap-4 mt-auto">
                {testResult && (
                  <div className={`p-4 rounded-2xl text-[11px] border-2 flex-1 animate-in fade-in zoom-in-95 duration-500 ${
                    testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}>
                    <p className="font-black uppercase tracking-widest mb-1">{testResult.success ? "配置格式验证通过" : "连接验证未通过"}</p>
                    <p className="opacity-80 font-bold">{testResult.message}</p>
                  </div>
                )}
                
                <div className="flex gap-4 ml-auto">
                   <Button variant="outline" className="rounded-2xl px-10" loading={testLoading} onClick={() => { 
                     setTestLoading(true); 
                     testOcrConnection(config).then(setTestResult).finally(() => setTestLoading(false)); 
                   }}>
                     验证当前连接
                   </Button>
                   <Button variant="primary" className="rounded-2xl px-12" onClick={() => setShowConfig(false)}>同步并生效</Button>
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
