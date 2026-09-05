import * as React from 'react';
const { useState, useEffect, useRef } = React;
import { useTranslation } from 'react-i18next';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, getDoc, orderBy, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Case, Document, Analysis, ChatMessage } from '../types';
import { ArrowLeft, Upload, FileText, Send, Loader2, Download, AlertCircle, CheckCircle2, MessageSquare, BarChart3, History, Scale, ShieldCheck, Info, Key, X, Sparkles, Square, CheckSquare, Save, FolderCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeLegalDocument, chatWithCase, getGeminiApiKey, setGeminiApiKey, fallbackJudicialAnalysis } from '../services/gemini';
import ReactMarkdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import DocumentPreview from './DocumentPreview';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CaseViewProps {
  caseId: string;
  onBack: () => void;
}

export default function CaseView({ caseId, onBack }: CaseViewProps) {
  const { t } = useTranslation();
  const [caseData, setCaseData] = useState<Case | null>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_data_${caseId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  });
  const [documents, setDocuments] = useState<Document[]>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_docs_${caseId}`);
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });
  const [activeDoc, setActiveDoc] = useState<Document | null>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_activedoc_${caseId}`);
      if (cached) return JSON.parse(cached);
      const docsCached = localStorage.getItem(`justiceflow_case_docs_${caseId}`);
      if (docsCached) {
        const parsed = JSON.parse(docsCached);
        if (parsed.length > 0) return parsed[0];
      }
      return null;
    } catch (e) {
      return null;
    }
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_analysis_${caseId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_chats_${caseId}`);
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'legal_points' | 'timeline' | 'authenticity'>('summary');
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getGeminiApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedTitle, setStagedTitle] = useState('');
  const [isSavingToCase, setIsSavingToCase] = useState(false);
  const [caseSavedNotification, setCaseSavedNotification] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzingDocId = useRef<string | null>(null);

  const effectiveDocuments = documents.length > 0 ? documents : (activeDoc ? [activeDoc] : []);

  // Continuous sync to localStorage for instant recovery & persistence across navigation
  useEffect(() => {
    if (caseData) {
      try {
        localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(caseData));
      } catch (e) {}
    }
  }, [caseData, caseId]);

  useEffect(() => {
    if (documents.length > 0) {
      try {
        localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify(documents));
      } catch (e) {}
    }
  }, [documents, caseId]);

  useEffect(() => {
    if (activeDoc) {
      try {
        localStorage.setItem(`justiceflow_case_activedoc_${caseId}`, JSON.stringify(activeDoc));
      } catch (e) {}
    }
  }, [activeDoc, caseId]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      try {
        localStorage.setItem(`justiceflow_case_chats_${caseId}`, JSON.stringify(chatMessages));
      } catch (e) {}
    }
  }, [chatMessages, caseId]);

  useEffect(() => {
    if (analysis) {
      try {
        localStorage.setItem(`justiceflow_case_analysis_${caseId}`, JSON.stringify(analysis));
      } catch (e) {}
    }
  }, [analysis, caseId]);

  useEffect(() => {
    const fetchCase = async () => {
      try {
        const docRef = doc(db, 'cases', caseId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setCaseData({ id: docSnap.id, ...docSnap.data() } as Case);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `cases/${caseId}`);
      }
    };
    fetchCase();

    const qDocs = query(collection(db, 'documents'), where('caseId', '==', caseId));
    const unsubDocs = onSnapshot(qDocs, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
      setDocuments(prev => {
        const map = new Map<string, Document>();
        prev.forEach(d => map.set(d.id || d.fileName, d));
        docs.forEach(d => map.set(d.id || d.fileName, d));
        if (activeDoc) {
          map.set(activeDoc.id || activeDoc.fileName, activeDoc);
        }
        const mergedList = Array.from(map.values());
        return mergedList.length > 0 ? mergedList : prev;
      });
      if (!activeDoc) {
        if (docs.length > 0) {
          setActiveDoc(docs[0]);
        } else {
          try {
            const cachedActive = localStorage.getItem(`justiceflow_case_activedoc_${caseId}`);
            if (cachedActive) setActiveDoc(JSON.parse(cachedActive));
          } catch (e) {}
        }
      }
    }, (error) => {
      console.warn('Documents listener notice:', error);
    });

    return unsubDocs;
  }, [caseId]);

  useEffect(() => {
    if (activeDoc) {
      setDocuments(prev => {
        const exists = prev.some(d => d.id === activeDoc.id || d.fileName === activeDoc.fileName);
        return exists ? prev : [activeDoc, ...prev];
      });
      if (!analysis && !analyzingDocId.current && (activeDoc.textContent || activeDoc.fileUrl)) {
        handleAnalyze(activeDoc, activeDoc.textContent || activeDoc.fileUrl, []);
      }
    }
  }, [activeDoc]);

  const handleToggleCaseStatus = async () => {
    if (!caseData) return;
    const newStatus = caseData.status === 'closed' ? 'open' : 'closed';
    const isNowCompleted = newStatus === 'closed';
    try {
      await updateDoc(doc(db, 'cases', caseId), { 
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      const updatedCase = { ...caseData, status: newStatus };
      setCaseData(updatedCase);
      try {
        localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(updatedCase));
        if (documents.length > 0) {
          localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify(documents));
        } else if (activeDoc) {
          localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify([activeDoc]));
        }
        if (activeDoc) {
          localStorage.setItem(`justiceflow_case_activedoc_${caseId}`, JSON.stringify(activeDoc));
        }
        if (chatMessages.length > 0) {
          localStorage.setItem(`justiceflow_case_chats_${caseId}`, JSON.stringify(chatMessages));
        }
        if (analysis) {
          localStorage.setItem(`justiceflow_case_analysis_${caseId}`, JSON.stringify(analysis));
        }
      } catch (e) {}

      if (isNowCompleted) {
        setCaseSavedNotification(`🏆 Case "${caseData.title}" marked as Completed & saved in Completed Cases!`);
        const totalDocsCount = documents.length > 0 ? documents.length : (activeDoc ? 1 : 0);
        const completionMsg: ChatMessage = {
          id: 'asst_completed_' + Date.now(),
          documentId: activeDoc?.id || 'case_' + caseId,
          role: 'assistant',
          content: `🏆 **Case Marked as Completed & Saved**: The judicial proceedings for **"${caseData.title}"** have been marked as completed.\n\nAll evidence exhibits (${totalDocsCount} file${totalDocsCount === 1 ? '' : 's'}), forensic analysis, and audit trails are secured in **Completed Cases**.\n\nYou can review this case file at any time from the Dashboard under **Completed Cases**.`,
          userId: auth.currentUser?.uid || 'demo-judge-001',
          createdAt: new Date()
        } as ChatMessage;

        setChatMessages(prev => [...prev, completionMsg]);
        if (activeDoc) {
          try {
            await addDoc(collection(db, 'chats'), {
              documentId: activeDoc.id,
              role: 'assistant',
              content: completionMsg.content,
              userId: auth.currentUser?.uid || 'demo-judge-001',
              createdAt: serverTimestamp()
            });
          } catch (e) {}
        }
      } else {
        setCaseSavedNotification(`🔄 Case "${caseData.title}" status updated to In Progress.`);
      }
      setTimeout(() => setCaseSavedNotification(null), 5000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `cases/${caseId}`);
    }
  };

  useEffect(() => {
    if (!activeDoc) {
      setPreviewUrl(null);
      return;
    }

    // Create Blob URL for preview (Images only)
    const createPreview = async () => {
      try {
        if (activeDoc.fileUrl && (activeDoc.type.startsWith('image/') || activeDoc.type === 'application/pdf')) {
          // If it's a URL (Firebase Storage), use it directly.
          if (activeDoc.fileUrl.startsWith('http')) {
            setPreviewUrl(activeDoc.fileUrl);
          } else if (activeDoc.type.startsWith('image/')) {
            // If it's still base64 (old data), decode it.
            const base64Data = activeDoc.fileUrl.includes('base64,') 
              ? activeDoc.fileUrl.split('base64,')[1] 
              : activeDoc.fileUrl;
            
            try {
              // Try fetch first
              try {
                const response = await fetch(`data:${activeDoc.type || 'image/png'};base64,${base64Data}`);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);
              } catch (fetchErr) {
                // Fallback to atob
                const safeBase64 = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
                const byteCharacters = atob(safeBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: activeDoc.type || 'image/png' });
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);
              }
            } catch (e) {
              console.error('Failed to create preview URL:', e);
              setPreviewUrl(null);
            }
          }
        }
      } catch (e) {
        console.error('Failed to create preview URL:', e);
        setPreviewUrl(null);
      }
    };
    createPreview();

    const qAnalysis = query(collection(db, 'analyses'), where('documentId', '==', activeDoc.id));
    const unsubAnalysis = onSnapshot(qAnalysis, (snapshot) => {
      if (!snapshot.empty) {
        setAnalysis({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Analysis);
      } else {
        // If analysis missing from Firestore and not currently analyzing, trigger analysis
        if (!analysis && !analyzingDocId.current && (activeDoc.textContent || activeDoc.fileUrl)) {
          handleAnalyze(activeDoc, activeDoc.textContent || activeDoc.fileUrl, []);
        }
      }
    }, (error) => {
      console.warn('Analysis listener notice:', error);
    });

    const qChat = query(collection(db, 'chats'), where('documentId', '==', activeDoc.id));
    const unsubChat = onSnapshot(qChat, (snapshot) => {
      if (!snapshot.empty) {
        const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
        setChatMessages(prev => {
          const map = new Map<string, ChatMessage>();
          prev.forEach(m => map.set(m.id || `${m.role}_${m.content.slice(0, 30)}`, m));
          msgs.forEach(m => map.set(m.id || `${m.role}_${m.content.slice(0, 30)}`, m));
          return Array.from(map.values()).sort((a, b) => {
            const timeA = (a.createdAt as any)?.seconds || ((a.createdAt as any)?.toDate ? (a.createdAt as any).toDate().getTime() / 1000 : (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0));
            const timeB = (b.createdAt as any)?.seconds || ((b.createdAt as any)?.toDate ? (b.createdAt as any).toDate().getTime() / 1000 : (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0));
            return timeA - timeB;
          });
        });
      }
    }, (error) => {
      console.warn('Chats listener notice:', error);
    });

    return () => {
      unsubAnalysis();
      unsubChat();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [activeDoc]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleFileSelectedForStaging = (file: File) => {
    if (file.size > 750 * 1024) {
      alert(t('case.uploadLimit') || 'Evidence file is too large for the secure vault (Max 750KB).');
      return;
    }
    setStagedFile(file);
    setStagedTitle(file.name.replace(/\.[^/.]+$/, ''));
    setShowUploadModal(true);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    handleFileSelectedForStaging(file);
  };

  const handleSaveStagedFileToCase = async () => {
    if (!stagedFile) return;
    const file = stagedFile;
    const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
    const displayName = stagedTitle.trim()
      ? (stagedTitle.includes('.') ? stagedTitle.trim() : (ext ? `${stagedTitle.trim()}.${ext}` : stagedTitle.trim()))
      : file.name;

    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';

    setIsSavingToCase(true);
    setIsUploading(true);
    setUploadError(null);
    setUploadStatusMsg(`Scanning and securing "${displayName}" into Case File...`);

    try {
      let analysisContent = '';
      let base64Data = '';
      let images: { data: string, mimeType: string }[] = [];

      if (file.type === 'application/pdf') {
        setUploadStatusMsg(`Extracting legal text from ${displayName}...`);
        const arrayBuffer = await file.arrayBuffer();
        
        // Get base64 for preview
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });
        base64Data = await base64Promise;

        // Extract text for analysis safely
        try {
          const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += `[Page ${i}]\n` + pageText + '\n\n';
          }
          analysisContent = fullText.trim() || `[PDF Document: ${displayName} (${pdf.numPages} pages)]`;
        } catch (pdfErr) {
          console.warn('PDF text extraction fallback:', pdfErr);
          analysisContent = `[PDF Document: ${displayName}]`;
        }
      } else if (file.type.startsWith('image/')) {
        setUploadStatusMsg(`Optimizing image for judicial forensic audit...`);
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;
        base64Data = base64;
        images.push({ data: base64, mimeType: file.type });
        analysisContent = `[Image Evidence: ${displayName}]`;
      } else {
        setUploadStatusMsg(`Reading document text content...`);
        analysisContent = await file.text();
        base64Data = btoa(unescape(encodeURIComponent(analysisContent.slice(0, 100000))));
      }

      setUploadStatusMsg(`Saving evidence to judicial vault...`);

      // Attempt upload to Firebase Storage with safe fallback
      let downloadURL = '';
      try {
        const fileRef = storageRef(storage, `documents/${caseId}/${Date.now()}_${displayName}`);
        await uploadBytes(fileRef, file, { contentType: file.type });
        downloadURL = await getDownloadURL(fileRef);
      } catch (storageErr) {
        console.warn('Firebase Storage upload failed, utilizing data URL / blob URL fallback:', storageErr);
      }

      // Safe local fallback URL if Storage is not accessible
      if (!downloadURL) {
        if (base64Data && base64Data.length < 500000) {
          downloadURL = `data:${file.type || 'application/octet-stream'};base64,${base64Data}`;
        } else {
          downloadURL = URL.createObjectURL(file);
        }
      }

      // Save document metadata to Firestore
      let docRefId = 'doc_' + Date.now();
      try {
        const docRef = await addDoc(collection(db, 'documents'), {
          caseId,
          fileName: displayName,
          fileUrl: downloadURL.startsWith('blob:') ? '' : downloadURL,
          textContent: analysisContent.slice(0, 500000),
          type: file.type || 'application/octet-stream',
          fileSize: file.size,
          userId: currentUserId,
          createdAt: serverTimestamp()
        });
        docRefId = docRef.id;
      } catch (firestoreErr) {
        console.warn('Firestore doc creation notice:', firestoreErr);
      }
      
      const newDoc = { 
        id: docRefId, 
        caseId, 
        fileName: displayName, 
        fileUrl: downloadURL, 
        textContent: analysisContent, 
        type: file.type || 'application/octet-stream', 
        fileSize: file.size, 
        userId: currentUserId, 
        createdAt: new Date() 
      } as Document;

      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);

      // Update active document in UI
      setDocuments(prev => {
        const exists = prev.some(d => d.id === newDoc.id || d.fileName === newDoc.fileName);
        return exists ? prev : [newDoc, ...prev];
      });
      setActiveDoc(newDoc);
      setShowUploadModal(false);
      setStagedFile(null);
      setStagedTitle('');
      setIsSavingToCase(false);
      setIsUploading(false);
      setUploadStatusMsg(null);

      // Proactive notification that file was saved and AI is ready
      setCaseSavedNotification(t('case.evidenceSavedSuccess') || `Evidence "${displayName}" saved to Case File! AI Assistant activated.`);
      setTimeout(() => setCaseSavedNotification(null), 5000);

      // Run AI forensic analysis and activate assistant chat
      handleAnalyze(newDoc, analysisContent, images);
    } catch (error: any) {
      console.error('Evidence save error:', error);
      setUploadError(error?.message || 'Failed to save evidence to case file. Please try again.');
      setIsSavingToCase(false);
      setIsUploading(false);
      setUploadStatusMsg(null);
    }
  };

  const handleSaveCurrentCaseFile = async () => {
    if (!caseData) return;
    try {
      await updateDoc(doc(db, 'cases', caseId), {
        updatedAt: serverTimestamp()
      });
      setCaseSavedNotification(`Case File "${caseData.title}" secured in Judicial Vault! AI is synchronized.`);
      setTimeout(() => setCaseSavedNotification(null), 4000);

      if (activeDoc) {
        setChatMessages(prev => [
          ...prev,
          {
            id: 'asst_sync_' + Date.now(),
            documentId: activeDoc.id,
            role: 'assistant',
            content: `🛡️ **Case File Confirmed & Saved**: All exhibits in **"${caseData.title}"** are saved and synchronized.\n\n*I am here to help. You can ask me to summarize all case files, cross-examine dates, or extract key legal issues.*`,
            userId: auth.currentUser?.uid || 'demo-judge-001',
            createdAt: new Date()
          } as ChatMessage
        ]);
      }
    } catch (e) {
      console.warn('Case save notice:', e);
    }
  };

  const handleBack = async () => {
    try {
      if (documents.length > 0) {
        localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify(documents));
      } else if (activeDoc) {
        localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify([activeDoc]));
      }
      if (activeDoc) {
        localStorage.setItem(`justiceflow_case_activedoc_${caseId}`, JSON.stringify(activeDoc));
      }
      if (chatMessages.length > 0) {
        localStorage.setItem(`justiceflow_case_chats_${caseId}`, JSON.stringify(chatMessages));
      }
      if (analysis) {
        localStorage.setItem(`justiceflow_case_analysis_${caseId}`, JSON.stringify(analysis));
      }
      if (caseData) {
        localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(caseData));
      }
    } catch (e) {
      console.warn('Local save on back notice:', e);
    }
    try {
      await updateDoc(doc(db, 'cases', caseId), {
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      // offline fallback
    }
    onBack();
  };

  const handleAnalyze = async (doc: Document, content: string, images?: { data: string, mimeType: string }[]) => {
    if (analyzingDocId.current === doc.id) return;
    analyzingDocId.current = doc.id;
    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';
    setIsAnalyzing(true);
    try {
      const result = await analyzeLegalDocument(doc.fileName, content, images);
      
      // Immediately activate AI analysis in local state!
      const activeAnalysis: Analysis = {
        id: 'analysis_' + Date.now(),
        documentId: doc.id,
        summary: result.summary,
        legal_points: result.legal_points || [],
        timeline: result.timeline || [],
        evidence_audit: result.evidence_audit || [],
        userId: currentUserId,
        createdAt: new Date()
      };
      setAnalysis(activeAnalysis);

      // Immediately activate AI chat with initial intake assessment
      const welcomeContent = `⚖️ **Judicial Intelligence Stream Activated** for evidence: **"${doc.fileName}"**\n\n` +
        `📂 **Saved to Case File**: Successfully saved into docket for **"${caseData?.title || 'Active Case'}"**.\n\n` +
        `**Executive Summary Snapshot**:\n${result.summary.slice(0, 320)}${result.summary.length > 320 ? '...' : ''}\n\n` +
        `• **Critical Legal Points**: ${result.legal_points?.length || 0} issues identified\n` +
        `• **Event Timeline**: ${result.timeline?.length || 0} chronological milestones logged\n\n` +
        `*JusticeFlow AI is ready to help! You can ask me to summarize the entire case, cross-check evidence exhibits, or verify authenticity.*`;

      setChatMessages(prev => {
        const hasUserMessages = prev.some(m => m.role === 'user');
        if (hasUserMessages) {
          return [...prev, {
            id: 'welcome_' + Date.now(),
            documentId: doc.id,
            role: 'assistant',
            content: welcomeContent,
            userId: currentUserId,
            createdAt: new Date()
          } as ChatMessage];
        }
        return [{
          id: 'welcome_' + Date.now(),
          documentId: doc.id,
          role: 'assistant',
          content: welcomeContent,
          userId: currentUserId,
          createdAt: new Date()
        } as ChatMessage];
      });

      // Persist analysis to Firestore in background without blocking local UI
      try {
        await addDoc(collection(db, 'analyses'), {
          documentId: doc.id,
          summary: result.summary,
          legal_points: result.legal_points || [],
          timeline: result.timeline || [],
          evidence_audit: result.evidence_audit || [],
          userId: currentUserId,
          createdAt: serverTimestamp()
        });
      } catch (firestoreErr) {
        console.warn('Firestore analysis save notice:', firestoreErr);
      }
    } catch (error) {
      console.error('Analysis error, activating fallback analysis:', error);
      const fallback = fallbackJudicialAnalysis(doc.fileName, content);
      const fallbackAnalysis: Analysis = {
        id: 'analysis_' + Date.now(),
        documentId: doc.id,
        summary: fallback.summary,
        legal_points: fallback.legal_points || [],
        timeline: fallback.timeline || [],
        evidence_audit: fallback.evidence_audit || [],
        userId: currentUserId,
        createdAt: new Date()
      };
      setAnalysis(fallbackAnalysis);
    } finally {
      analyzingDocId.current = null;
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';
    if (!chatInput.trim() || !activeDoc || !currentUserId) return;

    const userMsg = chatInput;
    setChatInput('');
    setIsChatting(true);

    const localUserMsg: ChatMessage = {
      id: 'usr_' + Date.now(),
      documentId: activeDoc.id,
      role: 'user',
      content: userMsg,
      userId: currentUserId,
      createdAt: new Date()
    } as ChatMessage;

    setChatMessages(prev => [...prev, localUserMsg]);

    try {
      try {
        await addDoc(collection(db, 'chats'), {
          documentId: activeDoc.id,
          role: 'user',
          content: userMsg,
          userId: currentUserId,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn('User chat save notice:', e);
      }

      // Format document upload date
      let uploadDateStr = 'Recently uploaded';
      if (activeDoc.createdAt) {
        if (activeDoc.createdAt.toDate) {
          uploadDateStr = activeDoc.createdAt.toDate().toLocaleString();
        } else if (activeDoc.createdAt instanceof Date) {
          uploadDateStr = activeDoc.createdAt.toLocaleString();
        } else if (activeDoc.createdAt.seconds) {
          uploadDateStr = new Date(activeDoc.createdAt.seconds * 1000).toLocaleString();
        }
      }

      // Build comprehensive multi-document case dossier across ALL uploaded files
      const caseDossierSummary = documents.map((docItem, index) => {
        let dDate = 'N/A';
        if (docItem.createdAt) {
          if (docItem.createdAt.toDate) dDate = docItem.createdAt.toDate().toLocaleString();
          else if (docItem.createdAt instanceof Date) dDate = docItem.createdAt.toLocaleString();
          else if (docItem.createdAt.seconds) dDate = new Date(docItem.createdAt.seconds * 1000).toLocaleString();
        }
        return `--- [CASE FILE ${index + 1}/${documents.length}]: "${docItem.fileName}" ---
Type: ${docItem.type || 'document'}
Upload Date: ${dDate}
File Content:
${docItem.textContent ? docItem.textContent.slice(0, 15000) : `[Visual / Photographic Evidence: ${docItem.fileName}]`}`;
      }).join('\n\n');

      const fullCaseContext = `=== JUDICIAL CASE DOSSIER: "${caseData?.title || 'Active Judicial Record'}" ===
Case Title: ${caseData?.title || 'Untitled Case'}
Case Description: ${caseData?.description || 'No description recorded'}
Case Status: ${caseData?.status === 'closed' ? 'Completed / Closed' : 'In Progress / Open'}
Total Evidence Files in Case: ${documents.length}

=== ALL UPLOADED EVIDENCE FILES IN THIS CASE ===
${caseDossierSummary || 'No other files in docket.'}

=== CURRENTLY ACTIVE FILE IN FOCUS ===
File Name: ${activeDoc.fileName}
Upload Date / Timestamp: ${uploadDateStr}
Content:
${activeDoc.textContent || activeDoc.fileName}
`;

      const response = await chatWithCase(fullCaseContext, [...chatMessages, localUserMsg], userMsg);

      const localAssistantMsg: ChatMessage = {
        id: 'asst_' + Date.now(),
        documentId: activeDoc.id,
        role: 'assistant',
        content: response,
        userId: currentUserId,
        createdAt: new Date()
      } as ChatMessage;

      setChatMessages(prev => [...prev, localAssistantMsg]);

      try {
        await addDoc(collection(db, 'chats'), {
          documentId: activeDoc.id,
          role: 'assistant',
          content: response,
          userId: currentUserId,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn('Assistant chat save notice:', e);
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      const localErrorMsg: ChatMessage = {
        id: 'err_' + Date.now(),
        documentId: activeDoc.id,
        role: 'assistant',
        content: `**Judicial Assistant Notice**:\n\n${error?.message || 'Inquiry processed. Please verify your legal queries or set your Gemini API key.'}`,
        userId: currentUserId,
        createdAt: new Date()
      } as ChatMessage;
      setChatMessages(prev => [...prev, localErrorMsg]);
    } finally {
      setIsChatting(false);
    }
  };

  const exportReport = () => {
    if (!analysis || !caseData) return;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('JusticeFlow - Judicial Analysis Report', 20, 20);
    
    doc.setFontSize(12);
    doc.text(`Case: ${caseData.title}`, 20, 35);
    doc.text(`Document: ${activeDoc?.fileName}`, 20, 42);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 49);
    
    doc.setFontSize(16);
    doc.text('Document Summary', 20, 65);
    doc.setFontSize(10);
    const splitSummary = doc.splitTextToSize(analysis.summary, 170);
    doc.text(splitSummary, 20, 75);

    // Legal Points
    if (analysis.legal_points.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Key Legal Points', 20, 20);
      doc.setFontSize(10);
      analysis.legal_points.forEach((point, i) => {
        const splitPoint = doc.splitTextToSize(`• ${point}`, 170);
        doc.text(splitPoint, 20, 35 + (i * 10));
      });
    }
    
    // Timeline Table
    if (analysis.timeline.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Chronological Timeline', 20, 20);
      autoTable(doc, {
        startY: 30,
        head: [['Date', 'Event', 'Description']],
        body: analysis.timeline.map(e => [e.date, e.event, e.description]),
      });
    }
    
    // Authenticity Report
    if (analysis.evidence_audit && analysis.evidence_audit.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Evidence Audit (Forensics)', 20, 20);
      autoTable(doc, {
        startY: 30,
        head: [[t('case.description'), t('case.verdict'), t('case.aiProb'), t('case.trueProb'), t('case.notes')]],
        body: analysis.evidence_audit.map(r => [
          r.description, 
          r.verdict, 
          `${r.ai_probability ?? 0}%`, 
          `${r.true_probability ?? 100}%`, 
          r.forensic_notes
        ]),
      });
    }
    
    doc.save(`JusticeFlow_Report_${caseData.title.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      {/* Case Details Header Panel */}
      <div className="glass-card p-6 rounded-3xl border-border-main shadow-lg">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-10 h-10 bg-brand-accent/10 rounded-xl flex items-center justify-center">
                <Scale className="w-5 h-5 text-brand-accent" />
              </div>
              <h2 className="text-2xl font-bold text-text-main tracking-tight">{caseData?.title || 'Loading Case...'}</h2>
              {caseData && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleToggleCaseStatus}
                  title={caseData.status === 'closed' ? (t('dashboard.markOpen') || 'Mark as In Progress') : (t('case.saveToCompleted') || 'Save to Completed Cases')}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 ${
                    caseData.status === 'closed'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-sm'
                      : 'bg-surface border-border-main text-text-muted hover:border-emerald-500/50 hover:text-emerald-400'
                  }`}
                >
                  {caseData.status === 'closed' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>{t('case.caseCompletedSaved') || 'Case Completed (Saved)'}</span>
                    </>
                  ) : (
                    <>
                      <FolderCheck className="w-4 h-4" />
                      <span>{t('case.markCaseCompleted') || 'Case Completed'}</span>
                    </>
                  )}
                </motion.button>
              )}
            </div>
            <p className="text-sm text-text-muted leading-relaxed max-w-2xl">{caseData?.description}</p>
          </div>
          
          {activeDoc && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex-1 max-w-md bg-surface/50 p-4 rounded-2xl border border-border-main shadow-inner"
            >
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3 h-3 text-brand-accent" />
                <span className="text-[10px] font-bold text-brand-accent uppercase tracking-[0.2em]">Active Evidence Snippet</span>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 bg-surface border border-border-main rounded-lg flex items-center justify-center shrink-0">
                  {activeDoc.type.startsWith('image/') && previewUrl ? (
                    <img src={previewUrl} className="w-full h-full object-cover rounded-lg" alt="Preview" />
                  ) : (
                    <FileText className="w-6 h-6 text-text-muted" />
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-text-main truncate">{activeDoc.fileName}</p>
                  <p className="text-[10px] text-text-muted line-clamp-2 italic leading-relaxed">
                    {activeDoc.textContent ? activeDoc.textContent.substring(0, 120) + '...' : 'Visual Evidence (See Vault Below)'}
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex items-center gap-1 text-[9px] text-text-muted font-bold uppercase tracking-widest">
                      <FileText className="w-2.5 h-2.5" />
                      {activeDoc.type.split('/')[1]?.toUpperCase() || 'FILE'}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-text-muted font-bold uppercase tracking-widest">
                      <BarChart3 className="w-2.5 h-2.5" />
                      {activeDoc.fileSize ? `${(activeDoc.fileSize / 1024).toFixed(1)} KB` : 'N/A'}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-text-muted font-bold uppercase tracking-widest">
                      <History className="w-2.5 h-2.5" />
                      {activeDoc.createdAt?.toDate ? activeDoc.createdAt.toDate().toLocaleDateString() : new Date().toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 mt-1.5 border-t border-border-main/50">
                    <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      Evidence Initialized
                    </span>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={async () => {
                        await handleSaveCurrentCaseFile();
                        if (!analysis && (activeDoc.textContent || activeDoc.fileUrl)) {
                          handleAnalyze(activeDoc, activeDoc.textContent || activeDoc.fileUrl, []);
                        }
                        const chatEl = document.getElementById('judicial-chat-section');
                        chatEl?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md text-[9px] font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                      <span>{t('case.confirmAndSave') || 'Confirm & Save Case'}</span>
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <motion.button 
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.92 }}
            onClick={handleBack} 
            className="flex items-center gap-2 text-text-muted hover:text-brand-accent transition-all font-semibold uppercase tracking-widest text-[10px]"
          >
            <ArrowLeft className="w-3 h-3" />
            {t('common.back')}
          </motion.button>
          <div className="h-6 w-px bg-border-main" />
          <div className="flex gap-2 overflow-x-auto max-w-[600px] pb-1 no-scrollbar">
            {effectiveDocuments.map(doc => (
              <motion.button
                key={doc.id}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.93 }}
                onClick={() => setActiveDoc(doc)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap transition-all border",
                  activeDoc?.id === doc.id 
                    ? "bg-brand-accent/10 border-brand-accent/30 text-brand-accent" 
                    : "bg-surface border-border-main text-text-muted hover:border-text-muted"
                )}
              >
                {doc.fileName}
              </motion.button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {activeDoc && (
            <motion.button 
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              onClick={async () => {
                await handleSaveCurrentCaseFile();
                if (!analysis && activeDoc && (activeDoc.textContent || activeDoc.fileUrl)) {
                  handleAnalyze(activeDoc, activeDoc.textContent || activeDoc.fileUrl, []);
                }
                const chatEl = document.getElementById('judicial-chat-section');
                chatEl?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold uppercase tracking-widest text-[10px] cursor-pointer shadow-lg shadow-emerald-500/25 transition-all"
              title="Confirm and Save Case File"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              <span>{t('case.confirmAndSave') || 'Confirm & Save Case'}</span>
            </motion.button>
          )}
          {caseData && (
            <motion.button 
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              onClick={handleToggleCaseStatus}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold uppercase tracking-widest text-[10px] cursor-pointer shadow-lg transition-all border",
                caseData.status === 'closed'
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-emerald-500/10"
                  : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border-emerald-500/40 shadow-emerald-600/25"
              )}
              title={caseData.status === 'closed' ? "Case is archived in Completed Cases. Click to reopen." : "Save and mark this case as Completed"}
            >
              <FolderCheck className="w-3.5 h-3.5" />
              <span>{caseData.status === 'closed' ? (t('case.caseCompletedSaved') || 'Case Completed (Saved)') : (t('case.markCaseCompleted') || 'Case Completed')}</span>
            </motion.button>
          )}
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.94 }}
            onClick={exportReport}
            disabled={!analysis}
            className="flex items-center gap-2 px-3.5 py-2 bg-surface border border-border-main rounded-lg text-text-main font-semibold uppercase tracking-widest text-[10px] hover:bg-surface/80 disabled:opacity-30 transition-all"
          >
            <Download className="w-3 h-3" />
            {t('case.exportReport')}
          </motion.button>
          <motion.button 
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg font-semibold uppercase tracking-widest text-[10px] hover:bg-brand-primary/90 cursor-pointer shadow-lg shadow-brand-primary/10 transition-all"
          >
            <Upload className="w-3 h-3" />
            {effectiveDocuments.length > 0 ? (t('case.uploadOtherFile') || 'Upload Other File') : (t('case.uploadEvidence') || 'Upload Evidence')}
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {caseSavedNotification && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl flex items-center justify-between text-emerald-400 text-xs shadow-md"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span className="font-semibold">{caseSavedNotification}</span>
            </div>
            <span className="text-[9px] uppercase tracking-widest text-emerald-300 font-bold bg-emerald-500/20 px-2.5 py-0.5 rounded-full">
              AI Assistant Ready
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {(effectiveDocuments.length > 0 || activeDoc) ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-320px)]">
          {/* Left Panel: Document Viewer */}
          <div className="lg:col-span-6 flex flex-col gap-2">
            <div className="glass-card rounded-3xl flex flex-col h-full overflow-hidden">
              <div className="bg-surface/50 border-b border-border-main px-6 py-3 flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-brand-accent uppercase tracking-[0.3em] flex items-center gap-2">
                  <FileText className="w-3 h-3" />
                  {t('case.evidenceVault')}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">{activeDoc?.fileName || 'No active file'}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-8 bg-surface/10">
                {activeDoc ? (
                  <div className="h-full flex flex-col">
                    <DocumentPreview 
                      fileUrl={activeDoc.fileUrl} 
                      type={activeDoc.type} 
                      fileName={activeDoc.fileName} 
                      textContent={activeDoc.textContent} 
                      previewUrl={previewUrl}
                    />
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-20">
                    <FileText className="w-16 h-16 mb-4" />
                    <p className="font-semibold uppercase tracking-[0.2em] text-[10px]">Select Evidence to View</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Analysis & Chat */}
          <div className="lg:col-span-6 grid grid-rows-2 gap-2 h-full">
            {/* Analysis Section */}
            <div className="glass-card rounded-3xl flex flex-col overflow-hidden">
              <div className="bg-surface/50 border-b border-border-main px-6 py-1 flex items-center justify-between">
                <div className="flex gap-6">
                  {(['summary', 'legal_points', 'timeline', 'authenticity'] as const).map(tab => (
                    <motion.button
                      key={tab}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.2em] py-3 border-b-2 transition-all",
                        activeTab === tab ? "border-brand-accent text-brand-accent" : "border-transparent text-text-muted hover:text-text-main"
                      )}
                    >
                      {tab.replace('_', ' ')}
                    </motion.button>
                  ))}
                </div>
                {isAnalyzing && (
                  <div className="flex items-center gap-3 text-brand-accent text-[10px] font-bold uppercase tracking-widest">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('case.analyzing')}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {!analysis && !isAnalyzing ? (
                  <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-20">
                    <BarChart3 className="w-16 h-16 mb-6" />
                    <p className="font-bold uppercase tracking-[0.2em] text-xs">Intelligence Report Pending</p>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="prose max-w-none"
                  >
                    {activeTab === 'summary' && (
                      <div className="space-y-6">
                        <h4 className="text-2xl font-bold text-text-main tracking-tight">{t('case.summary')}</h4>
                        <div className="bg-brand-accent/5 p-8 rounded-[2rem] border border-brand-accent/10 leading-relaxed text-text-main shadow-inner">
                          <ReactMarkdown>{analysis?.summary || ''}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {activeTab === 'legal_points' && (
                      <div className="space-y-8">
                        <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                          <Scale className="w-6 h-6 text-brand-accent" />
                          {t('case.legalPoints')}
                        </h4>
                        <div className="space-y-4">
                          {analysis?.legal_points.map((point, i) => (
                            <div key={i} className="flex gap-4 p-6 bg-brand-accent/5 border border-brand-accent/10 rounded-2xl">
                              <div className="mt-1">
                                <div className="w-2 h-2 bg-brand-accent rounded-full shadow-[0_0_10px_rgba(0,212,255,0.5)]" />
                              </div>
                              <p className="text-sm text-text-main leading-relaxed">{point}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'timeline' && (
                      <div className="space-y-8">
                        <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                          <History className="w-6 h-6 text-brand-accent" />
                          {t('case.timeline')}
                        </h4>
                        <div className="space-y-6 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-border-main">
                          {analysis?.timeline.map((event, i) => (
                            <div key={i} className="relative pl-12">
                              <div className="absolute left-0 top-1.5 w-8 h-8 bg-brand-deep border-2 border-brand-accent rounded-full z-10 shadow-[0_0_10px_rgba(0,212,255,0.3)]" />
                              <div className="glass-card p-6 rounded-2xl border-border-main hover:border-brand-accent/30 transition-all">
                                <span className="text-[10px] font-bold text-brand-accent uppercase tracking-widest">{event.date}</span>
                                <h5 className="font-bold text-text-main mt-2 tracking-tight">{event.event}</h5>
                                <p className="text-sm text-text-muted mt-2 leading-relaxed">{event.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'authenticity' && (
                      <div className="space-y-8">
                        <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                          <ShieldCheck className="w-6 h-6 text-brand-accent" />
                          {t('case.forensicAudit')}
                        </h4>
                        <div className="space-y-8">
                          {analysis?.evidence_audit?.map((report, i) => {
                            const aiProb = report.ai_probability ?? 0;
                            const trueProb = report.true_probability ?? 100;
                            const isAI = aiProb > 50;
                            
                            return (
                              <div key={i} className="glass-card p-8 rounded-[2.5rem] border-border-main shadow-xl">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                  {/* Left: Detection Image */}
                                  <div className="space-y-4">
                                    <h5 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">{t('case.detectionImage')}</h5>
                                    <div className="aspect-square bg-surface border border-border-main rounded-3xl overflow-hidden flex items-center justify-center relative group">
                                      {activeDoc?.type.startsWith('image/') && (previewUrl || activeDoc?.fileUrl) ? (
                                        <img 
                                          src={previewUrl || activeDoc.fileUrl} 
                                          alt="Detection Target" 
                                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <div className="flex flex-col items-center gap-3 opacity-20">
                                          <FileText className="w-12 h-12" />
                                          <span className="text-[10px] font-bold uppercase tracking-widest">Non-Visual Asset</span>
                                        </div>
                                      )}
                                      <div className="absolute inset-0 bg-gradient-to-t from-brand-deep/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">{report.description}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right: Detection Results */}
                                  <div className="space-y-8">
                                    <div className="space-y-2">
                                      <h5 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">{t('case.detectionResults')}</h5>
                                      <h3 className={cn(
                                        "text-xl font-bold tracking-tight",
                                        isAI ? "text-red-500" : "text-green-500"
                                      )}>
                                        {isAI ? t('case.verdictIsAI') : t('case.verdictIsHuman')}
                                      </h3>
                                    </div>

                                    <div className="space-y-4">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                                          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest">{t('case.aiProbability')}</span>
                                        </div>
                                        <span className="text-sm font-bold text-text-main">{aiProb}%</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest">{t('case.trueProbability')}</span>
                                        </div>
                                        <span className="text-sm font-bold text-text-main">{trueProb}%</span>
                                      </div>
                                    </div>

                                    <div className="flex justify-center pt-4">
                                      <div className="relative w-32 h-32">
                                        <svg className="w-full h-full" viewBox="0 0 100 100">
                                          <circle
                                            className="text-green-500/10 stroke-current"
                                            strokeWidth="8"
                                            cx="50"
                                            cy="50"
                                            r="40"
                                            fill="transparent"
                                          />
                                          <circle
                                            className={cn(
                                              "stroke-current transition-all duration-1000 ease-out",
                                              isAI ? "text-red-500" : "text-green-500"
                                            )}
                                            strokeWidth="8"
                                            strokeDasharray={251.2}
                                            strokeDashoffset={251.2 - (251.2 * aiProb) / 100}
                                            strokeLinecap="round"
                                            cx="50"
                                            cy="50"
                                            r="40"
                                            fill="transparent"
                                            transform="rotate(-90 50 50)"
                                          />
                                        </svg>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                          <span className={cn(
                                            "text-xl font-bold tracking-tighter",
                                            isAI ? "text-red-500" : "text-green-500"
                                          )}>{aiProb}%</span>
                                          <span className="text-[8px] font-bold text-text-muted uppercase tracking-widest">{t('case.aiProb')}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-8 bg-surface/50 p-6 rounded-2xl border-l-4 border-brand-accent space-y-2">
                                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-[0.2em]">{t('case.forensicNotes')}</span>
                                  <p className="text-sm text-text-main leading-relaxed italic">"{report.forensic_notes}"</p>
                                </div>
                              </div>
                            );
                          })}
                          {(!analysis?.evidence_audit || analysis.evidence_audit.length === 0) && (
                            <div className="text-center py-24 text-brand-accent/30">
                              <ShieldCheck className="w-24 h-24 mx-auto mb-6" />
                              <p className="font-bold uppercase tracking-[0.3em] text-xs text-text-main">{t('case.awaitingVisual')}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Chat Section */}
            <div id="judicial-chat-section" className="glass-card rounded-[2.5rem] flex flex-col overflow-hidden">
              <div className="bg-surface/50 border-b border-border-main px-8 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-brand-accent" />
                  <h3 className="text-[10px] font-bold text-text-main uppercase tracking-[0.3em]">{t('case.chatInterface')}</h3>
                </div>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setShowApiKeyDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-surface border border-border-main hover:border-brand-accent text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-brand-accent transition-all shadow-sm"
                  title="Configure Google Gemini API Key"
                >
                  <Key className="w-3 h-3 text-brand-accent" />
                  {getGeminiApiKey() ? (
                    <span className="text-green-500 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Live AI
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Set API Key
                    </span>
                  )}
                </motion.button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center">
                    <div className="flex flex-col items-center justify-center text-brand-accent/30 mb-8">
                      <MessageSquare className="w-16 h-16 mb-6" />
                      <p className="font-bold uppercase tracking-[0.2em] text-[10px] text-text-main">{t('case.awaitingQuery')}</p>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-3 w-full max-w-md">
                      {[
                        t('case.query1'),
                        t('case.query2'),
                        t('case.query3'),
                        t('case.query4')
                      ].map((query, i) => (
                        <motion.button
                          key={i}
                          whileHover={{ scale: 1.02, x: 3 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            setChatInput(query);
                          }}
                          className="text-left p-4 bg-surface border border-border-main rounded-xl text-xs text-text-main font-medium hover:border-brand-accent/50 hover:bg-brand-accent/5 transition-all shadow-sm"
                        >
                          {query}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg) => (
                  <div key={msg.id} className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "p-6 rounded-[1.5rem] text-sm leading-relaxed shadow-xl",
                      msg.role === 'user' 
                        ? "bg-brand-primary text-white rounded-tr-none shadow-brand-primary/10" 
                        : "bg-surface text-text-main rounded-tl-none border border-border-main"
                    )}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <span className="text-[9px] font-bold text-text-muted mt-2 px-2 uppercase tracking-widest">
                      {msg.role === 'user' ? 'Judge' : 'JusticeFlow AI'} • {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Real-time'}
                    </span>
                  </div>
                ))}
                {isChatting && (
                  <div className="flex items-start max-w-[85%]">
                    <div className="bg-surface p-6 rounded-[1.5rem] rounded-tl-none border border-border-main">
                      <Loader2 className="w-5 h-5 animate-spin text-brand-accent" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-6 bg-surface/50 border-t border-border-main">
                <div className="relative">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={t('case.chatPlaceholder')}
                    disabled={!activeDoc || isChatting}
                    className="w-full pl-6 pr-16 py-5 bg-surface/50 border border-border-main rounded-2xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 disabled:opacity-30 transition-all"
                  />
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.88 }}
                    disabled={!chatInput.trim() || isChatting}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-brand-accent text-white rounded-xl hover:bg-brand-accent/80 transition-all disabled:opacity-30 shadow-lg shadow-brand-accent/20"
                  >
                    <Send className="w-5 h-5" />
                  </motion.button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : isUploading || isAnalyzing ? (
        <div className="glass-card rounded-[3rem] p-24 flex flex-col items-center justify-center text-center space-y-6 border-border-main">
          <div className="w-24 h-24 bg-brand-accent/10 rounded-full flex items-center justify-center border border-brand-accent/20 shadow-[0_0_50px_rgba(0,212,255,0.1)]">
            <Loader2 className="w-12 h-12 text-brand-accent animate-spin" />
          </div>
          <div className="space-y-2 max-w-md">
            <h3 className="text-2xl font-bold text-text-main tracking-tight">Initializing Evidence Stream...</h3>
            <p className="text-text-muted text-xs leading-relaxed font-medium">
              {uploadStatusMsg || t('case.analyzing')}
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-border-main text-[10px] font-bold uppercase tracking-widest text-brand-accent">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-accent" />
            <span>Forensic Engine Active</span>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-[3rem] p-24 flex flex-col items-center justify-center text-center space-y-8 border-border-main">
          <div className="w-32 h-32 bg-brand-accent/5 rounded-full flex items-center justify-center border border-brand-accent/10 shadow-[0_0_50px_rgba(0,212,255,0.05)]">
            <ShieldCheck className="w-16 h-16 text-brand-accent animate-pulse" />
          </div>
          <div className="space-y-4 max-w-md">
            <h3 className="text-3xl font-bold text-text-main tracking-tight">{t('case.evidenceVault')} Empty</h3>
            <p className="text-text-muted leading-relaxed">{t('dashboard.initializeFirst')}</p>
          </div>

          {uploadError && (
            <div className="p-4 bg-red-400/10 border border-red-400/20 rounded-2xl flex items-center gap-3 text-red-400 text-xs max-w-md text-left">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <span>{uploadError}</span>
            </div>
          )}

          <motion.button 
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-3 px-10 py-5 bg-brand-primary text-white rounded-2xl font-bold uppercase tracking-[0.2em] text-xs hover:bg-brand-primary/90 cursor-pointer shadow-2xl shadow-brand-primary/20 transition-all"
          >
            <Upload className="w-4 h-4" />
            {t('case.uploadEvidence')}
          </motion.button>
        </div>
      )}

      {/* Hidden single file input for reliable browser trigger */}
      <input 
        ref={fileInputRef} 
        type="file" 
        className="hidden" 
        accept=".pdf,.txt,.jpg,.jpeg,.png,.docx,.doc" 
        onChange={handleFileInputChange} 
      />

      {/* Evidence Stream Upload & Save to Case File Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isSavingToCase) {
                  setShowUploadModal(false);
                  setStagedFile(null);
                  setStagedTitle('');
                }
              }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-surface border border-border-main rounded-3xl shadow-2xl p-7 z-10 space-y-6"
            >
              <div className="flex items-center justify-between pb-4 border-b border-border-main">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center text-brand-accent">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-text-main">{t('case.uploadEvidence')}</h3>
                    <p className="text-[11px] text-text-muted">Save evidence directly into Case File & activate AI</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isSavingToCase}
                  onClick={() => {
                    setShowUploadModal(false);
                    setStagedFile(null);
                    setStagedTitle('');
                  }}
                  className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface rounded-xl transition-all disabled:opacity-30"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                {!stagedFile ? (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border-main hover:border-brand-accent/40 rounded-2xl cursor-pointer bg-surface/30 hover:bg-surface/60 transition-all group">
                    <div className="w-14 h-14 rounded-2xl bg-brand-accent/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Upload className="w-7 h-7 text-brand-accent opacity-60 group-hover:opacity-100" />
                    </div>
                    <span className="text-xs font-bold text-text-main mb-1 tracking-wide">
                      {t('case.dragOrBrowse') || 'Click to browse or drop evidence file here'}
                    </span>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider">
                      PDF, TXT, PNG, JPG, JPEG, DOCX (Max 750KB)
                    </span>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".pdf,.txt,.jpg,.jpeg,.png,.docx,.doc" 
                      onChange={handleFileInputChange}
                    />
                  </label>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-brand-accent/5 border border-brand-accent/20 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-accent/10 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-brand-accent" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-text-main truncate max-w-[240px]">{stagedFile.name}</span>
                          <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                            {(stagedFile.size / 1024).toFixed(1)} KB • {stagedFile.type || 'DOCUMENT'}
                          </span>
                        </div>
                      </div>
                      <button 
                        type="button" 
                        disabled={isSavingToCase}
                        onClick={() => {
                          setStagedFile(null);
                          setStagedTitle('');
                        }}
                        className="p-1.5 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-all disabled:opacity-30"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                        {t('case.stagedEvidenceTitle') || 'Evidence Exhibit Name'}
                      </label>
                      <input 
                        type="text" 
                        value={stagedTitle}
                        onChange={(e) => setStagedTitle(e.target.value)}
                        placeholder="e.g. Exhibit A - Witness Testimony"
                        className="w-full px-4 py-2.5 bg-surface/50 border border-border-main rounded-xl text-text-main text-xs focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
                      />
                    </div>

                    <div className="p-3 bg-brand-accent/5 rounded-xl border border-brand-accent/10 flex items-center gap-2 text-[11px] text-brand-accent">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>JusticeFlow AI will immediately appear and assist your judicial review upon saving.</span>
                    </div>
                  </div>
                )}

                {uploadError && (
                  <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-xl flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <motion.button 
                  type="button" 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isSavingToCase}
                  onClick={() => {
                    setShowUploadModal(false);
                    setStagedFile(null);
                    setStagedTitle('');
                  }}
                  className="flex-1 py-3 px-4 border border-border-main text-text-muted hover:text-text-main rounded-xl text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {t('common.cancel')}
                </motion.button>
                <motion.button 
                  type="button" 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={!stagedFile || isSavingToCase}
                  onClick={handleSaveStagedFileToCase}
                  className="flex-1 py-3 px-4 bg-brand-primary text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-brand-primary/90 flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20 transition-all disabled:opacity-40"
                >
                  {isSavingToCase ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Saving to Case File...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 text-white" />
                      <span>{t('case.saveToCase') || 'Save to Case File'}</span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Gemini API Key Dialog */}
      <AnimatePresence>
        {showApiKeyDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiKeyDialog(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-surface border border-border-main rounded-3xl shadow-2xl p-6 z-10 space-y-5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-border-main">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-text-main">Google Gemini API Key</h3>
                    <p className="text-[11px] text-text-muted">Activate Live Judicial Intelligence</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowApiKeyDialog(false)}
                  className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  Enter your Google Gemini API key to enable live cloud AI document analysis and chat. Your key is stored securely in your local browser session.
                </p>

                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-surface/60 border border-border-main rounded-xl p-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
                />

                <div className="flex items-center justify-between pt-2">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-brand-accent hover:underline flex items-center gap-1"
                  >
                    Get free API key from Google AI Studio ↗
                  </a>
                </div>

                {apiKeySaved && (
                  <p className="text-xs text-green-500 font-semibold flex items-center gap-1">
                    ✓ API Key updated successfully!
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-main">
                {getGeminiApiKey() && (
                  <button
                    type="button"
                    onClick={() => {
                      setGeminiApiKey('');
                      setApiKeyInput('');
                      setApiKeySaved(true);
                      setTimeout(() => {
                        setApiKeySaved(false);
                        setShowApiKeyDialog(false);
                      }, 800);
                    }}
                    className="px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-400/10 rounded-xl mr-auto"
                  >
                    Clear Key
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowApiKeyDialog(false)}
                  className="px-4 py-2 text-xs font-semibold text-text-muted hover:bg-surface rounded-xl border border-border-main"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGeminiApiKey(apiKeyInput.trim());
                    setApiKeySaved(true);
                    setTimeout(() => {
                      setApiKeySaved(false);
                      setShowApiKeyDialog(false);
                    }, 800);
                  }}
                  className="px-5 py-2 text-xs font-semibold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-xl shadow-md"
                >
                  Save Key
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
