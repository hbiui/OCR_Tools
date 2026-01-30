
/**
 * Tesseract.js 识别服务
 * 针对 Vercel 部署环境进行了优化，使用锁定的 CDN 版本以确保 WASM 核心加载稳定性。
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
  // 使用锁定的 v5.1.1 版本，避免生产环境版本漂移
  const Tesseract = await import('https://esm.sh/tesseract.js@5.1.1');
  
  try {
    if (!activeWorker || currentLanguage !== lang) {
      if (activeWorker) await activeWorker.terminate();
      
      // 显式指定 worker 和 core 的 CDN 路径，确保在 Vercel 的各种网络环境下都能正确拉取 WASM 
      activeWorker = await Tesseract.createWorker(lang, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd.wasm.js',
      });
      currentLanguage = lang;
    }

    // 执行识别
    const { data: { text } } = await activeWorker.recognize(`data:image/png;base64,${base64Image}`);
    
    return text;
  } catch (err) {
    console.error("Vercel Local OCR Runtime Error:", err);
    await terminateLocalOcr();
    throw new Error("OCR 引擎启动失败，请检查浏览器是否禁用了 WebAssembly 或受限于企业内网策略。");
  }
};
