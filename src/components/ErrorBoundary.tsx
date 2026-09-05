import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-brand-deep flex items-center justify-center p-4 font-sans">
          <div className="glass-card p-12 rounded-[2.5rem] max-w-md w-full text-center space-y-8 border border-white/5 shadow-2xl">
            <div className="bg-red-500/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white tracking-tight">System Integrity Breach</h2>
              <p className="text-slate-400 text-sm leading-relaxed font-medium">{errorMessage}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-brand-accent text-brand-deep font-bold uppercase tracking-widest text-xs py-4 px-8 rounded-2xl hover:bg-brand-accent/80 transition-all flex items-center justify-center gap-3 shadow-lg shadow-brand-accent/20"
            >
              <RefreshCcw className="w-4 h-4" />
              Reinitialize Portal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
