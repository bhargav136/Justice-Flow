import React from 'react';
import PDFRenderer from './PDFRenderer';
import { AlertCircle, FileText } from 'lucide-react';

interface DocumentPreviewProps {
  fileUrl: string;
  type: string;
  fileName: string;
  textContent?: string;
  previewUrl?: string | null;
}

export default function DocumentPreview({ fileUrl, type, fileName, textContent, previewUrl }: DocumentPreviewProps) {
  const [imageError, setImageError] = React.useState(false);

  if (type.startsWith('image/')) {
    const displayUrl = previewUrl || fileUrl;
    
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        {displayUrl && !imageError ? (
          <img 
            src={displayUrl} 
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-border-main"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="text-center bg-surface/50 p-12 rounded-3xl border border-dashed border-border-main">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-text-muted text-xs font-bold uppercase tracking-widest">
              {imageError ? 'Security Block or Load Error' : 'Awaiting Image Stream'}
            </p>
            <p className="text-[10px] text-text-muted mt-2 max-w-[200px] mx-auto leading-relaxed">
              Chrome may block large blob previews. Try refreshing or re-uploading if the issue persists.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (type === 'application/pdf') {
    return (
      <div className="flex-1 w-full h-full">
        <PDFRenderer data={fileUrl} textContent={textContent} />
      </div>
    );
  }

  return (
    <div className="bg-surface/50 p-10 shadow-sm border border-border-main min-h-full rounded-xl font-serif text-base leading-relaxed text-text-main whitespace-pre-wrap selection:bg-brand-accent/30 overflow-y-auto">
      {textContent || fileUrl}
    </div>
  );
}
