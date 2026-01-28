
/**
 * Tesseract.js 识别服务
 * 针对 v5 版本进行了优化，修复了初始化挂起和识别缓慢的问题。
 */

let activeWorker: any = null;
let currentLanguage: string = '';

/**
 * 终止当前的 OCR 任务并释放资源
 */
export const terminateLocalOcr = async () => {
  if (activeWorker) {
    try {
      await activeWorker.terminate();
    } catch (e) {
      console.warn("Worker termination failed:", e);
    }
    activeWorker = null;
    currentLanguage = '';
  }
};

/**
 * 执行本地 OCR 识别
 * @param base64Image 图片数据 (Base64)
 * @param lang 语言代码，例如 'eng', 'chi_sim', 'eng+chi_sim'
 */
export const performLocalOcr = async (base64Image: string, lang: string = 'eng+chi_sim'): Promise<string> => {
  // 动态导入 Tesseract.js
  const Tesseract = await import('https://esm.sh/tesseract.js@5.1.1');
  
  try {
    // 性能优化：如果语言相同且 Worker 存在，则复用 Worker 以减少初始化时间（约 2-5秒）
    if (!activeWorker || currentLanguage !== lang) {
      if (activeWorker) await activeWorker.terminate();
      
      // Tesseract v5 正确签名: createWorker(langs, OEM, config)
      activeWorker = await Tesseract.createWorker(lang, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd.wasm.js',
        // 可以根据需要添加 logger 监控进度
        // logger: m => console.log(m)
      });
      currentLanguage = lang;
    }

    // 执行识别
    // 注意：v5 的 recognize 不需要再次传入语言，因为它已经在 worker 初始化时加载了
    const { data: { text } } = await activeWorker.recognize(`data:image/png;base64,${base64Image}`);
    
    return text;
  } catch (err) {
    console.error("Local OCR Error:", err);
    // 出错时重置，防止 Worker 进入死锁状态
    await terminateLocalOcr();
    throw err;
  }
};
