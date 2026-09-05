import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, MessageSquare, X, Send, Loader2, Scale, RotateCcw, HelpCircle, ChevronUp, Bot, ShieldCheck, FolderCheck } from 'lucide-react';
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

  const quickQuestions = [
    { label: "🚀 Initializing Evidence", query: "How do I initialize an evidence stream?" },
    { label: "🏆 Case Completion", query: "How does marking a case as completed work and where is it saved?" },
    { label: "🔍 Forensic Checking", query: "How does forensic checking and AI authenticity detection work?" },
    { label: "📑 Summarize Files", query: "How do I summarize all files uploaded in a case?" }
  ];

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      {/* Floating Trigger Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-brand-primary via-indigo-950 to-brand-deep text-white shadow-2xl shadow-brand-primary/40 border border-brand-accent/40 hover:border-brand-accent transition-all cursor-pointer"
            title="Ask JusticeFlow AI about website features, evidence initialization, checking, or completion"
          >
            {/* Animated Glow Ping */}
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-brand-accent"></span>
            </span>

            <div className="w-8 h-8 rounded-xl bg-brand-accent/20 border border-brand-accent/40 flex items-center justify-center text-brand-accent">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-text-main group-hover:text-brand-accent transition-colors">
                  Ask AI Guide
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-brand-accent/20 text-brand-accent font-bold uppercase">
                  Anywhere
                </span>
              </div>
              <p className="text-[9px] text-text-muted">Doubts? Inquire here</p>
            </div>
          </motion.button>
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
            className="w-[92vw] sm:w-[420px] h-[580px] max-h-[82vh] glass-card rounded-3xl border border-brand-accent/30 shadow-2xl flex flex-col overflow-hidden bg-brand-deep/95 backdrop-blur-xl"
          >
            {/* Header */}
            <div className="p-4 border-b border-border-main flex items-center justify-between bg-surface/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-accent/15 border border-brand-accent/40 flex items-center justify-center text-brand-accent shadow-inner">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-text-main">JusticeFlow AI Guide</h3>
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] font-bold uppercase tracking-wider">
                      Online
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted">Instant help for initialization, completion & checking</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleClearHistory}
                  title="Clear chat history"
                  className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/80 transition-colors"
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
    </div>
  );
}
