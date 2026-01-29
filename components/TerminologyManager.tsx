
import React, { useState, useMemo } from 'react';
import { SecurityTerm } from '../types';
import Button from './Button';
import { parseTerminologyFromText } from '../services/geminiService';

const loadPdfJs = async () => {
  const pdfjs = await import('https://esm.sh/pdfjs-dist@4.10.38/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs`;
  return pdfjs;
};

interface TerminologyManagerProps {
  terms: SecurityTerm[];
  onUpdate: (newTerms: SecurityTerm[]) => void;
}

interface Conflict {
  existing: SecurityTerm;
  imported: SecurityTerm;
  existingIdx: number;
}

const TerminologyManager: React.FC<TerminologyManagerProps> = ({ terms, onUpdate }) => {
  const [newTerm, setNewTerm] = useState<Partial<SecurityTerm>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<'fuzzy' | 'exact'>('fuzzy');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  
  // 冲突处理状态
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [pendingNewItems, setPendingNewItems] = useState<SecurityTerm[]>([]);

  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return fullText;
  };

  /**
   * 识别冲突并进入比对流程
   */
  const processImportedTerms = (imported: SecurityTerm[]) => {
    const existingTerms = [...terms];
    const newItemsToAdd: SecurityTerm[] = [];
    const detectedConflicts: Conflict[] = [];

    imported.forEach(item => {
      const existingIdx = existingTerms.findIndex(t => t.term.toLowerCase().trim() === item.term.toLowerCase().trim());
      
      if (existingIdx > -1) {
        const existing = existingTerms[existingIdx];
        const isIdentical = 
          existing.category === item.category && 
          existing.definition === item.definition && 
          existing.preferredAlternative === item.preferredAlternative;
        
        if (!isIdentical) {
          detectedConflicts.push({ existing, imported: item, existingIdx });
        }
      } else {
        newItemsToAdd.push(item);
      }
    });

    if (detectedConflicts.length > 0) {
      setConflicts(detectedConflicts);
      setPendingNewItems(newItemsToAdd);
    } else if (newItemsToAdd.length > 0) {
      onUpdate([...existingTerms, ...newItemsToAdd]);
    } else {
      alert("导入完成：未发现新术语或冲突项。");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      let imported: SecurityTerm[] = [];
      if (file.type === 'application/json') {
        const text = await file.text();
        const data = JSON.parse(text);
        imported = Array.isArray(data) ? data : [];
      } else if (file.type === 'text/plain') {
        imported = await parseTerminologyFromText(await file.text());
      } else if (file.type === 'application/pdf') {
        const rawText = await extractTextFromPdf(await file.arrayBuffer());
        imported = await parseTerminologyFromText(rawText);
      }
      
      if (imported.length > 0) {
        processImportedTerms(imported);
      } else {
        alert("未能从文件中解析出有效的术语数据。");
      }
    } catch (err) {
      alert("智能引擎解析失败，请检查文件格式或 API 通讯。");
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleExport = () => {
    if (terms.length === 0) {
      alert("当前词库为空，无法导出。");
      return;
    }
    const data = JSON.stringify(terms, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GuardVision_Terminology_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 冲突解决决策
  const resolveConflict = (decision: 'keep' | 'overwrite' | 'merge', mergedFields?: Partial<SecurityTerm>) => {
    const currentConflict = conflicts[0];
    const updatedTerms = [...terms];
    
    if (decision === 'overwrite') {
      updatedTerms[currentConflict.existingIdx] = currentConflict.imported;
    } else if (decision === 'merge' && mergedFields) {
      updatedTerms[currentConflict.existingIdx] = { ...currentConflict.existing, ...mergedFields };
    }
    // 'keep' 模式下不做任何处理，直接保留原项
    
    onUpdate(updatedTerms);
    
    const remaining = conflicts.slice(1);
    setConflicts(remaining);
    
    // 如果全部解决，添加全新的项
    if (remaining.length === 0 && pendingNewItems.length > 0) {
      onUpdate([...updatedTerms, ...pendingNewItems]);
      setPendingNewItems([]);
    }
  };

  const startEditing = (idx: number) => {
    setEditingIdx(idx);
    setNewTerm(terms[idx]);
    const formElement = document.getElementById('terminology-form');
    formElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const cancelEditing = () => {
    setEditingIdx(null);
    setNewTerm({});
  };

  const handleSubmit = () => {
    if (!newTerm.term) return;

    if (editingIdx !== null) {
      const updatedTerms = [...terms];
      updatedTerms[editingIdx] = newTerm as SecurityTerm;
      onUpdate(updatedTerms);
      setEditingIdx(null);
    } else {
      onUpdate([...terms, newTerm as SecurityTerm]);
    }
    setNewTerm({});
  };

  // 搜索过滤逻辑
  const filteredTermsWithIndex = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    if (!lowerSearch) return terms.map((t, i) => ({ term: t, originalIndex: i }));

    return terms
      .map((t, i) => ({ term: t, originalIndex: i }))
      .filter(({ term }) => {
        const t = term.term.toLowerCase();
        const c = term.category.toLowerCase();
        const d = term.definition.toLowerCase();

        if (searchMode === 'exact') {
          return t === lowerSearch || c === lowerSearch;
        }
        
        const isMatch = t.includes(lowerSearch) || c.includes(lowerSearch) || d.includes(lowerSearch);
        return isMatch;
      });
  }, [terms, searchTerm, searchMode]);

  // 拖拽排序逻辑
  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (searchTerm) return;
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const target = e.target as HTMLElement;
      target.style.opacity = '0.4';
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
    setDraggedIdx(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex || searchTerm) return;

    const newTerms = [...terms];
    const [draggedItem] = newTerms.splice(draggedIdx, 1);
    newTerms.splice(targetIndex, 0, draggedItem);
    onUpdate(newTerms);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
      
      {/* 细致冲突比对工作站 */}
      {conflicts.length > 0 && (
        <div className="fixed inset-0 z-[250] bg-slate-950/60 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-500">
          <div className="glass-panel w-full max-w-5xl rounded-[3rem] p-10 border-white/10 shadow-[0_0_100px_rgba(79,70,229,0.4)] flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-start mb-8">
               <div>
                  <h3 className="text-3xl font-black text-white tracking-tighter">发现术语冲突</h3>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.4em] mt-2">冲突解决队列: {conflicts.length} 项待处理</p>
               </div>
               <div className="bg-indigo-500 text-white px-5 py-2 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg">
                  当前术语: {conflicts[0].existing.term}
               </div>
            </div>

            <div className="grid grid-cols-2 gap-8 flex-1 overflow-y-auto mb-8 pr-4 custom-scrollbar">
               {/* 现有版本 */}
               <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-2 h-2 bg-slate-500 rounded-full"></div>
                    <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">当前词库内容 (EXISTING)</h4>
                  </div>
                  <div className="bg-slate-900/40 rounded-3xl p-8 border border-white/5 space-y-6">
                    <div>
                      <label className="text-[9px] font-black text-slate-600 uppercase mb-2 block tracking-widest">分类</label>
                      <p className="text-white font-bold">{conflicts[0].existing.category}</p>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-600 uppercase mb-2 block tracking-widest">定义</label>
                      <p className="text-sm text-slate-400 leading-relaxed">{conflicts[0].existing.definition}</p>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-600 uppercase mb-2 block tracking-widest">优选建议</label>
                      <p className="text-indigo-400 font-bold">{conflicts[0].existing.preferredAlternative || '无'}</p>
                    </div>
                  </div>
                  <Button variant="secondary" className="w-full rounded-2xl py-4" onClick={() => resolveConflict('keep')}>
                    保留此项 (跳过导入)
                  </Button>
               </div>

               {/* 导入版本 */}
               <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_10px_#6366f1]"></div>
                    <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.2em]">新导入内容 (IMPORTED)</h4>
                  </div>
                  <div className="bg-indigo-500/5 rounded-3xl p-8 border border-indigo-500/20 space-y-6">
                    <div>
                      <label className="text-[9px] font-black text-indigo-500/50 uppercase mb-2 block tracking-widest">分类</label>
                      <p className="text-white font-bold">{conflicts[0].imported.category}</p>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-indigo-500/50 uppercase mb-2 block tracking-widest">定义</label>
                      <p className="text-sm text-slate-300 leading-relaxed">{conflicts[0].imported.definition}</p>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-indigo-500/50 uppercase mb-2 block tracking-widest">优选建议</label>
                      <p className="text-indigo-400 font-bold">{conflicts[0].imported.preferredAlternative || '无'}</p>
                    </div>
                  </div>
                  <Button variant="primary" className="w-full rounded-2xl py-4" onClick={() => resolveConflict('overwrite')}>
                    采用新版 (覆盖现有)
                  </Button>
               </div>
            </div>

            <div className="pt-8 border-t border-white/5 flex gap-4">
              <Button variant="outline" className="flex-1 rounded-2xl" onClick={() => {
                // 简单的自动合并：如果旧版缺失某项，用新版填补
                const merged = {
                  category: conflicts[0].imported.category || conflicts[0].existing.category,
                  definition: conflicts[0].imported.definition || conflicts[0].existing.definition,
                  preferredAlternative: conflicts[0].imported.preferredAlternative || conflicts[0].existing.preferredAlternative
                };
                resolveConflict('merge', merged);
              }}>
                智能合并 (自动填充缺失字段)
              </Button>
              <Button variant="danger" className="px-10 rounded-2xl" onClick={() => { setConflicts([]); setPendingNewItems([]); }}>
                取消本次导入
              </Button>
            </div>
          </div>
        </div>
      )}

      <div id="terminology-form" className={`glass-panel relative rounded-[2.5rem] p-10 shadow-2xl border-white/5 transition-all duration-500 ${editingIdx !== null ? 'ring-2 ring-indigo-500/50 bg-indigo-500/5' : ''}`}>
        
        {/* 导入进度指示器 */}
        {isImporting && (
          <div className="absolute inset-0 z-[100] bg-slate-950/40 backdrop-blur-md rounded-[2.5rem] flex flex-col items-center justify-center animate-in fade-in duration-300">
             <div className="bg-slate-900/90 border border-white/10 p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center gap-6 max-w-sm text-center">
                <div className="relative w-16 h-16">
                   <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                   <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                   <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-indigo-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a2 2 0 00-1.96 1.414l-.724 2.17a2 2 0 00.51 2.22l1.31 1.31a2 2 0 01.43 2.138l-.723 2.169a2 2 0 01-1.414 1.96l-2.17.724a2 2 0 01-2.22-.51l-1.31-1.31a2 2 0 00-2.138-.43l-2.169.723a2 2 0 00-1.96-1.414l-.724-2.17a2 2 0 00-.51-2.22l1.31-1.31a2 2 0 01-.43-2.138l.723-2.169a2 2 0 011.414-1.96l2.17-.724a2 2 0 012.22-.51l1.31-1.31a2 2 0 002.138.43l2.169-.723a2 2 0 001.96 1.414l.724 2.17a2 2 0 00.51 2.22l-1.31 1.31a2 2 0 01-.43 2.138l.723 2.169a2 2 0 011.414-1.96l2.17.724a2 2 0 012.22-.51l1.31-1.31a2 2 0 002.138-.43l2.169.723a2 2 0 001.96 1.414l.724 2.17a2 2 0 00.51 2.22l-1.31 1.31z" />
                      </svg>
                   </div>
                </div>
                <div>
                   <h4 className="text-white font-black text-xl tracking-tight mb-2">AI 术语解析中</h4>
                   <p className="text-slate-500 text-xs font-bold leading-relaxed">GuardVision 正在深度扫描文档内容，识别安防行业关键词并同步至您的私人词库。</p>
                   <div className="mt-6 flex justify-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                   </div>
                </div>
             </div>
          </div>
        )}

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-6">
          <div>
            <h3 className="text-3xl font-black text-white tracking-tighter">管理词库</h3>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.4em] mt-2">词库核心分析管理</p>
          </div>
          <div className="flex gap-3">
            <input type="file" id="term-import" className="hidden" accept=".json,.txt,.pdf" onChange={handleImport} disabled={editingIdx !== null} />
            <label htmlFor="term-import" className={`cursor-pointer ${editingIdx !== null ? 'opacity-50 pointer-events-none' : ''}`}>
              <Button variant="outline" size="sm" as="div" loading={isImporting} className="rounded-xl flex items-center gap-2 min-w-[120px]">
                {!isImporting && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                )}
                {isImporting ? '正在解析' : '导入词库'}
              </Button>
            </label>
            <Button variant="secondary" size="sm" onClick={handleExport} className="rounded-xl flex items-center gap-2 min-w-[120px]" disabled={editingIdx !== null}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              导出词库
            </Button>
          </div>
        </div>

        {/* 增强型搜索栏 */}
        <div className="flex flex-col md:flex-row gap-4 mb-10">
          <div className="relative flex-1 group">
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
              <svg className="w-5 h-5 text-slate-500 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input 
              type="text"
              placeholder={searchMode === 'fuzzy' ? "模糊搜索术语、分类或定义..." : "精确匹配术语名或分类名..."}
              className="w-full bg-black/20 border-2 border-white/5 rounded-[1.5rem] pl-16 pr-12 py-4 focus:border-indigo-500/50 outline-none text-sm text-white font-bold transition-all shadow-inner placeholder:text-slate-600 focus:bg-black/40"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-5 flex items-center text-slate-500 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          <div className="flex bg-black/20 p-1.5 rounded-[1.5rem] border-2 border-white/5 shrink-0">
             <button 
               onClick={() => setSearchMode('fuzzy')}
               className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${searchMode === 'fuzzy' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
             >
               模糊匹配
             </button>
             <button 
               onClick={() => setSearchMode('exact')}
               className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${searchMode === 'exact' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
             >
               精确搜索
             </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10 bg-white/5 p-8 rounded-[2rem] border border-white/5 shadow-inner">
          <div className="space-y-4">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">
              {editingIdx !== null ? '正在编辑词项' : '新增词项识别符'}
            </label>
            <input className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-sm text-white font-bold transition-all shadow-inner" placeholder="术语名 (如: H.265+)" value={newTerm.term || ''} onChange={e => setNewTerm({ ...newTerm, term: e.target.value })} />
            <input className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-sm text-white font-bold transition-all shadow-inner" placeholder="领域归类 (如: 视频压缩)" value={newTerm.category || ''} onChange={e => setNewTerm({ ...newTerm, category: e.target.value })} />
          </div>
          <div className="space-y-4">
             <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">行业定义与推荐</label>
             <input className="w-full bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-sm text-white font-bold transition-all shadow-inner" placeholder="专家级定义" value={newTerm.definition || ''} onChange={e => setNewTerm({ ...newTerm, definition: e.target.value })} />
             <div className="flex gap-4">
                <input className="flex-1 bg-black/40 border-2 border-white/5 rounded-2xl px-6 py-4 focus:border-indigo-500 outline-none text-sm text-white font-bold transition-all shadow-inner" placeholder="优选替代方案" value={newTerm.preferredAlternative || ''} onChange={e => setNewTerm({ ...newTerm, preferredAlternative: e.target.value })} />
                <div className="flex gap-2 shrink-0">
                   {editingIdx !== null && (
                     <Button variant="danger" className="rounded-2xl px-8 shadow-lg ring-4 ring-rose-500/20" onClick={cancelEditing}>
                       放弃修改
                     </Button>
                   )}
                   <Button variant="primary" className="rounded-2xl" onClick={handleSubmit}>
                     {editingIdx !== null ? '确认更新' : '写入词库'}
                   </Button>
                </div>
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
          {filteredTermsWithIndex.map(({ term: item, originalIndex: idx }) => {
            const isBeingEdited = editingIdx === idx;
            const isOtherBeingEdited = editingIdx !== null && !isBeingEdited;
            const canDrag = !searchTerm && !isOtherBeingEdited && !isBeingEdited;
            
            return (
              <div 
                key={idx} 
                draggable={canDrag}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                className={`glass-panel p-6 rounded-3xl border-white/5 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all group flex items-start gap-4 shadow-lg cursor-default ${isBeingEdited ? 'ring-2 ring-indigo-500/50 bg-indigo-500/20 scale-[1.02]' : ''} ${isOtherBeingEdited ? 'opacity-40 grayscale-[0.5]' : ''} ${draggedIdx === idx ? 'ring-2 ring-indigo-500 border-indigo-500/50' : ''}`}
              >
                {/* 拖拽手柄 */}
                {!searchTerm && (
                  <div className={`cursor-grab active:cursor-grabbing shrink-0 self-center text-slate-600 hover:text-indigo-400 transition-colors p-1 ${isOtherBeingEdited || isBeingEdited ? 'invisible' : 'visible'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8h16M4 16h16" />
                    </svg>
                  </div>
                )}

                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-transform ${isBeingEdited ? 'bg-indigo-500 text-white border-indigo-400 rotate-12' : 'bg-indigo-500/10 border-indigo-500/20 group-hover:rotate-12'}`}>
                   <span className={`font-black text-lg ${isBeingEdited ? 'text-white' : 'text-indigo-400'}`}>#</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-extrabold text-white text-base truncate">{item.term}</span>
                    <span className="text-[9px] font-black px-2 py-0.5 bg-slate-800 text-slate-500 rounded-lg border border-white/5 uppercase tracking-tighter category-tag">{item.category}</span>
                    {isBeingEdited && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 bg-indigo-500 text-white rounded-md animate-pulse uppercase tracking-widest ml-auto">正在修改</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed font-medium">{item.definition}</p>
                </div>
                <div className={`flex flex-col gap-2 transition-opacity ${isOtherBeingEdited ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button 
                    onClick={() => startEditing(idx)} 
                    disabled={isOtherBeingEdited}
                    className={`text-slate-500 hover:text-indigo-400 transition-colors p-2 ${isOtherBeingEdited ? 'cursor-not-allowed text-slate-800' : ''}`}
                    title="编辑"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button 
                    onClick={() => {
                      if (confirm(`确定要删除术语 "${item.term}" 吗？`)) {
                        onUpdate(terms.filter((_, i) => i !== idx));
                        if (editingIdx === idx) cancelEditing();
                      }
                    }} 
                    disabled={isOtherBeingEdited}
                    className={`text-slate-700 hover:text-rose-500 transition-colors p-2 ${isOtherBeingEdited ? 'cursor-not-allowed text-slate-800' : ''}`}
                    title="删除"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
          {filteredTermsWithIndex.length === 0 && (
            <div className="col-span-full py-20 text-center opacity-20">
               <p className="text-sm font-black uppercase tracking-[0.4em]">
                 {searchTerm ? `未找到与 "${searchTerm}" 相关的结果` : '词库当前为空'}
               </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerminologyManager;
