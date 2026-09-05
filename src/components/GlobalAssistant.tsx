import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';
import { Sparkles, MessageSquare, X, Send, Loader2, Scale, RotateCcw, HelpCircle, ChevronUp, Bot, ShieldCheck, FolderCheck, Move, GripHorizontal, MousePointer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { askJusticeFlowHelp } from '../services/gemini';

interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const DEFAULT_WELCOME = `⚖️ **JusticeFlow Judicial AI Guide Activated**

I am your omnipresent assistant accessible anywhere on this portal. If you have any doubts about:
- 🚀 **Initializing Evidence**: How to upload files, name exhibits, and launch AI forensic audits.
- 🏆 **Case Completion**: How the "Case Completed" button saves files into **Completed Cases**.
- 🔍 **Forensic Checking**: How authenticity scores, AI probability, and document integrity work.
- 📑 **Summarizing Cases**: How to cross-examine and summarize multiple uploaded exhibits.

*Click any question below or type your doubt directly!*`;

export default function GlobalAssistant() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  
  // Drag controls & coordinates
  const dragControls = useDragControls();
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false);

  const initialPos = (() => {
    try {
      const saved = localStorage.getItem('justiceflow_guide_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.x === 'number' && !isNaN(parsed.x) &&
          typeof parsed.y === 'number' && !isNaN(parsed.y) &&
          Math.abs(parsed.x) < 2000 &&
          Math.abs(parsed.y) < 2000
        ) {
          return parsed;
        }
      }
    } catch (e) {}
    return { x: 0, y: 0 };
  })();

  const x = useMotionValue(initialPos.x || 0);
  const y = useMotionValue(initialPos.y || 0);

  const [dragBounds, setDragBounds] = useState({
    left: -Math.max(window.innerWidth - 440, 200),
    right: 20,
    top: -Math.max(window.innerHeight - 200, 200),
    bottom: 20,
  });

  useEffect(() => {
    const updateBounds = () => {
      setDragBounds({
        left: -Math.max(window.innerWidth - 440, 200),
        right: 20,
        top: -Math.max(window.innerHeight - 200, 200),
        bottom: 20,
      });
    };
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  const [messages, setMessages] = useState<HelpMessage[]>(() => {
    try {
      const cached = localStorage.getItem('justiceflow_global_help_messages');
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
    } catch (e) {}
    return [{
      id: 'welcome',
      role: 'assistant',
      content: DEFAULT_WELCOME,
      timestamp: new Date()
    }];
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('justiceflow_global_help_messages', JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  const handleSend = async (queryText?: string) => {
    const text = (queryText || input).trim();
    if (!text || isLoading) return;

    const userMsg: HelpMessage = {
      id: 'usr_' + Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInput('');
    setIsLoading(true);

    try {
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const response = await askJusticeFlowHelp(text, history);

      const asstMsg: HelpMessage = {
        id: 'asst_' + Date.now(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, asstMsg]);
    } catch (err: any) {
      const errorMsg: HelpMessage = {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: `**Notice**: Could not connect to live guidance engine. Here is quick help:\n\n- To **initialize evidence**, open a case and click "Initialize Evidence Stream".\n- To **complete a case**, click "Case Completed" in the toolbar.\n- For forensic checking, look at the "Visual Forensic Audit" tab.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    const reset = [{
      id: 'welcome_' + Date.now(),
      role: 'assistant' as const,
      content: DEFAULT_WELCOME,
      timestamp: new Date()
    }];
    setMessages(reset);
    localStorage.removeItem('justiceflow_global_help_messages');
  };

  const handleResetPosition = (e: React.MouseEvent) => {
    e.stopPropagation();
    x.set(0);
    y.set(0);
    try {
      localStorage.removeItem('justiceflow_guide_pos');
    } catch (err) {}
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    try {
      localStorage.setItem('justiceflow_guide_pos', JSON.stringify({ x: x.get(), y: y.get() }));
    } catch (err) {}
  };

  const handleOpenGuide = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsOpen(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const quickQuestions = [
    { label: "🚀 Initializing Evidence", query: "How do I initialize an evidence stream?" },
    { label: "🏆 Case Completion", query: "How does marking a case as completed work and where is it saved?" },
    { label: "🔍 Forensic Checking", query: "How does forensic checking and AI authenticity detection work?" },
    { label: "📑 Summarize Files", query: "How do I summarize all files uploaded in a case?" }
  ];

  return (
    <motion.div
      style={{ x, y }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.06}
      dragConstraints={dragBounds}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`fixed bottom-6 right-6 z-[100] ${isDragging ? 'cursor-grabbing select-none' : ''}`}
    >
      {/* Floating Trigger Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleOpenGuide}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="group relative flex items-center gap-2 pl-2 pr-4 py-2.5 rounded-2xl bg-gradient-to-r from-brand-primary via-indigo-950 to-brand-deep text-white shadow-2xl shadow-brand-primary/40 border border-brand-accent/40 hover:border-brand-accent transition-all cursor-pointer select-none"
            title="Ask JusticeFlow AI Guide • Click to open or drag with mouse"
          >
            {/* Interactive Mouse-Follower Glow Effect */}
            {isHovered && (
              <span
                className="pointer-events-none absolute -inset-px rounded-2xl opacity-60 transition-opacity duration-200"
                style={{
                  background: `radial-gradient(100px circle at ${mousePos.x}px ${mousePos.y}px, rgba(245, 158, 11, 0.35), transparent 80%)`,
                }}
              />
            )}

            {/* Active Dragging Indicator Badge */}
            {isDragging && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute -top-8 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-brand-deep/95 border border-brand-accent/70 text-brand-accent text-[9px] font-mono font-bold shadow-xl flex items-center gap-1.5 whitespace-nowrap pointer-events-none backdrop-blur-md"
              >
                <Move className="w-2.5 h-2.5 text-amber-300 animate-spin" />
                <span>Moving with mouse</span>
              </motion.div>
            )}

            {/* Animated Glow Ping */}
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 pointer-events-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-brand-accent"></span>
            </span>

            {/* Dedicated Movable Cursor Handle */}
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                dragControls.start(e);
              }}
              className="p-1.5 rounded-xl bg-surface/50 hover:bg-brand-accent/20 text-brand-accent/80 hover:text-brand-accent cursor-grab active:cursor-grabbing transition-colors flex items-center justify-center border border-border-main/50 shadow-sm"
              title="Movable Handle: Hold and move with mouse anywhere"
            >
              <Move className="w-3.5 h-3.5 text-amber-300" />
            </div>

            {/* Clickable Area to Open Guide */}
            <div 
              onClick={handleOpenGuide}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div className="w-8 h-8 rounded-xl bg-brand-accent/20 border border-brand-accent/40 flex items-center justify-center text-brand-accent shrink-0">
                <Sparkles className="w-4 h-4 text-amber-300" />
              </div>

              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-text-main group-hover:text-brand-accent transition-colors">
                    Ask AI Guide
                  </span>
                  <span className="text-[8px] px-1 py-0.5 rounded-md bg-brand-accent/20 text-brand-accent font-bold uppercase tracking-wider">
                    Movable
                  </span>
                </div>
                <p className="text-[9px] text-text-muted">Drag to move • Click to ask</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Interactive Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.94 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-[92vw] sm:w-[430px] h-[580px] max-h-[82vh] glass-card rounded-3xl border border-brand-accent/30 shadow-2xl flex flex-col overflow-hidden bg-brand-deep/95 backdrop-blur-xl"
          >
            {/* Header with Movable Cursor Grip Bar */}
            <div className="p-3.5 border-b border-border-main flex items-center justify-between bg-surface/60 gap-2">
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="w-8 h-8 rounded-xl bg-brand-accent/15 border border-brand-accent/40 flex items-center justify-center text-brand-accent shadow-inner">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-black uppercase tracking-wider text-text-main">JusticeFlow AI</h3>
                    <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] font-bold uppercase tracking-wider">
                      Online
                    </span>
                  </div>
                  <p className="text-[9px] text-text-muted">Guide for initialization, completion & checks</p>
                </div>
              </div>

              {/* Movable Cursor Handle in Header */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-surface/80 hover:bg-brand-accent/15 border border-border-main hover:border-brand-accent/50 text-[9px] font-semibold text-text-muted hover:text-brand-accent cursor-grab active:cursor-grabbing transition-all select-none shadow-sm"
                title="Click and hold to move the AI Guide anywhere with your mouse"
              >
                <Move className="w-3 h-3 text-amber-300 animate-pulse" />
                <span className="hidden sm:inline">Move</span>
                <GripHorizontal className="w-3 h-3 opacity-60" />
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleResetPosition}
                  title="Reset window position to corner"
                  className="p-1.5 rounded-lg text-text-muted hover:text-amber-300 hover:bg-surface/80 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsOpen(false)}
                  title="Close assistant"
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            {/* Quick Suggestions Bar */}
            <div className="p-2.5 border-b border-border-main/60 bg-surface/30 flex gap-1.5 overflow-x-auto no-scrollbar">
              {quickQuestions.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(q.query)}
                  disabled={isLoading}
                  className="px-2.5 py-1 rounded-lg bg-surface hover:bg-brand-accent/15 border border-border-main hover:border-brand-accent/40 text-[9px] font-semibold text-text-muted hover:text-brand-accent whitespace-nowrap transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 no-scrollbar text-xs">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-lg bg-brand-accent/20 border border-brand-accent/40 flex items-center justify-center shrink-0 text-brand-accent mt-0.5">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-sm ${
                      m.role === 'user'
                        ? 'bg-brand-primary text-white ml-auto'
                        : 'bg-surface/80 border border-border-main text-text-main'
                    }`}
                  >
                    <div className="prose prose-invert prose-xs max-w-none [&>p]:mb-2 [&>ul]:list-disc [&>ul]:ml-4 [&>ol]:list-decimal [&>ol]:ml-4 [&>blockquote]:border-l-2 [&>blockquote]:border-brand-accent [&>blockquote]:pl-2 [&>blockquote]:italic [&>h3]:text-[11px] [&>h3]:font-bold [&>h3]:text-brand-accent [&>h3]:mb-1.5">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                    <span className="block text-[8px] text-text-muted/70 text-right mt-1.5">
                      {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </motion.div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2 text-text-muted text-[11px] p-2 bg-surface/40 rounded-xl w-fit">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-accent" />
                  <span>Consulting Judicial Guide...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="p-3 border-t border-border-main bg-surface/50 flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask doubt about initializing, completion, checking..."
                disabled={isLoading}
                className="flex-1 bg-surface border border-border-main focus:border-brand-accent rounded-xl px-3.5 py-2.5 text-xs text-text-main placeholder:text-text-muted outline-none transition-all"
              />
              <motion.button
                type="submit"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!input.trim() || isLoading}
                className="p-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-white disabled:opacity-40 transition-all shadow-md cursor-pointer shrink-0"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </motion.button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
