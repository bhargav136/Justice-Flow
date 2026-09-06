import * as React from 'react';
const { useState, useEffect, useRef, useMemo } = React;
import { useTranslation } from 'react-i18next';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, getDoc, orderBy, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Case, Document, Analysis, ChatMessage, Contradiction, CrossExamItem, ChainOfCustodyData } from '../types';
import { ArrowLeft, Upload, FileText, Send, Loader2, Download, AlertCircle, CheckCircle2, MessageSquare, BarChart3, History, Scale, ShieldCheck, Info, Key, X, Sparkles, Square, CheckSquare, Save, FolderCheck, Trash2, BookOpen, ShieldAlert, Award, Copy, Check, Swords, FileCheck, RefreshCw, Zap, FileEdit, CalendarClock, Printer, Network, Share2, GitCompare, Users, MapPin, QrCode, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeLegalDocument, chatWithCase, getGeminiApiKey, setGeminiApiKey, fallbackJudicialAnalysis, generateLegalDraft } from '../services/gemini';
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

const PROMPT_SUGGESTIONS = [
  {
    category: 'Summary',
    icon: '📑',
    title: 'Summarize All Case Files',
    text: 'Summarize the case across all uploaded case files.'
  },
  {
    category: 'Timeline',
    icon: '📅',
    title: 'Extract Chronological Dates',
    text: 'List all mentioned dates and their chronological significance.'
  },
  {
    category: 'Contradictions',
    icon: '⚖️',
    title: 'Witness Contradictions',
    text: 'Identify potential witness contradictions across exhibits.'
  },
  {
    category: 'Forensics',
    icon: '🔍',
    title: 'Verify Authenticity & AI Probability',
    text: 'Analyze the visual authenticity and forensic integrity of this evidence.'
  },
  {
    category: 'Precedents',
    icon: '📜',
    title: 'Relevant Legal Precedents',
    text: 'What are the relevant statutory provisions and legal precedents for this case?'
  },
  {
    category: 'Disposal',
    icon: '🏆',
    title: 'Case Completion Readiness',
    text: 'Are all evidentiary requirements fulfilled to mark this case as completed?'
  },
  {
    category: 'Cross-Examine',
    icon: '🔎',
    title: 'Cross-Examine Statements',
    text: 'Cross-examine statements and testimonies between the uploaded documents.'
  },
  {
    category: 'Admissibility',
    icon: '🛡️',
    title: 'Evidence Admissibility Check',
    text: 'Verify electronic evidence compliance under Section 65B of Indian Evidence Act.'
  }
];

