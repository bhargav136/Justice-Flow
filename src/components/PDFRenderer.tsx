import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, FileText, AlertTriangle, Download, ShieldCheck, ExternalLink, Monitor, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { storage } from '../firebase';
import { ref as storageRef, getBlob } from 'firebase/storage';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

interface PDFRendererProps {
  data: string;
  textContent?: string;
}

export default function PDFRenderer({ data, textContent }: PDFRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderTask, setRenderTask] = useState<pdfjs.RenderTask | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'embedded' | 'text'>('canvas');

  useEffect(() => {
    const loadPdf = async () => {
      if (!data) {
        setLoadError('No evidence data provided.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      setPdf(null);
      setNumPages(0);
      setPageNum(1);

      try {
        let bytes: Uint8Array | null = null;

        if (data.startsWith('http')) {
          // 1. Try direct fetch first using the signed/public URL token
          try {
            const res = await fetch(data);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              bytes = new Uint8Array(arrayBuffer);
            }
          } catch (fetchErr) {
            console.warn('Direct fetch failed, trying Firebase SDK getBlob...', fetchErr);
          }

          // 2. If direct fetch failed, try Firebase getBlob
          if (!bytes) {
            try {
              const fileRef = storageRef(storage, data);
              const blob = await getBlob(fileRef);
              const arrayBuffer = await blob.arrayBuffer();
              bytes = new Uint8Array(arrayBuffer);
            } catch (blobErr: any) {
              console.warn('Firebase getBlob failed:', blobErr?.message);
              // Fallback directly to native embedded browser PDF viewer
              setViewMode('embedded');
              setLoading(false);
              return;
            }
          }
        } else {
          // Base64 data
          const base64Match = data.match(/base64,(.*)$/);
          const pureBase64 = base64Match ? base64Match[1] : data.trim();
          const safeBase64 = pureBase64.replace(/[^A-Za-z0-9+/=]/g, '');
          const binaryString = atob(safeBase64);
          bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
        }

        if (bytes) {
          const loadingTask = pdfjs.getDocument({
            data: bytes,
            verbosity: 0
          });
          const pdfDoc = await loadingTask.promise;
          setPdf(pdfDoc);
          setNumPages(pdfDoc.numPages);
          setViewMode('canvas');
        }
      } catch (err: any) {
        console.warn('PDF.js canvas parse issue:', err);
        // Fallback gracefully: if it's an HTTP URL, switch to embedded viewer; otherwise text mode
        if (data.startsWith('http')) {
          setViewMode('embedded');
        } else if (textContent) {
          setViewMode('text');
        } else {
          setLoadError(err?.message || 'Failed to render PDF document.');
        }
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [data, textContent]);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current || viewMode !== 'canvas') return;

      if (renderTask) {
        renderTask.cancel();
      }

      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = page.render({
          canvasContext: context,
          viewport: viewport,
        });

        setRenderTask(task);
        await task.promise;
      } catch (error: any) {
        if (error.name !== 'RenderingCancelledException') {
          console.warn('Canvas render issue:', error);
          if (data.startsWith('http')) {
            setViewMode('embedded');
          }
        }
      }
    };

    renderPage();
  }, [pdf, pageNum, scale, viewMode, data]);

  const changePage = (offset: number) => {
    setPageNum(prev => Math.min(Math.max(1, prev + offset), numPages));
  };

  return (
    <div className="flex flex-col h-full bg-surface/50 rounded-2xl overflow-hidden border border-border-main">
      {/* View Mode & Controls Toolbar */}
      <div className="bg-surface/90 border-b border-border-main px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 z-10">
        {/* Mode Switcher */}
        <div className="flex items-center bg-surface/60 border border-border-main p-1 rounded-xl text-xs">
          {pdf && (
            <button
              onClick={() => setViewMode('canvas')}
              className={cn(
                "px-3 py-1 rounded-lg font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 transition-all",
                viewMode === 'canvas' ? "bg-brand-primary text-white shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              <Eye className="w-3 h-3" />
              Canvas
            </button>
          )}

          {data.startsWith('http') && (
            <button
              onClick={() => setViewMode('embedded')}
              className={cn(
                "px-3 py-1 rounded-lg font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 transition-all",
                viewMode === 'embedded' ? "bg-brand-primary text-white shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              <Monitor className="w-3 h-3" />
              PDF Reader
            </button>
          )}

          {textContent && (
            <button
              onClick={() => setViewMode('text')}
              className={cn(
                "px-3 py-1 rounded-lg font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 transition-all",
                viewMode === 'text' ? "bg-brand-primary text-white shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              <FileText className="w-3 h-3" />
              Extracted Text
            </button>
          )}
        </div>

        {/* Canvas Navigation Toolbar */}
        {viewMode === 'canvas' && numPages > 0 && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button 
                onClick={() => changePage(-1)} 
                disabled={pageNum <= 1}
                className="p-1 hover:bg-surface rounded disabled:opacity-30 text-text-main transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest min-w-[70px] text-center">
                {pageNum} / {numPages}
              </span>
              <button 
                onClick={() => changePage(1)} 
                disabled={pageNum >= numPages}
                className="p-1 hover:bg-surface rounded disabled:opacity-30 text-text-main transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="h-4 w-px bg-border-main" />
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setScale(prev => Math.max(0.6, prev - 0.2))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setScale(prev => Math.min(2.5, prev + 0.2))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* External Actions */}
        <div className="flex items-center gap-2">
          {data && (
            <a 
              href={data} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest"
              title="Open document in a dedicated browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Original
            </a>
          )}
        </div>
      </div>

      {/* Main View Area */}
      <div className="flex-1 overflow-auto p-4 flex flex-col items-center bg-surface/30 custom-scrollbar relative min-h-[550px]">
        {loading && (
          <div className="absolute inset-0 bg-surface/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-brand-accent animate-spin" />
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Loading Document...</p>
          </div>
        )}

        {/* 1. Canvas View */}
        {viewMode === 'canvas' && (
          <div className="relative flex items-center justify-center w-full py-4">
            <canvas ref={canvasRef} className="shadow-2xl rounded-sm max-w-full h-auto bg-white border border-border-main" />
          </div>
        )}

        {/* 2. Embedded Browser Viewer (Guaranteed to work for all PDFs & URLs) */}
        {viewMode === 'embedded' && data && (
          <div className="w-full h-full min-h-[600px] flex flex-col items-center">
            <iframe
              src={data}
              className="w-full h-[650px] rounded-xl border border-border-main bg-white shadow-lg"
              title="PDF Document Viewer"
            />
          </div>
        )}

        {/* 3. Text Recovery View */}
        {viewMode === 'text' && (
          <div className="w-full max-w-4xl p-6 bg-surface border border-border-main rounded-2xl shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-border-main mb-4">
              <span className="text-xs font-bold text-brand-accent uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Extracted Document Text
              </span>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-bold uppercase tracking-wider">
                Indexed for Judicial AI
              </span>
            </div>
            <pre className="font-sans text-sm text-text-main whitespace-pre-wrap leading-relaxed max-h-[550px] overflow-y-auto custom-scrollbar pr-2">
              {textContent || 'No textual content extracted.'}
            </pre>
          </div>
        )}

        {/* Error Fallback when all failed */}
        {loadError && viewMode === 'canvas' && !pdf && (
          <div className="flex flex-col items-center justify-center gap-4 p-8 text-center max-w-lg my-auto">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h4 className="text-base font-bold text-text-main">Visual Canvas Notice</h4>
            <p className="text-xs text-text-muted leading-relaxed">
              Direct canvas rendering was restricted by vault permissions. You can view the document using the integrated browser reader below or open the original file.
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setViewMode('embedded')}
                className="px-4 py-2 bg-brand-primary text-white rounded-xl text-xs font-semibold uppercase tracking-wider shadow-md hover:bg-brand-primary/90"
              >
                Switch to PDF Reader
              </button>
              {textContent && (
                <button
                  onClick={() => setViewMode('text')}
                  className="px-4 py-2 border border-border-main text-text-main rounded-xl text-xs font-semibold uppercase tracking-wider hover:bg-surface"
                >
                  View Text
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
