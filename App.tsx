/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useRef, useEffect } from 'react';
import { generateImage, generateVoxelScene, IMAGE_SYSTEM_PROMPT, VOXEL_PROMPT } from './services/gemini';
import { extractHtmlFromText, hideBodyText, zoomCamera, injectSceneMonitor, enhanceControls, injectLayerSlider } from './utils/html';

// Available aspect ratios
const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"];

// Allowed file types
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif'
];

const SAMPLE_PROMPTS = [
    "A tree house under the sea",
    "A cyberpunk street food stall", 
    "An ancient temple floating in the sky",
    "A cozy winter cabin with smoke",
    "A futuristic mars rover",
    "A dragon guarding gold"
];

interface Example {
  img: string;
  html: string;
}

const EXAMPLES: Example[] = [
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example1.png', html: '/examples/example1.html' },
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example2.png', html: '/examples/example2.html' },
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example3.png', html: '/examples/example3.html' },
];

interface VoxelStat {
    color: string;
    count: number;
}

interface HistoryItem {
    id: string;
    image: string;
    voxel: string | null;
    prompt: string;
    timestamp: number;
    stats: VoxelStat[] | null;
}

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  
  // Main View State
  const [imageData, setImageData] = useState<string | null>(null);
  const [voxelCode, setVoxelCode] = useState<string | null>(null);
  
  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const [status, setStatus] = useState<'idle' | 'generating_image' | 'generating_voxels' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [useOptimization, setUseOptimization] = useState(true);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [viewMode, setViewMode] = useState<'image' | 'voxel'>('image');
  
  // Streaming Thoughts State
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  
  // Stats
  const [voxelStats, setVoxelStats] = useState<VoxelStat[] | null>(null);
  
  const [loadedThumbnails, setLoadedThumbnails] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen for stats messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'voxel_stats') {
            const newStats = event.data.stats;
            setVoxelStats(newStats);
            
            // Update history item with stats if currently selected
            if (selectedHistoryId) {
                setHistory(prev => prev.map(item => 
                    item.id === selectedHistoryId 
                    ? { ...item, stats: newStats }
                    : item
                ));
            }
        }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedHistoryId]);

  // Rotate placeholders
  useEffect(() => {
    const interval = setInterval(() => {
        setPlaceholderIndex((prev) => (prev + 1) % SAMPLE_PROMPTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Load thumbnails
  useEffect(() => {
    const createdUrls: string[] = [];
    const loadThumbnails = async () => {
      const loaded: Record<string, string> = {};
      await Promise.all(EXAMPLES.map(async (ex) => {
        try {
          const response = await fetch(ex.img);
          if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            loaded[ex.img] = url;
          }
        } catch (e) {
          console.error("Failed to load thumbnail:", ex.img, e);
        }
      }));
      setLoadedThumbnails(loaded);
    };
    loadThumbnails();

    return () => {
        createdUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const addToHistory = (img: string, code: string | null, p: string) => {
      const newItem: HistoryItem = {
          id: Date.now().toString(),
          image: img,
          voxel: code,
          prompt: p,
          timestamp: Date.now(),
          stats: null
      };
      setHistory(prev => [newItem, ...prev]);
      setSelectedHistoryId(newItem.id);
  };

  const updateHistoryVoxel = (id: string, code: string) => {
      setHistory(prev => prev.map(item => 
          item.id === id ? { ...item, voxel: code } : item
      ));
  };

  const handleError = (err: any) => {
    setStatus('error');
    setErrorMsg(err.message || 'An unexpected error occurred.');
    console.error(err);
  };

  const handleImageGenerate = async () => {
    if (!prompt.trim()) return;
    
    setStatus('generating_image');
    setErrorMsg('');
    setImageData(null);
    setVoxelCode(null);
    setVoxelStats(null);
    setThinkingText(null);
    setViewMode('image');
    setSelectedHistoryId(null);

    try {
      const imageUrl = await generateImage(prompt, aspectRatio, useOptimization);
      
      setImageData(imageUrl);
      setVoxelCode(null);
      
      addToHistory(imageUrl, null, prompt);
      
      setStatus('idle');
    } catch (err) {
      handleError(err);
    }
  };

  const processFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      handleError(new Error("Invalid file type. Please upload PNG, JPEG, WEBP, HEIC, or HEIF."));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageData(result);
      setVoxelCode(null);
      setVoxelStats(null);
      setViewMode('image');
      setStatus('idle');
      setErrorMsg('');
      addToHistory(result, null, "Uploaded Image");
    };
    reader.onerror = () => handleError(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handleExampleClick = async (example: Example) => {
    if (status !== 'idle' && status !== 'error' && status !== 'generating_voxels') return;
    
    setErrorMsg('');
    setThinkingText(null);
    setVoxelStats(null);
    setSelectedHistoryId(null); // Deselect history when picking example
    
    try {
      const imgResponse = await fetch(example.img);
      const imgBlob = await imgResponse.blob();
      const base64Img = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(imgBlob);
      });

      let htmlText = '';
      try {
        const htmlResponse = await fetch(example.html);
        if (htmlResponse.ok) {
            const rawText = await htmlResponse.text();
            // Process the HTML to inject monitors, layer sliders and fix controls
            htmlText = enhanceControls(injectLayerSlider(injectSceneMonitor(zoomCamera(hideBodyText(extractHtmlFromText(rawText))))));
        }
      } catch (e) {
          console.warn("Failed to fetch HTML", e);
      }

      setImageData(base64Img);
      setVoxelCode(htmlText);
      setViewMode('voxel');
      setStatus('idle');
      setPrompt("");

    } catch (err) {
      handleError(err);
    }
  };

  const handleHistoryClick = (item: HistoryItem) => {
      if (status !== 'idle' && status !== 'error') return;
      setImageData(item.image);
      setVoxelCode(item.voxel);
      setVoxelStats(item.stats);
      setPrompt(item.prompt);
      setSelectedHistoryId(item.id);
      setViewMode(item.voxel ? 'voxel' : 'image');
      setErrorMsg('');
  };

  const handleVoxelize = async () => {
    if (!imageData) return;
    setStatus('generating_voxels');
    setErrorMsg('');
    setThinkingText(null);
    setVoxelStats(null);
    
    let thoughtBuffer = "";

    try {
      const codeRaw = await generateVoxelScene(imageData, (thoughtFragment) => {
          thoughtBuffer += thoughtFragment;
          const matches = thoughtBuffer.match(/\*\*([^*]+)\*\*/g);
          if (matches && matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              const header = lastMatch.replace(/\*\*/g, '').trim();
              setThinkingText(prev => prev === header ? prev : header);
          }
      });
      
      // Process the generated code
      const code = enhanceControls(injectLayerSlider(injectSceneMonitor(zoomCamera(hideBodyText(codeRaw)))));
      setVoxelCode(code);
      
      if (selectedHistoryId) {
          updateHistoryVoxel(selectedHistoryId, code);
      } else {
          // If we generated voxels for an example or something not in history, add it now?
          // Or strictly update current view. Let's just keep it in view for now.
      }
      
      setViewMode('voxel');
      setStatus('idle');
      setThinkingText(null);
    } catch (err) {
      handleError(err);
    }
  };

  const handleDownload = () => {
    if (viewMode === 'image' && imageData) {
      const a = document.createElement('a');
      a.href = imageData;
      const ext = imageData.includes('image/jpeg') ? 'jpg' : 'png';
      a.download = `voxelize-image-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (viewMode === 'voxel' && voxelCode) {
      const a = document.createElement('a');
      a.href = `data:text/html;charset=utf-8,${encodeURIComponent(voxelCode)}`;
      a.download = `voxel-scene-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const isLoading = status !== 'idle' && status !== 'error';

  const getDisplayPrompt = () => {
    if (status === 'generating_image') {
      return useOptimization ? `${IMAGE_SYSTEM_PROMPT}\n\nSubject: ${prompt}` : prompt;
    }
    if (status === 'generating_voxels') {
      return VOXEL_PROMPT;
    }
    return '';
  };

  return (
    <div className="flex h-screen w-full bg-neutral-100 text-slate-900 font-sans overflow-hidden">
        <style>
        {`
          .loading-dots::after {
            content: '';
            animation: dots 2s steps(4, end) infinite;
          }
          @keyframes dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80% { content: '...'; }
          }
        `}
        </style>

        {/* --- LEFT SIDEBAR (FUNCTIONALITY) --- */}
        <aside className="w-96 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-full shadow-xl z-20">
            {/* Branding */}
            <div className="p-6 border-b border-gray-100">
                <h1 className="text-2xl font-black tracking-tighter leading-none">IMAGE TO VOXEL</h1>
                <p className="text-xs font-bold text-gray-400 mt-1 uppercase">Powered by Gemini 3</p>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-6 space-y-8">
                    
                    {/* 1. Input Section */}
                    <div className="space-y-4">
                        <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Create New</label>
                        
                        <div className="relative">
                            <input
                                type="text"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder={SAMPLE_PROMPTS[placeholderIndex]}
                                disabled={isLoading}
                                className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:border-black focus:bg-white focus:outline-none transition-all font-medium text-sm rounded-lg"
                            />
                        </div>

                        <div className="flex gap-2">
                             <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value)}
                                disabled={isLoading}
                                className="w-24 px-2 py-2 bg-gray-50 border-2 border-transparent focus:border-black rounded-lg text-xs font-bold uppercase focus:outline-none"
                            >
                                {ASPECT_RATIOS.map(ratio => (
                                    <option key={ratio} value={ratio}>{ratio}</option>
                                ))}
                            </select>
                            
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isLoading}
                                className="flex-1 bg-gray-50 hover:bg-gray-100 border-2 border-dashed border-gray-300 hover:border-black rounded-lg text-xs font-bold uppercase text-gray-500 hover:text-black transition-all flex items-center justify-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Upload
                            </button>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept={ALLOWED_MIME_TYPES.join(',')} />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer select-none">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={useOptimization}
                                        onChange={(e) => setUseOptimization(e.target.checked)}
                                        disabled={isLoading}
                                    />
                                    <div className={`block w-8 h-5 rounded-full transition-colors ${useOptimization ? 'bg-black' : 'bg-gray-300'}`}></div>
                                    <div className={`dot absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${useOptimization ? 'translate-x-3' : ''}`}></div>
                                </div>
                                <span className="ml-2 text-xs font-bold uppercase text-gray-500">Optimize Prompt</span>
                            </label>
                        </div>

                        <button
                            onClick={handleImageGenerate}
                            disabled={isLoading || !prompt.trim()}
                            className="w-full py-4 bg-black text-white font-bold uppercase text-sm rounded-lg hover:bg-gray-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                        >
                            {status === 'generating_image' ? 'Generating Image...' : 'Generate Image'}
                        </button>
                    </div>

                    <hr className="border-gray-100" />

                    {/* 2. Current Actions (Only if content loaded) */}
                    {imageData && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-500">
                             <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Current Scene</label>
                             <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setViewMode(viewMode === 'image' ? 'voxel' : 'image')}
                                    disabled={isLoading || !voxelCode}
                                    className="px-3 py-2 border-2 border-black bg-white hover:bg-gray-50 text-xs font-bold uppercase rounded-lg transition-all disabled:opacity-30 disabled:border-gray-200"
                                >
                                    {viewMode === 'image' ? 'View Scene' : 'View Image'}
                                </button>
                                <button
                                    onClick={handleDownload}
                                    disabled={isLoading}
                                    className="px-3 py-2 border-2 border-black bg-white hover:bg-gray-50 text-xs font-bold uppercase rounded-lg transition-all disabled:opacity-30"
                                >
                                    Download
                                </button>
                             </div>
                             <button
                                onClick={handleVoxelize}
                                disabled={isLoading}
                                className="w-full py-3 bg-indigo-600 text-white font-bold uppercase text-xs rounded-lg hover:bg-indigo-700 active:scale-[0.98] transition-all shadow-md disabled:opacity-50"
                            >
                                {voxelCode ? 'Regenerate 3D Voxels' : 'Generate 3D Voxels'}
                            </button>
                        </div>
                    )}

                    {/* 3. Voxel Palette */}
                    {voxelStats && viewMode === 'voxel' && (
                        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                            <div className="flex justify-between items-baseline mb-2">
                                <label className="block text-xs font-bold uppercase text-gray-500">Palette</label>
                                <span className="text-[10px] font-bold text-gray-400">{voxelStats.reduce((a,b)=>a+b.count,0)} Blocks</span>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <div className="grid grid-cols-5 gap-2">
                                    {voxelStats.slice(0, 15).map((stat, i) => (
                                        <div key={i} className="group relative flex flex-col items-center">
                                            <div 
                                                className="w-full aspect-square rounded-md shadow-sm border border-black/10" 
                                                style={{ backgroundColor: stat.color }}
                                            />
                                            <span className="text-[9px] font-mono mt-1 text-gray-500">{stat.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <hr className="border-gray-100" />

                    {/* 4. Library / History */}
                    <div className="space-y-4">
                        <label className="block text-xs font-bold uppercase text-gray-500">Library</label>
                        
                        {/* Examples */}
                        <div className="grid grid-cols-3 gap-2">
                            {EXAMPLES.map((ex, idx) => (
                                <button
                                    key={`ex-${idx}`}
                                    onClick={() => handleExampleClick(ex)}
                                    disabled={isLoading}
                                    className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-black transition-all focus:outline-none group"
                                >
                                    {loadedThumbnails[ex.img] && (
                                        <img src={loadedThumbnails[ex.img]} alt="Example" className="w-full h-full object-cover" />
                                    )}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all" />
                                </button>
                            ))}
                        </div>

                        {/* User History */}
                        {history.length > 0 && (
                            <div className="space-y-2 mt-4">
                                <div className="text-[10px] font-bold uppercase text-gray-400">Recent Generations</div>
                                <div className="grid grid-cols-1 gap-2">
                                    {history.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleHistoryClick(item)}
                                            disabled={isLoading}
                                            className={`flex items-center gap-3 p-2 rounded-lg text-left transition-all border border-transparent ${selectedHistoryId === item.id ? 'bg-gray-100 border-gray-200' : 'hover:bg-gray-50'}`}
                                        >
                                            <div className="w-10 h-10 rounded-md overflow-hidden bg-gray-200 flex-shrink-0">
                                                <img src={item.image} alt="" className="w-full h-full object-cover" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold truncate">{item.prompt || "Untitled"}</div>
                                                <div className="text-[10px] text-gray-400 flex items-center gap-2">
                                                    <span>{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    {item.voxel && <span className="bg-indigo-100 text-indigo-700 px-1 rounded-sm">VOXEL</span>}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </aside>

        {/* --- RIGHT MAIN AREA (VIEWER) --- */}
        <main className="flex-1 h-full relative p-4 sm:p-6 bg-gray-50/50 flex flex-col">
            
            <div className="flex-1 w-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative flex flex-col items-center justify-center">
                
                {/* Loading / Thinking Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 z-30 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-300">
                        <div className="w-16 h-16 border-4 border-black border-t-transparent rounded-full animate-spin mb-8"></div>
                        <h2 className="text-2xl font-black mb-4">
                            {status === 'generating_image' ? 'DREAMING IMAGE...' : 'CONSTRUCTING VOXELS...'}
                        </h2>
                        
                        <div className="max-w-xl font-mono text-xs text-gray-500 bg-gray-50 p-4 rounded-lg border border-gray-200 w-full text-left max-h-64 overflow-y-auto">
                            <div className="mb-2 font-bold text-black border-b border-gray-200 pb-2">
                                {status === 'generating_image' ? 'Gemini 2.5 Flash Image' : 'Gemini 3 Pro'}
                            </div>
                            <p className="whitespace-pre-wrap">
                                {getDisplayPrompt()}
                            </p>
                            {thinkingText && (
                                <div className="mt-4 pt-4 border-t border-gray-200 text-indigo-600">
                                    <span className="font-bold mr-2">Thinking:</span>
                                    {thinkingText}
                                    <span className="loading-dots"></span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* Empty State */}
                {!imageData && !isLoading && (
                    <div className="text-center p-12 opacity-40">
                        <div className="w-32 h-32 bg-gray-100 rounded-full mx-auto mb-6 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Create</h3>
                        <p className="max-w-xs mx-auto">Select an example from the left sidebar or create your own voxel masterpiece.</p>
                    </div>
                )}

                {/* Content Viewer */}
                {imageData && !isLoading && (
                    <>
                        {viewMode === 'image' && (
                             <img 
                                src={imageData} 
                                alt="Source" 
                                className="w-full h-full object-contain p-4" 
                             />
                        )}
                        {viewMode === 'voxel' && voxelCode && (
                            <iframe
                                title="Voxel Scene"
                                srcDoc={voxelCode}
                                className="w-full h-full border-0"
                                sandbox="allow-scripts allow-same-origin allow-popups"
                            />
                        )}
                    </>
                )}
                
                {/* Error Overlay */}
                {errorMsg && (
                     <div className="absolute inset-x-0 bottom-0 p-4 bg-red-50 border-t border-red-200 flex items-center justify-between text-red-700 animate-in slide-in-from-bottom-2">
                        <div className="flex items-center gap-3">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <span className="font-bold text-sm">{errorMsg}</span>
                        </div>
                        <button onClick={() => setErrorMsg('')} className="p-1 hover:bg-red-100 rounded">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                        </button>
                     </div>
                )}
            </div>
            
            {/* Attribution Footer */}
            <div className="mt-4 flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <div>Model: Gemini 2.5 Flash Image & Gemini 3 Pro</div>
                <div>Frontend: React & Three.js</div>
            </div>

        </main>
    </div>
  );
};

export default App;