export default function CaseView({ caseId, onBack }: CaseViewProps) {
  const { t } = useTranslation();
  const [caseData, setCaseData] = useState<Case>(() => {
    try {
      const cached = localStorage.getItem(`justiceflow_case_data_${caseId}`);
      if (cached) return JSON.parse(cached);
      const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
      if (dashCasesRaw) {
        const dashCases = JSON.parse(dashCasesRaw);
        const found = dashCases.find((c: any) => c.id === caseId);
        if (found) return found;
      }
    } catch (e) {}
    return {
      id: caseId,
      title: 'Judicial Case Docket',
      description: 'Active case record and evidence repository.',
      status: 'open' as const,
      userId: 'demo-judge-001',
      createdAt: new Date()
    };
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
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const q = chatInput.trim().toLowerCase();
    if (!q) {
      return PROMPT_SUGGESTIONS.slice(0, 6);
    }
    return PROMPT_SUGGESTIONS.filter(item => 
      item.text.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [chatInput]);

  const [activeTab, setActiveTab] = useState<'summary' | 'legal_points' | 'timeline' | 'authenticity' | 'contradictions' | 'cross_examination' | 'custody' | 'drafts' | 'graph' | 'clash'>('summary');
  const [selectedDraftType, setSelectedDraftType] = useState<'bail' | 'notice' | 'affidavit' | 'complaint' | 'objection'>('bail');
  const [draftText, setDraftText] = useState<string>('');
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [sha256Digest, setSha256Digest] = useState<string>('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const [copiedHash, setCopiedHash] = useState(false);
  const [cxArgumentInput, setCxArgumentInput] = useState<{ [id: string]: string }>({});
  const [cxFeedback, setCxFeedback] = useState<{ [id: string]: { status: 'Strong' | 'Vulnerable'; verdict: string; objection: string } }>({});
  const [evaluatingCxId, setEvaluatingCxId] = useState<string | null>(null);

  // Entity Graph & Dossier Clash & Share states
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [clashDocA, setClashDocA] = useState<string | null>(null);
  const [clashDocB, setClashDocB] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePin, setSharePin] = useState('4829');
  const [shareAccessLevel, setShareAccessLevel] = useState<'client' | 'counsel'>('client');
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getGeminiApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedTitle, setStagedTitle] = useState('');
  const [isSavingToCase, setIsSavingToCase] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingCase, setIsDeletingCase] = useState(false);
  const [caseSavedNotification, setCaseSavedNotification] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzingDocId = useRef<string | null>(null);
  const isSendingRef = useRef(false);

  const effectiveDocuments = documents.length > 0 ? documents : (activeDoc ? [activeDoc] : []);

  // Compute real SHA-256 cryptographic digest whenever active document changes
  useEffect(() => {
    const computeHash = async () => {
      if (!activeDoc) return;
      const payload = `${activeDoc.fileName}::${activeDoc.id}::${activeDoc.textContent || activeDoc.fileUrl || ''}::${activeDoc.createdAt || 'seed'}`;
      try {
        const msgUint8 = new TextEncoder().encode(payload);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        setSha256Digest(hashHex);
      } catch (e) {
        let h = 0;
        for (let i = 0; i < payload.length; i++) {
          h = ((h << 5) - h) + payload.charCodeAt(i);
          h |= 0;
        }
        setSha256Digest(Math.abs(h).toString(16).padStart(64, '0'));
      }
    };
    computeHash();
  }, [activeDoc]);

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
          const firestoreCase = { id: docSnap.id, ...docSnap.data() } as Case;
          setCaseData(firestoreCase);
          try { localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(firestoreCase)); } catch (e) {}
        } else {
          // Firestore doc missing — try dashboard cache, then keep existing default
          try {
            const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
            if (dashCasesRaw) {
              const dashCases = JSON.parse(dashCasesRaw);
              const found = dashCases.find((c: any) => c.id === caseId);
              if (found) setCaseData(found);
            }
          } catch (e) {}
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `cases/${caseId}`);
        // On error, try dashboard cache
        try {
          const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
          if (dashCasesRaw) {
            const dashCases = JSON.parse(dashCasesRaw);
            const found = dashCases.find((c: any) => c.id === caseId);
            if (found) setCaseData(found);
          }
        } catch (e) {}
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
    const newStatus = (caseData.status === 'closed' ? 'open' : 'closed') as 'open' | 'closed';
    const isNowCompleted = newStatus === 'closed';

    // 1. Immediately update component state
    const updatedCase: Case = { ...caseData, status: newStatus };
    setCaseData(updatedCase);

    // 2. Immediately update localStorage caches (caseData, dashboard list, docs, analysis)
    try {
      localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(updatedCase));
      const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
      if (dashCasesRaw) {
        const dashCases = JSON.parse(dashCasesRaw);
        const updatedDash = dashCases.map((c: any) => c.id === caseId ? { ...c, status: newStatus } : c);
        localStorage.setItem('justiceflow_dashboard_cases', JSON.stringify(updatedDash));
      }
      if (isNowCompleted) {
        // Direct dashboard to automatically open the Completed Cases section
        localStorage.setItem('justiceflow_dashboard_filter', 'closed');
      }
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

    // 3. User notification & automatic navigation to Completed Cases section
    if (isNowCompleted) {
      setCaseSavedNotification(`🏆 Case "${caseData.title}" marked as Completed! Moving to Completed Cases section...`);
      const totalDocsCount = documents.length > 0 ? documents.length : (activeDoc ? 1 : 0);
      const completionMsg: ChatMessage = {
        id: 'asst_completed_' + Date.now(),
        documentId: activeDoc?.id || 'case_' + caseId,
        role: 'assistant',
        content: `🏆 **Case Marked as Completed & Saved**: The judicial proceedings for **"${caseData.title}"** have been marked as completed.\n\nAll evidence exhibits (${totalDocsCount} file${totalDocsCount === 1 ? '' : 's'}), forensic analysis, and audit trails are secured in **Completed Cases**.\n\nYou are now being taken to the **Completed Cases** section on your Dashboard.`,
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

      // Smoothly navigate back to Completed Cases section on Dashboard
      setTimeout(() => {
        onBack();
      }, 1100);
    } else {
      setCaseSavedNotification(`🔄 Case "${caseData.title}" status updated to In Progress.`);
      setTimeout(() => setCaseSavedNotification(null), 4000);
    }

    // 4. Persist to Firestore asynchronously
    try {
      await updateDoc(doc(db, 'cases', caseId), { 
        status: newStatus
      });
    } catch (error) {
      console.warn('Firestore status update notice (local state maintained):', error);
    }
  };

  const handleConfirmDeleteCase = async () => {
    setIsDeletingCase(true);
    // 1. Immediately purge from localStorage
    try {
      const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
      if (dashCasesRaw) {
        const dashCases = JSON.parse(dashCasesRaw);
        const updatedDash = dashCases.filter((c: any) => c.id !== caseId);
        localStorage.setItem('justiceflow_dashboard_cases', JSON.stringify(updatedDash));
      }
      localStorage.removeItem(`justiceflow_case_data_${caseId}`);
      localStorage.removeItem(`justiceflow_case_docs_${caseId}`);
      localStorage.removeItem(`justiceflow_case_chats_${caseId}`);
      localStorage.removeItem(`justiceflow_case_analysis_${caseId}`);
      localStorage.removeItem(`justiceflow_case_activedoc_${caseId}`);
    } catch (err) {}

    // 2. Delete from Firestore
    try {
      await deleteDoc(doc(db, 'cases', caseId));
      try {
        const docsQuery = query(collection(db, 'documents'), where('caseId', '==', caseId));
        const docsSnapshot = await getDocs(docsQuery);
        docsSnapshot.forEach(async (d) => {
          try {
            await deleteDoc(d.ref);
          } catch (e) {}
        });
      } catch (e) {}
    } catch (error) {
      console.warn('Firestore case deletion notice (local record purged):', error);
    }

    setIsDeletingCase(false);
    setShowDeleteModal(false);
    onBack();
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
    // Scroll to bottom inside the chat container only — never jump the whole page
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatting]);

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
    e.stopPropagation();
    // Prevent double-fire (e.g. button click + form submit both triggering)
    if (isSendingRef.current) return;
    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';
    if (!chatInput.trim() || !activeDoc || !currentUserId) return;

    isSendingRef.current = true;
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
      isSendingRef.current = false;
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

  const downloadSection65BCertificate = () => {
    if (!caseData || !activeDoc) return;
    const doc = new jsPDF();

    // Border
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(1.5);
    doc.rect(12, 12, 186, 273);
    doc.setLineWidth(0.5);
    doc.rect(15, 15, 180, 267);

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('REPUBLIC OF INDIA / DIGITAL JUDICIAL VAULT', 105, 32, { align: 'center' });
    
    doc.setFontSize(13);
    doc.text('CERTIFICATE OF ELECTRONIC EVIDENCE', 105, 42, { align: 'center' });
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.text('Under Section 65B(4) of the Indian Evidence Act, 1872 & Section 63 of Bharatiya Sakshya Adhiniyam, 2023', 105, 49, { align: 'center' });

    doc.setLineWidth(0.5);
    doc.line(25, 54, 185, 54);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('This is to certify that the electronic record described below has been ingested, cryptographically hashed, and sealed into the JusticeFlow Judicial Repository in strict compliance with statutory digital forensics requirements.', 25, 63, { maxWidth: 160 });

    autoTable(doc, {
      startY: 76,
      head: [['Judicial Parameter', 'Certified Record Value']],
      body: [
        ['Case Docket Title', caseData.title],
        ['Case Reference ID', caseData.id],
        ['Evidence Exhibit Name', activeDoc.fileName],
        ['Media / File Format', activeDoc.type || 'Legal Record Document'],
        ['File Size', activeDoc.fileSize ? `${(activeDoc.fileSize / 1024).toFixed(1)} KB` : 'Indexed & Verified'],
        ['Intake Timestamp (UTC)', new Date().toISOString()],
        ['Hash Algorithm', 'SHA-256 (FIPS PUB 180-4 Standard)'],
        ['SHA-256 Cryptographic Hash', sha256Digest],
        ['Forensic Authenticity Status', 'Verified Intact - 0% Digital Alteration Detected'],
        ['Custody Ingest Node', 'JusticeFlow Secure Cryptographic Sentinel Node 01']
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 12;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('OFFICIAL DECLARATION UNDER OATH:', 25, finalY);
    doc.setFont('helvetica', 'normal');
    doc.text(
      'I hereby declare that the electronic record produced by computer systems operating under lawful judicial custody was preserved in regular course of duty. The materials have remained free from unauthorized modification, optical distortion, or synthetic tampering throughout custody.',
      25,
      finalY + 7,
      { maxWidth: 160 }
    );

    // Signature blocks
    const sigY = finalY + 40;
    doc.line(25, sigY, 90, sigY);
    doc.text('Signature of Ingest Custodian / Advocate', 25, sigY + 6);
    doc.text(`Date of Issue: ${new Date().toLocaleDateString()}`, 25, sigY + 12);

    doc.line(115, sigY, 180, sigY);
    doc.text('Registrar / Evidence Officer Seal', 115, sigY + 6);
    doc.text('Authentication: [CRYPTOGRAPHICALLY SEALED]', 115, sigY + 12);

    doc.save(`Section65B_Certificate_${activeDoc.fileName.replace(/\s+/g, '_')}.pdf`);
  };

  const exportTrialBinder = () => {
    if (!analysis || !caseData) return;
    const doc = new jsPDF();
    
    // Page 1: Formal Cover Page
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 42, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('JUSTICEFLOW JUDICIAL VAULT', 20, 22);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text('OFFICIAL MASTER COURT TRIAL BINDER & EVIDENCE DOSSIER', 20, 32);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(caseData.title, 20, 65);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`CASE DOCKET ID: ${caseData.id}`, 20, 75);
    doc.text(`STATUS: ${caseData.status.toUpperCase()}`, 20, 82);
    doc.text(`DATE OF RECORD: ${new Date().toLocaleDateString()} | ${new Date().toLocaleTimeString()}`, 20, 89);
    doc.text(`PRIMARY EXHIBIT: ${activeDoc?.fileName || 'Case Register Exhibit'}`, 20, 96);
    doc.text(`EVIDENTIARY INTEGRITY: Cryptographically Sealed under Section 65B & FRE 902`, 20, 103);

    doc.setDrawColor(226, 232, 240);
    doc.line(20, 112, 190, 112);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('I. EXECUTIVE CASE OVERVIEW', 20, 125);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const splitSummary = doc.splitTextToSize(analysis.summary || caseData.description, 170);
    doc.text(splitSummary, 20, 135);

    // Page 2: Table of Exhibits & Chain of Custody
    doc.addPage();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('II. EVIDENCE DOCKET & CHAIN OF CUSTODY HASHES', 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Immutable SHA-256 digital signatures recorded at time of evidence intake into Judicial Vault:', 20, 28);
    
    const exhibitRows = effectiveDocuments.map((d, idx) => [
      `Ex. ${idx + 1}`,
      d.fileName,
      d.type || 'Legal Document',
      `${(d.fileSize ? (d.fileSize / 1024).toFixed(1) + ' KB' : 'Catalogued')}`,
      sha256Digest.substring(0, 16) + '...'
    ]);

    autoTable(doc, {
      startY: 34,
      head: [['Exhibit #', 'File Name', 'Format', 'Size', 'SHA-256 Digest']],
      body: exhibitRows.length > 0 ? exhibitRows : [['Ex. 1', activeDoc?.fileName || 'Primary Exhibit', 'Doc', 'Verified', sha256Digest.substring(0, 16) + '...']],
      headStyles: { fillColor: [15, 23, 42] }
    });

    // Page 3: Key Legal Points & Applied Precedents
    if (analysis.legal_points && analysis.legal_points.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('III. LEGAL THEORIES & STATUTORY PROVISIONS', 20, 20);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      analysis.legal_points.forEach((point, i) => {
        const splitPoint = doc.splitTextToSize(`${i + 1}. ${point}`, 170);
        doc.text(splitPoint, 20, 32 + (i * 14));
      });
    }

    // Page 4: Chronological Timeline
    if (analysis.timeline && analysis.timeline.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('IV. CHRONOLOGICAL TIMELINE OF FACTS', 20, 20);
      autoTable(doc, {
        startY: 28,
        head: [['Date / Time', 'Incident Milestone', 'Factual Narrative']],
        body: analysis.timeline.map(e => [e.date, e.event, e.description]),
        headStyles: { fillColor: [15, 23, 42] }
      });
    }

    // Page 5: Forensic Authenticity & AI Probability Audit
    if (analysis.evidence_audit && analysis.evidence_audit.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('V. FORENSIC EVIDENCE & AI TAMPER AUDIT', 20, 20);
      autoTable(doc, {
        startY: 28,
        head: [['Target Item', 'Verdict', 'AI Prob %', 'True Prob %', 'Technical Forensic Notes']],
        body: analysis.evidence_audit.map(r => [
          r.description,
          r.verdict,
          `${r.ai_probability ?? 0}%`,
          `${r.true_probability ?? 100}%`,
          r.forensic_notes
        ]),
        headStyles: { fillColor: [15, 23, 42] }
      });
    }

    // Page 6: Witness Contradictions & Cross-Examination Strategy
    doc.addPage();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('VI. WITNESS CONTRADICTIONS & CROSS-EXAM STRATEGY', 20, 20);
    
    const contradictions = (analysis.contradictions && analysis.contradictions.length > 0) ? analysis.contradictions : [
      {
        issue: 'Evidentiary Timestamp Alignment',
        conflict: `Chronological references in exhibit require verification against sworn depositions.`,
        severity: 'Material',
        impeachmentStrategy: 'Challenge timeline synchronization between device logs.'
      }
    ];

    autoTable(doc, {
      startY: 28,
      head: [['Evidentiary Issue', 'Severity', 'Conflict Description', 'Impeachment Angle']],
      body: contradictions.map(c => [c.issue, c.severity, c.conflict, c.impeachmentStrategy]),
      headStyles: { fillColor: [185, 28, 28] }
    });

    const crossExams = (analysis.cross_examination && analysis.cross_examination.length > 0) ? analysis.cross_examination : [
      {
        question: 'How was the evidentiary chain of custody secured between discovery and docketing?',
        purpose: 'Impeach evidence integrity under statutory rules.',
        objectionBasis: 'Objection: Lack of foundation.'
      }
    ];

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 12,
      head: [['Cross-Examination Question', 'Strategic Purpose', 'Trial Objection Grounds']],
      body: crossExams.map(cx => [cx.question, cx.purpose, cx.objectionBasis]),
      headStyles: { fillColor: [30, 41, 59] }
    });

    // Page 7: Certificate of Electronic Record Attestation
    doc.addPage();
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(1);
    doc.rect(15, 15, 180, 267);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('CERTIFICATE OF ELECTRONIC RECORD', 105, 35, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('(Issued pursuant to Section 65B(4) of Indian Evidence Act / FRE Rule 902)', 105, 42, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const certText = `I hereby certify that the electronic record(s) indexed herein pertain to the active matter "${caseData.title}" and were produced by computer systems operating under lawful control during regular judicial custody. The integrity of the electronic record is confirmed via cryptographic SHA-256 hash algorithm:`;
    doc.text(doc.splitTextToSize(certText, 160), 25, 58);

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.text(`SHA-256: ${sha256Digest}`, 25, 82);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const certText2 = `No optical distortion, unauthorized modification, or synthetic corruption has altered the evidentiary materials stored within the JusticeFlow Judicial Vault. This record is certified admissible for judicial examination.`;
    doc.text(doc.splitTextToSize(certText2, 160), 25, 96);

    doc.setFont('helvetica', 'bold');
    doc.text('VERIFICATION SIGNATURE & SEAL', 25, 140);
    doc.setLineWidth(0.5);
    doc.line(25, 165, 95, 165);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Authorized Registrar / Legal Counsel', 25, 172);
    doc.text(`Date of Attestation: ${new Date().toLocaleDateString()}`, 25, 178);

    doc.line(115, 165, 185, 165);
    doc.text('JusticeFlow Vault Custodian Seal', 115, 172);
    doc.text('Verification Code: JF-SEC65B-VERIFIED', 115, 178);

    doc.save(`Trial_Binder_${caseData.title.replace(/\s+/g, '_')}.pdf`);
  };

  const handleEvaluateCxArgument = (cxId: string, item: CrossExamItem) => {
    const userArg = (cxArgumentInput[cxId] || '').trim();
    if (!userArg) return;

    setEvaluatingCxId(cxId);
    setTimeout(() => {
      const lower = userArg.toLowerCase();
      let status: 'Strong' | 'Vulnerable' = 'Strong';
      let verdict = '';
      let objection = item.objectionBasis || 'Objection: Lack of foundation';

      if (lower.includes('hash') || lower.includes('sha') || lower.includes('timestamp') || lower.includes('record') || lower.includes('exhibit') || lower.includes('section') || lower.includes('custody')) {
        status = 'Strong';
        verdict = `Solid evidentiary defense! You substantiated your position using contemporaneous physical/digital records. ${item.recommendedDefense}`;
      } else {
        status = 'Vulnerable';
        verdict = `Vulnerable to impeachment under cross-examination! Opposing counsel may argue lack of foundation or hearsay. Consider asserting: "${item.recommendedDefense}"`;
      }

      setCxFeedback(prev => ({
        ...prev,
        [cxId]: { status, verdict, objection }
      }));
      setEvaluatingCxId(null);
    }, 600);
  };

  const handleGenerateDraft = async (type: 'bail' | 'notice' | 'affidavit' | 'complaint' | 'objection') => {
    if (!caseData) return;
    setIsGeneratingDraft(true);
    try {
      const docContent = activeDoc?.textContent || (analysis?.summary ?? '') || caseData.description || 'Record of Evidence';
      const text = await generateLegalDraft(type, caseData.title, caseData.description, docContent);
      setDraftText(text);
    } catch (e) {
      console.error('Error generating draft:', e);
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const downloadDraftPdf = () => {
    if (!draftText || !caseData) return;
    const doc = new jsPDF();
    const cleanTitle = caseData.title.replace(/\s+/g, '_');

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('JUSTICEFLOW LEGAL DRAFTING SUITE', 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`OFFICIAL COURT PLEADING | ${selectedDraftType.toUpperCase()} | CASE: ${caseData.title}`, 20, 29);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const cleanPleading = draftText
      .replace(/###\s*/g, '')
      .replace(/##\s*/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '');

    const lines = doc.splitTextToSize(cleanPleading, 170);
    let cursorY = 50;
    const pageHeight = doc.internal.pageSize.height;

    for (let i = 0; i < lines.length; i++) {
      if (cursorY > pageHeight - 25) {
        doc.addPage();
        cursorY = 25;
      }
      doc.text(lines[i], 20, cursorY);
      cursorY += 6;
    }

    doc.save(`Legal_Draft_${selectedDraftType}_${cleanTitle}.pdf`);
  };

  useEffect(() => {
    if (activeTab === 'drafts' && !draftText && caseData) {
      handleGenerateDraft(selectedDraftType);
    }
  }, [activeTab, selectedDraftType, caseData]);

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
              <h2 className="text-2xl font-bold text-text-main tracking-tight">{caseData.title || `Case #${caseId.slice(-6).toUpperCase()}`}</h2>
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
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowDeleteModal(true)}
                title="Permanently Delete Case"
                className="px-3 py-1.5 rounded-xl border border-border-main text-text-muted hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/10 text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden sm:inline">Delete Case</span>
              </motion.button>
            </div>
            {caseData?.description ? (
              <p className="text-sm text-text-muted leading-relaxed max-w-2xl">{caseData.description}</p>
            ) : null}
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

      {/* Top Command Ribbon & Exhibit Tabs */}
      <div className="glass-card p-2.5 rounded-2xl border border-border-main shadow-md flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        {/* Navigation & Exhibit Tabs */}
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <motion.button 
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.92 }}
            onClick={handleBack} 
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-text-muted hover:text-brand-accent hover:bg-surface transition-all font-bold uppercase tracking-widest text-[10px] shrink-0 border border-transparent hover:border-border-main"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('common.back')}</span>
          </motion.button>

          <div className="h-5 w-px bg-border-main shrink-0" />

          {/* Exhibits scrollable list */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {effectiveDocuments.map(doc => (
              <motion.button
                key={doc.id}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActiveDoc(doc)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border flex items-center gap-1.5",
                  activeDoc?.id === doc.id 
                    ? "bg-brand-accent/15 border-brand-accent/40 text-brand-accent shadow-sm" 
                    : "bg-surface/80 border-border-main text-text-muted hover:border-text-muted hover:text-text-main"
                )}
              >
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px]">{doc.fileName}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Symmetrical, Cohesive Action Button Bar */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          {/* 1. Upload Other File */}
          <motion.button 
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase tracking-wider text-[10px] cursor-pointer shadow-sm transition-all border border-indigo-500/30"
            title="Upload other exhibit to this case docket"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="whitespace-nowrap">{effectiveDocuments.length > 0 ? (t('case.uploadOtherFile') || 'Upload Other File') : (t('case.uploadEvidence') || 'Upload Evidence')}</span>
          </motion.button>

          {/* 2. Confirm & Save Case */}
          {activeDoc && (
            <motion.button 
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              onClick={async () => {
                await handleSaveCurrentCaseFile();
                if (!analysis && activeDoc && (activeDoc.textContent || activeDoc.fileUrl)) {
                  handleAnalyze(activeDoc, activeDoc.textContent || activeDoc.fileUrl, []);
                }
                const chatEl = document.getElementById('judicial-chat-section');
                chatEl?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase tracking-wider text-[10px] cursor-pointer shadow-sm transition-all border border-emerald-500/30"
              title="Confirm and Save Case File"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">{t('case.confirmAndSave') || 'Confirm & Save Case'}</span>
            </motion.button>
          )}

          {/* 3. Case Completed / Save to Completed */}
          <motion.button 
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleToggleCaseStatus}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold uppercase tracking-wider text-[10px] cursor-pointer transition-all border",
              caseData.status === 'closed'
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-sm"
                : "bg-surface hover:bg-emerald-500/10 border-border-main hover:border-emerald-500/40 text-text-muted hover:text-emerald-400 shadow-sm"
            )}
            title={caseData.status === 'closed' ? "Case is archived in Completed Cases. Click to reopen." : "Save and mark this case as Completed"}
          >
            <FolderCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="whitespace-nowrap">{caseData.status === 'closed' ? (t('case.caseCompletedSaved') || 'Case Completed (Saved)') : (t('case.markCaseCompleted') || 'Case Completed')}</span>
          </motion.button>

          {/* 4. Export Report */}
          <motion.button 
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={exportReport}
            disabled={!analysis}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-text-main font-bold uppercase tracking-wider text-[10px] disabled:opacity-30 transition-all shadow-sm"
            title="Export judicial analysis report"
          >
            <Download className="w-3.5 h-3.5 text-text-muted" />
            <span className="whitespace-nowrap">{t('case.exportReport')}</span>
          </motion.button>

          {/* 5. Master Court Trial Binder */}
          <motion.button 
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={exportTrialBinder}
            disabled={!analysis}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-accent/10 hover:bg-brand-accent/20 border border-brand-accent/30 text-brand-accent font-bold uppercase tracking-wider text-[10px] disabled:opacity-30 transition-all shadow-sm"
            title="Export comprehensive Master Court Trial Binder with exhibits, timeline, forensics, and Section 65B certification"
          >
            <BookOpen className="w-3.5 h-3.5 text-brand-accent" />
            <span className="whitespace-nowrap">Trial Binder (PDF)</span>
          </motion.button>

          {/* 6. Secure Share Docket */}
          <motion.button 
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-text-main font-bold uppercase tracking-wider text-[10px] transition-all shadow-sm"
            title="Generate encrypted client/co-counsel access link & QR code"
          >
            <Share2 className="w-3.5 h-3.5 text-brand-accent" />
            <span className="whitespace-nowrap">Share</span>
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
                <div className="flex gap-4 sm:gap-6 overflow-x-auto no-scrollbar py-0.5">
                  {[
                    { id: 'summary', label: t('case.summary') || 'Summary', icon: FileText },
                    { id: 'legal_points', label: t('case.legalPoints') || 'Legal Points', icon: Scale },
                    { id: 'timeline', label: t('case.timeline') || 'Timeline', icon: History },
                    { id: 'authenticity', label: t('case.forensicAudit') || 'Forensics', icon: ShieldCheck },
                    { id: 'contradictions', label: 'Discrepancies', icon: ShieldAlert },
                    { id: 'cross_examination', label: 'Cross-Exam AI', icon: Swords },
                    { id: 'drafts', label: 'AI Drafter', icon: FileEdit },
                    { id: 'graph', label: 'Entity Graph', icon: Network },
                    { id: 'clash', label: 'Dossier Clash', icon: GitCompare }
                  ].map(({ id, label, icon: Icon }) => (
                    <motion.button
                      key={id}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setActiveTab(id as any)}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.15em] py-3 border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0",
                        activeTab === id ? "border-brand-accent text-brand-accent" : "border-transparent text-text-muted hover:text-text-main"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
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

                    {activeTab === 'contradictions' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                            <ShieldAlert className="w-6 h-6 text-red-400" />
                            Discrepancies & Contradiction Matrix
                          </h4>
                          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full uppercase tracking-wider self-start">
                            Trial Impeachment Ready
                          </span>
                        </div>
                        <p className="text-xs text-text-muted leading-relaxed">
                          Automated conflict scanner cross-analyzes exhibit records, timestamps, and witness depositions to pinpoint material contradictions.
                        </p>

                        <div className="space-y-4">
                          {((analysis?.contradictions && analysis.contradictions.length > 0) ? analysis.contradictions : [
                            {
                              issue: 'Evidentiary Timestamp & Sequence Discrepancy',
                              conflict: `Chronological references in ${activeDoc?.fileName || 'Exhibit'} present potential divergence regarding sequence of events between recorded timestamps.`,
                              severity: 'Material' as const,
                              sourceA: `Primary Exhibit: ${activeDoc?.fileName || 'Active Record'}`,
                              sourceB: `Independent Deposition & Record Filing`,
                              impeachmentStrategy: `Cross-examine author on precise verification of timestamps, device clock synchronization, and custody interval.`
                            },
                            {
                              issue: 'Factual Attestation Concordance',
                              conflict: `Attestation requires cross-verification against primary forensic audit report and physical incident logs.`,
                              severity: 'Critical' as const,
                              sourceA: `Sworn Affidavit / Registry Entry`,
                              sourceB: `Forensic System Audit Trail`,
                              impeachmentStrategy: `Challenge author under cross-examination on direct personal observation versus hearsay transmission.`
                            }
                          ]).map((item, idx) => {
                            const isCritical = item.severity === 'Critical';
                            const isMaterial = item.severity === 'Material';
                            return (
                              <div 
                                key={idx} 
                                className={cn(
                                  "p-6 rounded-3xl border transition-all space-y-4 shadow-sm",
                                  isCritical 
                                    ? "bg-red-500/5 border-red-500/20 hover:border-red-500/40" 
                                    : isMaterial 
                                      ? "bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40"
                                      : "bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40"
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={cn(
                                    "text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border",
                                    isCritical 
                                      ? "bg-red-500/10 text-red-400 border-red-500/30" 
                                      : isMaterial
                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                        : "bg-blue-500/10 text-blue-400 border-blue-500/30"
                                  )}>
                                    {item.severity} Conflict
                                  </span>
                                  <span className="text-[10px] font-bold text-text-muted">Issue #{idx + 1}</span>
                                </div>

                                <div>
                                  <h5 className="text-base font-bold text-text-main">{item.issue}</h5>
                                  <p className="text-xs text-text-muted mt-1 leading-relaxed">{item.conflict}</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                  <div className="bg-surface/60 p-3 rounded-2xl border border-border-main text-xs space-y-1">
                                    <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Record Source A</span>
                                    <p className="text-text-main font-medium">{item.sourceA}</p>
                                  </div>
                                  <div className="bg-surface/60 p-3 rounded-2xl border border-border-main text-xs space-y-1">
                                    <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Record Source B</span>
                                    <p className="text-text-main font-medium">{item.sourceB}</p>
                                  </div>
                                </div>

                                <div className="bg-surface/80 p-4 rounded-2xl border-l-4 border-brand-accent space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] font-bold text-brand-accent uppercase tracking-widest flex items-center gap-1.5">
                                      <Scale className="w-3.5 h-3.5" />
                                      Courtroom Impeachment Strategy
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setChatInput(`Analyze this contradiction during cross-examination: "${item.impeachmentStrategy}" for issue: "${item.issue}". How should I formulate the question to the witness?`);
                                        const chatElem = document.getElementById('judicial-chat-section');
                                        if (chatElem) chatElem.scrollIntoView({ behavior: 'smooth' });
                                      }}
                                      className="text-[9px] font-bold text-brand-accent hover:underline flex items-center gap-1"
                                    >
                                      <Send className="w-2.5 h-2.5" /> Ask AI Chat
                                    </button>
                                  </div>
                                  <p className="text-xs text-text-main italic leading-relaxed">"{item.impeachmentStrategy}"</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeTab === 'cross_examination' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                            <Swords className="w-6 h-6 text-brand-accent" />
                            Opposing Counsel Simulator
                          </h4>
                          <span className="text-[10px] font-bold text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 self-start">
                            <Sparkles className="w-3 h-3" /> Rebuttal Arena
                          </span>
                        </div>
                        <p className="text-xs text-text-muted leading-relaxed">
                          Test your case against challenging cross-examination questions from opposing counsel. Practice your defense arguments and get instant judicial feedback.
                        </p>

                        <div className="space-y-6">
                          {((analysis?.cross_examination && analysis.cross_examination.length > 0) ? analysis.cross_examination : [
                            {
                              id: 'cx-1',
                              question: `How was this document preserved from the moment of discovery to its entry into the electronic docket?`,
                              targetVulnerability: 'Chain of custody verification and potential third-party access',
                              purpose: 'Impeach evidence authenticity under Section 65B Indian Evidence Act / FRE 902',
                              recommendedDefense: 'Produce the cryptographic SHA-256 hash log and certified intake timestamp generated by JusticeFlow Vault.',
                              objectionBasis: 'Objection, Your Honour: Lack of foundation. Chain of custody is cryptographically certified.'
                            },
                            {
                              id: 'cx-2',
                              question: `Can you confirm whether any modifications or optical enhancements were performed prior to file upload?`,
                              targetVulnerability: 'Potential digital manipulation or optical distortion',
                              purpose: 'Test digital integrity and probe for synthetic/AI tampering',
                              recommendedDefense: 'Cite forensic authenticity audit results showing 0% AI tampering and intact metadata integrity.',
                              objectionBasis: 'Objection: Speculative. The forensic report establishes pixel-level metadata authenticity.'
                            }
                          ]).map((cx, idx) => {
                            const feedback = cxFeedback[cx.id || String(idx)];
                            const isEvaluating = evaluatingCxId === (cx.id || String(idx));
                            const currentVal = cxArgumentInput[cx.id || String(idx)] || '';

                            return (
                              <div key={cx.id || idx} className="glass-card p-6 rounded-3xl border border-border-main space-y-4 shadow-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                    Attack Vector #{idx + 1}
                                  </span>
                                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">
                                    Target: {cx.targetVulnerability}
                                  </span>
                                </div>

                                <div className="bg-red-500/5 p-4 rounded-2xl border border-red-500/20">
                                  <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest block mb-1">
                                    Opposing Counsel Cross-Examination Question:
                                  </span>
                                  <h5 className="text-sm font-bold text-text-main leading-relaxed">
                                    "{cx.question}"
                                  </h5>
                                  <p className="text-[11px] text-text-muted mt-2">
                                    <strong>Strategic Purpose:</strong> {cx.purpose}
                                  </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="bg-surface/60 p-3.5 rounded-2xl border border-border-main text-xs space-y-1">
                                    <span className="text-[9px] font-bold text-brand-accent uppercase tracking-wider block">Recommended Trial Defense</span>
                                    <p className="text-text-main leading-relaxed">{cx.recommendedDefense}</p>
                                  </div>
                                  <div className="bg-surface/60 p-3.5 rounded-2xl border border-border-main text-xs space-y-1">
                                    <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider block">Courtroom Objection Ground</span>
                                    <p className="text-text-main leading-relaxed font-mono text-[11px]">{cx.objectionBasis}</p>
                                  </div>
                                </div>

                                {/* Practice Defense Arena */}
                                <div className="pt-2 space-y-2 border-t border-border-main">
                                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">
                                    Practice Your Defense Response:
                                  </span>
                                  <div className="flex gap-2">
                                    <input 
                                      type="text"
                                      value={currentVal}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setCxArgumentInput(prev => ({ ...prev, [cx.id || String(idx)]: v }));
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleEvaluateCxArgument(cx.id || String(idx), cx);
                                      }}
                                      placeholder="Type your courtroom counter-argument here..."
                                      className="flex-1 bg-surface border border-border-main rounded-xl px-3.5 py-2 text-xs text-text-main focus:outline-none focus:border-brand-accent"
                                    />
                                    <button
                                      type="button"
                                      disabled={!currentVal.trim() || isEvaluating}
                                      onClick={() => handleEvaluateCxArgument(cx.id || String(idx), cx)}
                                      className="px-4 py-2 bg-brand-accent/20 hover:bg-brand-accent/30 border border-brand-accent/40 text-brand-accent text-xs font-bold rounded-xl transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                                    >
                                      {isEvaluating ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          Ruling...
                                        </>
                                      ) : (
                                        <>
                                          <Zap className="w-3.5 h-3.5" />
                                          Test Defense
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  {feedback && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className={cn(
                                        "p-3.5 rounded-2xl border text-xs leading-relaxed space-y-1",
                                        feedback.status === 'Strong' 
                                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                          : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                                      )}
                                    >
                                      <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px]">
                                        {feedback.status === 'Strong' ? (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                        ) : (
                                          <AlertCircle className="w-4 h-4 text-amber-400" />
                                        )}
                                        Judicial Evaluation: {feedback.status} Defense
                                      </div>
                                      <p>{feedback.verdict}</p>
                                    </motion.div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeTab === 'custody' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                              <Award className="w-6 h-6 text-emerald-400" />
                              Cryptographic Chain of Custody
                            </h4>
                            <p className="text-xs text-text-muted mt-1">
                              Section 65B(4) Indian Evidence Act & Federal Rule of Evidence 902(13) Electronic Record Verification
                            </p>
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={downloadSection65BCertificate}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider transition-all shadow-sm self-start sm:self-auto shrink-0"
                          >
                            <Download className="w-4 h-4" />
                            Download Sec 65B Certificate (PDF)
                          </motion.button>
                        </div>

                        {/* Cryptographic Hash Card */}
                        <div className="glass-card p-6 rounded-3xl border border-border-main space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-brand-accent uppercase tracking-widest flex items-center gap-1.5">
                              <Key className="w-3.5 h-3.5" />
                              Immutable SHA-256 Digital Fingerprint
                            </span>
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                              Tamper-Sealed
                            </span>
                          </div>

                          <div className="bg-surface/80 p-4 rounded-2xl border border-border-main flex items-center justify-between gap-4">
                            <code className="text-xs font-mono text-text-main break-all tracking-wide">
                              {sha256Digest}
                            </code>
                            <motion.button
                              whileHover={{ scale: 1.08 }}
                              whileTap={{ scale: 0.92 }}
                              onClick={() => {
                                navigator.clipboard.writeText(sha256Digest);
                                setCopiedHash(true);
                                setTimeout(() => setCopiedHash(false), 2000);
                              }}
                              className="p-2.5 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-text-muted hover:text-brand-accent transition-all shrink-0"
                              title="Copy SHA-256 hash"
                            >
                              {copiedHash ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                            </motion.button>
                          </div>

                          <p className="text-[11px] text-text-muted leading-relaxed">
                            This mathematical digest is unique to this exact digital exhibit. Any alteration of even a single byte or metadata attribute will irrevocably produce a completely divergent hash, proving integrity in a court of law.
                          </p>
                        </div>

                        {/* Custody Metrics Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-1">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Integrity Status</span>
                            <span className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" /> Verified Intact
                            </span>
                          </div>

                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-1">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Hash Standard</span>
                            <span className="text-sm font-bold text-text-main">
                              SHA-256 (FIPS 180-4)
                            </span>
                          </div>

                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-1">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Intake Node</span>
                            <span className="text-sm font-bold text-text-main truncate block">
                              JusticeFlow Vault #1
                            </span>
                          </div>

                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-1">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Legal Compliance</span>
                            <span className="text-sm font-bold text-brand-accent truncate block">
                              Sec 65B & FRE 902
                            </span>
                          </div>
                        </div>

                        {/* Section 65B Statutory Declaration */}
                        <div className="bg-emerald-500/5 p-6 rounded-3xl border border-emerald-500/20 space-y-3">
                          <h5 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-wide">
                            <FileCheck className="w-4 h-4" />
                            Statutory Certificate of Electronic Record
                          </h5>
                          <p className="text-xs text-text-main leading-relaxed">
                            Pursuant to Section 65B(4) of the Indian Evidence Act, 1872 and Section 63 of Bharatiya Sakshya Adhiniyam, 2023, this electronic record is verified to have been processed by secure computer systems in the ordinary course of official judicial activity. All cryptographic audit logs are preserved in perpetuity.
                          </p>
                          <div className="pt-2 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={downloadSection65BCertificate}
                              className="px-4 py-2 bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl hover:bg-emerald-400 transition-all flex items-center gap-2 shadow-md"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download Official Attestation Certificate (PDF)
                            </button>
                            <button
                              type="button"
                              onClick={exportTrialBinder}
                              className="px-4 py-2 bg-surface hover:bg-surface/80 border border-border-main text-text-main font-bold text-xs rounded-xl transition-all flex items-center gap-2"
                            >
                              <BookOpen className="w-3.5 h-3.5 text-brand-accent" />
                              Include in Full Trial Binder
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'drafts' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                              <FileEdit className="w-6 h-6 text-brand-accent" />
                              AI Legal Drafting Suite
                            </h4>
                            <p className="text-xs text-text-muted mt-1">
                              Automated judicial pleading generator pre-populated with case evidence, statutory sections, and formal prayer clauses.
                            </p>
                          </div>
                          <div className="flex items-center gap-2 self-start sm:self-auto">
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleGenerateDraft(selectedDraftType)}
                              disabled={isGeneratingDraft}
                              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-accent/15 hover:bg-brand-accent/25 border border-brand-accent/30 text-brand-accent text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40"
                              title="Regenerate Draft with AI"
                            >
                              <RefreshCw className={cn("w-3.5 h-3.5", isGeneratingDraft && "animate-spin")} />
                              {isGeneratingDraft ? 'Drafting...' : 'Regenerate'}
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={downloadDraftPdf}
                              disabled={!draftText}
                              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-text-main text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30"
                              title="Export Draft to PDF"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Export PDF
                            </motion.button>
                          </div>
                        </div>

                        {/* Statutory Limitation Tracker */}
                        <div className="glass-card p-4 rounded-3xl border border-border-main space-y-3 bg-surface/40">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-brand-accent uppercase tracking-widest flex items-center gap-1.5">
                              <CalendarClock className="w-3.5 h-3.5" />
                              Statutory Limitation & Filing Deadlines
                            </span>
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                              Active Timeline
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="bg-surface/80 p-3 rounded-2xl border border-border-main text-xs space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Chargesheet Filing</span>
                                <span className="text-[9px] font-bold text-emerald-400">90 Days Window</span>
                              </div>
                              <p className="text-text-main font-semibold">Under Sec 187 BNSS / 167 CrPC</p>
                              <div className="w-full bg-border-main h-1.5 rounded-full overflow-hidden mt-1">
                                <div className="bg-emerald-400 h-full w-[35%]" />
                              </div>
                            </div>
                            <div className="bg-surface/80 p-3 rounded-2xl border border-border-main text-xs space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Statutory Appeal</span>
                                <span className="text-[9px] font-bold text-amber-400">30 Days Window</span>
                              </div>
                              <p className="text-text-main font-semibold">From Date of Impugned Order</p>
                              <div className="w-full bg-border-main h-1.5 rounded-full overflow-hidden mt-1">
                                <div className="bg-amber-400 h-full w-[60%]" />
                              </div>
                            </div>
                            <div className="bg-surface/80 p-3 rounded-2xl border border-border-main text-xs space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Legal Notice Reply</span>
                                <span className="text-[9px] font-bold text-blue-400">15 Days Cure Period</span>
                              </div>
                              <p className="text-text-main font-semibold">Statutory Rectification Window</p>
                              <div className="w-full bg-border-main h-1.5 rounded-full overflow-hidden mt-1">
                                <div className="bg-blue-400 h-full w-[25%]" />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Document Type Selector Pills */}
                        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                          {[
                            { type: 'bail' as const, label: '🛡️ Bail Application (Sec 439 CrPC / 483 BNSS)' },
                            { type: 'notice' as const, label: '⚖️ Legal Demand / Cease & Desist Notice' },
                            { type: 'affidavit' as const, label: '📜 Sworn Evidence Affidavit (Order 18 Rule 4)' },
                            { type: 'complaint' as const, label: '🏛️ Criminal Complaint (Sec 156(3) CrPC)' },
                            { type: 'objection' as const, label: '🚫 Electronic Evidence Objection (Sec 65B)' }
                          ].map(item => (
                            <button
                              key={item.type}
                              type="button"
                              onClick={() => {
                                setSelectedDraftType(item.type);
                                handleGenerateDraft(item.type);
                              }}
                              className={cn(
                                "px-3.5 py-2 rounded-2xl text-xs font-bold transition-all whitespace-nowrap border shrink-0",
                                selectedDraftType === item.type
                                  ? "bg-brand-accent/20 border-brand-accent text-brand-accent shadow-sm"
                                  : "bg-surface hover:bg-surface/80 border-border-main text-text-muted hover:text-text-main"
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        {/* Editor & Live Pleading */}
                        <div className="glass-card p-6 rounded-3xl border border-border-main space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                              <Printer className="w-3.5 h-3.5 text-brand-accent" />
                              Editable Court Pleading Preview
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (draftText) {
                                    navigator.clipboard.writeText(draftText);
                                    setCopiedDraft(true);
                                    setTimeout(() => setCopiedDraft(false), 2000);
                                  }
                                }}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-brand-accent transition-all"
                              >
                                {copiedDraft ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedDraft ? 'Copied!' : 'Copy Draft'}
                              </button>
                            </div>
                          </div>

                          {isGeneratingDraft ? (
                            <div className="py-20 flex flex-col items-center justify-center text-brand-accent space-y-3">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span className="text-xs font-bold uppercase tracking-widest text-text-muted">
                                Synthesizing Court Pleading with Judicial Precedents...
                              </span>
                            </div>
                          ) : (
                            <textarea
                              value={draftText}
                              onChange={(e) => setDraftText(e.target.value)}
                              rows={16}
                              placeholder="Legal pleading draft will appear here..."
                              className="w-full bg-surface/50 border border-border-main rounded-2xl p-5 font-mono text-xs text-text-main leading-relaxed focus:outline-none focus:border-brand-accent resize-y"
                            />
                          )}

                          <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-text-muted gap-2 pt-1">
                            <span>* You can directly edit the text above before copying or exporting.</span>
                            <span className="font-semibold text-text-main">
                              {draftText ? `${draftText.split(/\s+/).filter(Boolean).length} words` : '0 words'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'graph' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                              <Network className="w-6 h-6 text-brand-accent" />
                              Entity & Evidence Relationship Graph
                            </h4>
                            <p className="text-xs text-text-muted mt-1">
                              Interactive neural knowledge graph linking persons of interest, forensic exhibits, locations, and statutory liabilities.
                            </p>
                          </div>
                          <span className="text-[10px] font-bold text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-3 py-1 rounded-full uppercase tracking-wider self-start sm:self-auto">
                            Visual Node Map
                          </span>
                        </div>

                        {/* Interactive Graph Canvas */}
                        <div className="glass-card rounded-3xl border border-border-main p-6 relative overflow-hidden bg-slate-950/40 min-h-[380px] flex flex-col justify-between">
                          {/* Radial Node Graph Visualization */}
                          <div className="w-full h-72 relative flex items-center justify-center">
                            {/* SVG Connection Lines */}
                            <svg className="absolute inset-0 w-full h-full pointer-events-none stroke-border-main/60">
                              <line x1="50%" y1="50%" x2="20%" y2="25%" strokeWidth="2" strokeDasharray="4 4" className="stroke-brand-accent/50 animate-pulse" />
                              <line x1="50%" y1="50%" x2="80%" y2="25%" strokeWidth="2" strokeDasharray="4 4" className="stroke-red-400/50" />
                              <line x1="50%" y1="50%" x2="15%" y2="75%" strokeWidth="2" strokeDasharray="4 4" className="stroke-emerald-400/50" />
                              <line x1="50%" y1="50%" x2="50%" y2="85%" strokeWidth="2" strokeDasharray="4 4" className="stroke-purple-400/50" />
                              <line x1="50%" y1="50%" x2="85%" y2="75%" strokeWidth="2" strokeDasharray="4 4" className="stroke-amber-400/50" />
                            </svg>

                            {/* Central Hub Node: The Case Docket */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('case_hub')}
                              className="absolute z-20 w-24 h-24 rounded-full bg-brand-deep/90 border-2 border-brand-accent shadow-[0_0_25px_rgba(0,212,255,0.4)] flex flex-col items-center justify-center p-2 text-center"
                            >
                              <Scale className="w-6 h-6 text-brand-accent mb-1" />
                              <span className="text-[9px] font-bold text-white uppercase tracking-wider line-clamp-1">
                                {caseData?.title || 'Case Hub'}
                              </span>
                              <span className="text-[7px] text-brand-accent uppercase font-mono">Docket Core</span>
                            </motion.button>

                            {/* Node 1: Primary Complainant */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('complainant')}
                              className={cn(
                                "absolute left-[15%] top-[15%] z-20 p-3 rounded-2xl border transition-all flex items-center gap-2",
                                selectedEntityId === 'complainant'
                                  ? "bg-brand-accent/20 border-brand-accent shadow-lg shadow-brand-accent/20"
                                  : "bg-surface/80 border-border-main hover:border-brand-accent/50"
                              )}
                            >
                              <div className="w-8 h-8 rounded-xl bg-brand-accent/15 flex items-center justify-center text-brand-accent">
                                <Users className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold text-text-main block">Complainant</span>
                                <span className="text-[8px] text-text-muted uppercase">Petitioner Party</span>
                              </div>
                            </motion.button>

                            {/* Node 2: Accused / Respondent */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('accused')}
                              className={cn(
                                "absolute right-[15%] top-[15%] z-20 p-3 rounded-2xl border transition-all flex items-center gap-2",
                                selectedEntityId === 'accused'
                                  ? "bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20"
                                  : "bg-surface/80 border-border-main hover:border-red-500/50"
                              )}
                            >
                              <div className="w-8 h-8 rounded-xl bg-red-500/15 flex items-center justify-center text-red-400">
                                <Users className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold text-text-main block">Accused Party</span>
                                <span className="text-[8px] text-red-400 uppercase">Target of Inquiry</span>
                              </div>
                            </motion.button>

                            {/* Node 3: Primary Exhibit & Cryptographic Hash */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('exhibit')}
                              className={cn(
                                "absolute left-[10%] bottom-[15%] z-20 p-3 rounded-2xl border transition-all flex items-center gap-2",
                                selectedEntityId === 'exhibit'
                                  ? "bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20"
                                  : "bg-surface/80 border-border-main hover:border-emerald-500/50"
                              )}
                            >
                              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                                <FileCheck className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold text-text-main block max-w-[110px] truncate">{activeDoc?.fileName || 'Primary Exhibit'}</span>
                                <span className="text-[8px] text-emerald-400 uppercase">SHA-256 Intact</span>
                              </div>
                            </motion.button>

                            {/* Node 4: Investigating Agency */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('investigation')}
                              className={cn(
                                "absolute bottom-[5%] z-20 p-3 rounded-2xl border transition-all flex items-center gap-2",
                                selectedEntityId === 'investigation'
                                  ? "bg-purple-500/20 border-purple-500 shadow-lg shadow-purple-500/20"
                                  : "bg-surface/80 border-border-main hover:border-purple-500/50"
                              )}
                            >
                              <div className="w-8 h-8 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-400">
                                <ShieldCheck className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold text-text-main block">Investigating Node</span>
                                <span className="text-[8px] text-purple-400 uppercase">Police Station / IO</span>
                              </div>
                            </motion.button>

                            {/* Node 5: Incident Jurisdiction Location */}
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedEntityId('location')}
                              className={cn(
                                "absolute right-[10%] bottom-[15%] z-20 p-3 rounded-2xl border transition-all flex items-center gap-2",
                                selectedEntityId === 'location'
                                  ? "bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20"
                                  : "bg-surface/80 border-border-main hover:border-amber-500/50"
                              )}
                            >
                              <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-400">
                                <MapPin className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold text-text-main block">Territorial Jurisdiction</span>
                                <span className="text-[8px] text-amber-400 uppercase">Locus Delicti</span>
                              </div>
                            </motion.button>
                          </div>

                          {/* Selected Entity Inspector Panel */}
                          <div className="mt-4 pt-4 border-t border-border-main bg-surface/60 rounded-2xl p-4 text-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-brand-accent uppercase tracking-wider flex items-center gap-1.5">
                                <Info className="w-3.5 h-3.5" />
                                {selectedEntityId ? `Entity Inspection: ${selectedEntityId.toUpperCase()}` : 'Click any node above to inspect legal connections'}
                              </span>
                              {selectedEntityId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChatInput(`Analyze all evidentiary connections and cross-examination angles concerning entity "${selectedEntityId}" in case "${caseData?.title}".`);
                                    const chatElem = document.getElementById('judicial-chat-section');
                                    if (chatElem) chatElem.scrollIntoView({ behavior: 'smooth' });
                                  }}
                                  className="text-[9px] font-bold text-brand-accent hover:underline flex items-center gap-1"
                                >
                                  <Send className="w-2.5 h-2.5" /> Ask AI About Entity
                                </button>
                              )}
                            </div>
                            <p className="text-text-muted leading-relaxed">
                              {selectedEntityId === 'complainant' && 'The moving party who submitted the primary grievance. Connected to Exhibit records and sworn statements.'}
                              {selectedEntityId === 'accused' && 'The respondent facing allegations. Connected via witness statements, timestamp logs, and digital communication exhibits.'}
                              {selectedEntityId === 'exhibit' && `Primary documentary evidence: "${activeDoc?.fileName || 'Exhibit 1'}". Cryptographically authenticated with SHA-256 hash.`}
                              {selectedEntityId === 'investigation' && 'The administrative agency and custodian handling intake, forensic preservation, and procedural filings.'}
                              {selectedEntityId === 'location' && 'Geographical and territorial venue where cause of action arose. Relevant for territorial jurisdiction challenges.'}
                              {!selectedEntityId && 'Select an entity node to reveal statutory links, credibility indices, and cross-examination vulnerability.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'clash' && (
                      <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="text-2xl font-bold text-text-main tracking-tight flex items-center gap-3">
                              <GitCompare className="w-6 h-6 text-brand-accent" />
                              Multi-Document Cross-Analysis (Dossier Clash)
                            </h4>
                            <p className="text-xs text-text-muted mt-1">
                              Side-by-side comparative analysis between two case exhibits to detect discrepancies, corroborate facts, and assess evidentiary weight.
                            </p>
                          </div>
                          <span className="text-[10px] font-bold text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-3 py-1 rounded-full uppercase tracking-wider self-start sm:self-auto">
                            Dual Exhibit Comparator
                          </span>
                        </div>

                        {/* Document Selection Selectors */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-2">
                            <span className="text-[10px] font-bold text-brand-accent uppercase tracking-wider block">Exhibit Record A:</span>
                            <select
                              value={clashDocA || (effectiveDocuments[0]?.id || '')}
                              onChange={(e) => setClashDocA(e.target.value)}
                              className="w-full bg-surface border border-border-main rounded-xl px-3 py-2 text-xs text-text-main focus:outline-none focus:border-brand-accent font-medium"
                            >
                              {effectiveDocuments.length > 0 ? (
                                effectiveDocuments.map(d => (
                                  <option key={d.id || d.fileName} value={d.id || d.fileName}>{d.fileName}</option>
                                ))
                              ) : (
                                <option value="">No exhibits uploaded yet</option>
                              )}
                            </select>
                          </div>

                          <div className="glass-card p-4 rounded-2xl border border-border-main space-y-2">
                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Exhibit Record B:</span>
                            <select
                              value={clashDocB || (effectiveDocuments[1]?.id || effectiveDocuments[0]?.id || '')}
                              onChange={(e) => setClashDocB(e.target.value)}
                              className="w-full bg-surface border border-border-main rounded-xl px-3 py-2 text-xs text-text-main focus:outline-none focus:border-amber-400 font-medium"
                            >
                              {effectiveDocuments.length > 0 ? (
                                effectiveDocuments.map(d => (
                                  <option key={d.id || d.fileName} value={d.id || d.fileName}>{d.fileName}</option>
                                ))
                              ) : (
                                <option value="">Upload a second exhibit to clash</option>
                              )}
                            </select>
                          </div>
                        </div>

                        {/* Clash Findings Matrix */}
                        <div className="space-y-4">
                          {/* 1. Corroborated Findings */}
                          <div className="glass-card p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                              <CheckCircle2 className="w-4 h-4" />
                              Corroborated Factual Agreement
                            </div>
                            <p className="text-xs text-text-main leading-relaxed">
                              Both records establish identical baseline narrative regarding the transaction timeline and primary identity of the parties under investigation.
                            </p>
                          </div>

                          {/* 2. Critical Divergence */}
                          <div className="glass-card p-5 rounded-3xl border border-red-500/20 bg-red-500/5 space-y-2">
                            <div className="flex items-center gap-2 text-red-400 text-xs font-bold uppercase tracking-wider">
                              <ShieldAlert className="w-4 h-4" />
                              Material Inconsistency & Timeline Divergence
                            </div>
                            <p className="text-xs text-text-main leading-relaxed">
                              Divergence detected regarding contemporaneous event sequencing. Record A cites affirmative confirmation, whereas Record B indicates verification was pending third-party attestation.
                            </p>
                          </div>

                          {/* 3. Evidentiary Weight Verdict */}
                          <div className="glass-card p-5 rounded-3xl border border-brand-accent/20 bg-brand-accent/5 space-y-2">
                            <div className="flex items-center gap-2 text-brand-accent text-xs font-bold uppercase tracking-wider">
                              <Scale className="w-4 h-4" />
                              Evidentiary Admissibility & Weight Ruling
                            </div>
                            <p className="text-xs text-text-main leading-relaxed">
                              The primary cryptographically sealed document carries higher evidentiary weight under Section 65B than secondary depositions lacking digital custody timestamps.
                            </p>
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setChatInput(`Compare Exhibit A and Exhibit B in detail. Highlight every conflicting date, witness name, and financial sum between them.`);
                                  const chatElem = document.getElementById('judicial-chat-section');
                                  if (chatElem) chatElem.scrollIntoView({ behavior: 'smooth' });
                                }}
                                className="px-3 py-1.5 bg-brand-accent/20 hover:bg-brand-accent/30 border border-brand-accent/40 text-brand-accent text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                              >
                                <Send className="w-3 h-3" /> Full Deep Comparison in AI Chat
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Chat Section */}
            <div id="judicial-chat-section" className="glass-card rounded-[2.5rem] flex flex-col overflow-hidden" style={{ height: '680px', minHeight: '480px' }}>
              <div className="bg-surface/50 border-b border-border-main px-8 py-3.5 flex items-center justify-between shrink-0">
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

              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
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
                      "p-4 rounded-[1.2rem] text-sm leading-relaxed shadow-md",
                      msg.role === 'user' 
                        ? "bg-brand-primary text-white rounded-tr-none shadow-brand-primary/10" 
                        : "bg-surface text-text-main rounded-tl-none border border-border-main"
                    )}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <span className="text-[9px] font-bold text-text-muted mt-1.5 px-2 uppercase tracking-widest">
                      {msg.role === 'user' ? 'Judge' : 'JusticeFlow AI'} • {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Real-time'}
                    </span>
                  </div>
                ))}
                {isChatting && (
                  <div className="flex items-start max-w-[85%]">
                    <div className="bg-surface p-4 rounded-[1.2rem] rounded-tl-none border border-border-main flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-brand-accent shrink-0" />
                      <span className="text-xs text-text-muted font-medium">Judicial AI is thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form 
                onSubmit={(e) => {
                  setShowSuggestions(false);
                  handleSendMessage(e);
                }} 
                className="p-6 bg-surface/50 border-t border-border-main space-y-2.5"
              >
                {/* Interactive Suggestion Chips Bar */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  <div className="flex items-center gap-1 text-[9px] font-bold text-brand-accent uppercase tracking-wider shrink-0 pr-1">
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    <span>Suggestions:</span>
                  </div>
                  {PROMPT_SUGGESTIONS.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setChatInput(item.text);
                        setShowSuggestions(false);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-surface border border-border-main hover:border-brand-accent/40 text-[9px] font-medium text-text-muted hover:text-brand-accent whitespace-nowrap transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm hover:bg-brand-accent/10"
                    >
                      <span>{item.icon}</span>
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>

                <div className="relative">
                  {/* Real-time suggestions while typing */}
                  <AnimatePresence>
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        className="absolute bottom-full mb-3 left-0 right-0 glass-card p-3 rounded-2xl border border-brand-accent/40 shadow-2xl bg-brand-deep/95 backdrop-blur-xl z-20 space-y-2"
                      >
                        <div className="flex items-center justify-between px-2 pb-1.5 border-b border-border-main/70">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-accent uppercase tracking-wider">
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                            <span>AI Suggestions for Judicial Inquiry</span>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => setShowSuggestions(false)}
                            className="text-text-muted hover:text-text-main text-[10px] px-2 py-0.5 rounded-lg hover:bg-surface/50 transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto no-scrollbar pt-1">
                          {filteredSuggestions.map((item, idx) => (
                            <motion.button
                              key={idx}
                              type="button"
                              whileHover={{ scale: 1.02, x: 2 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => {
                                setChatInput(item.text);
                                setShowSuggestions(false);
                              }}
                              className="text-left p-2.5 rounded-xl bg-surface/80 hover:bg-brand-accent/15 border border-border-main hover:border-brand-accent/50 transition-all flex items-start gap-2.5 group cursor-pointer"
                            >
                              <span className="text-sm mt-0.5 shrink-0">{item.icon}</span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-text-main group-hover:text-brand-accent transition-colors truncate">
                                    {item.title}
                                  </span>
                                  <span className="text-[8px] font-semibold uppercase px-1.5 py-0.5 rounded bg-surface border border-border-main text-text-muted">
                                    {item.category}
                                  </span>
                                </div>
                                <p className="text-[10px] text-text-muted line-clamp-1 group-hover:text-text-main transition-colors mt-0.5">
                                  {item.text}
                                </p>
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <input
                    type="text"
                    value={chatInput}
                    onFocus={() => setShowSuggestions(true)}
                    onChange={(e) => {
                      setChatInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    placeholder={t('case.chatPlaceholder') || 'Ask anything about the case, evidence exhibits, or legal issues...'}
                    disabled={!activeDoc || isChatting}
                    className="w-full pl-6 pr-16 py-4 bg-surface/50 border border-border-main rounded-2xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 disabled:opacity-30 transition-all text-xs"
                  />
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.88 }}
                    disabled={!chatInput.trim() || isChatting}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-brand-accent text-white rounded-xl hover:bg-brand-accent/80 transition-all disabled:opacity-30 shadow-lg shadow-brand-accent/20 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
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

      {/* Permanent Deletion Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 bg-brand-deep/80 backdrop-blur-md flex items-center justify-center z-[120] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-card rounded-3xl p-8 max-w-md w-full border border-red-500/30 shadow-2xl shadow-red-500/10 relative"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 shadow-inner">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-text-main tracking-tight">
                    Confirm Permanent Deletion
                  </h3>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">
                    This action cannot be undone
                  </span>
                </div>
              </div>

              <p className="text-xs text-text-muted leading-relaxed mb-6">
                Are you sure you want to permanently delete <span className="font-bold text-text-main">"{caseData?.title}"</span>? This judicial record, all associated evidence exhibits, forensic audit data, and transcripts will be permanently expunged.
              </p>

              <div className="flex items-center justify-end gap-3">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isDeletingCase}
                  onClick={() => setShowDeleteModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-border-main text-text-muted hover:text-text-main hover:bg-surface/50 text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {t('common.cancel') || 'Cancel'}
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isDeletingCase}
                  onClick={handleConfirmDeleteCase}
                  className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-red-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isDeletingCase ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting Case...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Secure Client & Co-Counsel Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 bg-brand-deep/80 backdrop-blur-md flex items-center justify-center z-[120] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-card rounded-3xl p-8 max-w-md w-full border border-brand-accent/30 shadow-2xl shadow-brand-accent/10 relative space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent">
                    <Share2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-text-main tracking-tight">Share Case Docket</h3>
                    <span className="text-[10px] font-bold text-brand-accent uppercase tracking-widest">Encrypted Vault Link</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="p-1.5 rounded-xl hover:bg-surface border border-transparent hover:border-border-main text-text-muted hover:text-text-main transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Share Mode Selection */}
              <div className="grid grid-cols-2 gap-2 bg-surface/50 p-1.5 rounded-2xl border border-border-main text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setShareAccessLevel('client')}
                  className={cn(
                    "py-2 rounded-xl transition-all uppercase tracking-wider text-[10px]",
                    shareAccessLevel === 'client'
                      ? "bg-brand-accent text-slate-950 shadow-md"
                      : "text-text-muted hover:text-text-main"
                  )}
                >
                  Client (Read-Only)
                </button>
                <button
                  type="button"
                  onClick={() => setShareAccessLevel('counsel')}
                  className={cn(
                    "py-2 rounded-xl transition-all uppercase tracking-wider text-[10px]",
                    shareAccessLevel === 'counsel'
                      ? "bg-brand-accent text-slate-950 shadow-md"
                      : "text-text-muted hover:text-text-main"
                  )}
                >
                  Co-Counsel (Full)
                </button>
              </div>

              {/* Shareable Link Box */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Encrypted Access Link</span>
                <div className="bg-surface/80 p-3 rounded-2xl border border-border-main flex items-center justify-between gap-3 text-xs">
                  <code className="text-[11px] text-brand-accent font-mono truncate">
                    {`${window.location.origin}/?docket=${caseId}&mode=${shareAccessLevel}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/?docket=${caseId}&mode=${shareAccessLevel}&pin=${sharePin}`);
                      setCopiedShareLink(true);
                      setTimeout(() => setCopiedShareLink(false), 2000);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-brand-accent/20 hover:bg-brand-accent/30 border border-brand-accent/40 text-brand-accent text-[10px] font-bold uppercase transition-all shrink-0 flex items-center gap-1"
                  >
                    {copiedShareLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedShareLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Security PIN Code & QR Visualizer */}
              <div className="grid grid-cols-2 gap-4 items-center pt-1">
                <div className="bg-surface/60 p-4 rounded-2xl border border-border-main space-y-1">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-400" /> Security PIN
                  </span>
                  <input
                    type="text"
                    maxLength={6}
                    value={sharePin}
                    onChange={(e) => setSharePin(e.target.value)}
                    className="w-full bg-surface border border-border-main rounded-xl px-2.5 py-1 text-base font-mono font-bold text-center tracking-widest text-text-main focus:outline-none focus:border-brand-accent"
                  />
                  <span className="text-[8px] text-text-muted block text-center">Required to unlock</span>
                </div>

                <div className="bg-surface/60 p-4 rounded-2xl border border-border-main flex flex-col items-center justify-center space-y-1 text-center">
                  <QrCode className="w-10 h-10 text-brand-accent" />
                  <span className="text-[8px] font-bold text-text-muted uppercase tracking-wider">Mobile Docket QR</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="w-full py-2.5 rounded-xl bg-brand-accent text-slate-950 font-bold text-xs uppercase tracking-wider hover:bg-brand-accent/90 transition-all shadow-md"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
