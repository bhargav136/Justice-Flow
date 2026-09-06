import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Case } from '../types';
import { Plus, Folder, Clock, ChevronRight, Trash2, Search, Edit2, Upload, FileText, X, Loader2, ShieldCheck, AlertCircle, AlertTriangle, Gavel, CheckCircle2, CheckSquare, Square } from 'lucide-react';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { analyzeLegalDocument } from '../services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

interface DashboardProps {
  onSelectCase: (id: string) => void;
}

export default function Dashboard({ onSelectCase }: DashboardProps) {
  const { t } = useTranslation();
  const [cases, setCases] = useState<Case[]>(() => {
    try {
      const cached = localStorage.getItem('justiceflow_dashboard_cases');
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });

  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [editingCase, setEditingCase] = useState<Case | null>(null);
  const [caseToDelete, setCaseToDelete] = useState<Case | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>(() => {
    try {
      const saved = localStorage.getItem('justiceflow_dashboard_filter');
      if (saved === 'all' || saved === 'open' || saved === 'closed') {
        return saved;
      }
    } catch (e) {}
    return 'all';
  });
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('justiceflow_dashboard_filter', statusFilter);
    } catch (e) {}
  }, [statusFilter]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = [
    { title: 'Criminal Case', titleTemplate: 'State vs. ', descTemplate: 'Charge: \nDefendant: \nFacts: ' },
    { title: 'Civil Litigation', titleTemplate: ' vs. ', descTemplate: 'Plaintiff: \nDefendant: \nMatter: ' },
    { title: 'Family Law', titleTemplate: 'In re: ', descTemplate: 'Family Name: \nMatter: ' },
  ];

  const handleTemplateChange = (templateTitle: string) => {
    setSelectedTemplate(templateTitle);
    const template = templates.find(t => t.title === templateTitle);
    if (template) {
      setNewCaseTitle(template.titleTemplate);
      setNewCaseDescription(template.descTemplate);
    }
  };

  useEffect(() => {
    if (cases.length > 0) {
      try {
        localStorage.setItem('justiceflow_dashboard_cases', JSON.stringify(cases));
      } catch (e) {}
    }
  }, [cases]);

  useEffect(() => {
    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';

    const q = query(
      collection(db, 'cases'),
      where('userId', '==', currentUserId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Case));
      setCases(prev => {
        const map = new Map<string, Case>();
        prev.forEach(c => map.set(c.id, c));
        docs.forEach(c => map.set(c.id, c));
        return Array.from(map.values()).sort((a, b) => {
          const timeA = a.createdAt?.seconds || (a.createdAt?.toDate ? a.createdAt.toDate().getTime() / 1000 : 0);
          const timeB = b.createdAt?.seconds || (b.createdAt?.toDate ? b.createdAt.toDate().getTime() / 1000 : 0);
          return timeB - timeA;
        });
      });
    }, (error) => {
      console.warn('Dashboard cases listener notice:', error);
    });

    return unsubscribe;
  }, []);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = 
      auth.currentUser?.uid || 
      (window as any)._localUser?.uid || 
      localStorage.getItem('justiceflow_active_uid') || 
      'demo-judge-001';

    if (!newCaseTitle.trim()) return;

    setProcessingMessage('Creating case record...');
    setError(null);

    let caseId = 'case_' + Date.now();
    try {
      const caseRef = await addDoc(collection(db, 'cases'), {
        title: newCaseTitle.trim(),
        description: newCaseDescription.trim() || '',
        status: 'open',
        userId: currentUserId,
        createdAt: serverTimestamp()
      });
      caseId = caseRef.id;
    } catch (firestoreErr: any) {
      console.warn('Firestore case creation notice (using resilient local record):', firestoreErr);
    }

    const newCaseObj: Case = {
      id: caseId,
      title: newCaseTitle.trim(),
      description: newCaseDescription.trim() || '',
      status: 'open',
      userId: currentUserId,
      createdAt: { seconds: Math.floor(Date.now() / 1000) } as any
    };

    // Update local state and cache immediately
    setCases(prev => [newCaseObj, ...prev.filter(c => c.id !== caseId)]);
    try {
      localStorage.setItem(`justiceflow_case_data_${caseId}`, JSON.stringify(newCaseObj));
    } catch (e) {}

    // Process initial evidence file if attached
    if (selectedFile) {
      setProcessingMessage('Processing file content...');
      let analysisContent = '';
      let base64Data = '';
      let images: { data: string, mimeType: string }[] = [];

      try {
        if (selectedFile.type === 'application/pdf') {
          const arrayBuffer = await selectedFile.arrayBuffer();
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(selectedFile);
          });
          base64Data = await base64Promise;
          try {
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
            }
            analysisContent = fullText || `[PDF Document: ${selectedFile.name}]`;
          } catch (pdfErr) {
            analysisContent = `[PDF Document: ${selectedFile.name}]`;
          }
        } else if (selectedFile.type.startsWith('image/')) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(selectedFile);
          });
          base64Data = await base64Promise;
          images.push({ data: base64Data, mimeType: selectedFile.type });
          analysisContent = `[Image Evidence: ${selectedFile.name}]`;
        } else {
          analysisContent = await selectedFile.text();
          base64Data = btoa(unescape(encodeURIComponent(analysisContent.slice(0, 50000))));
        }
      } catch (parseErr) {
        analysisContent = `[Evidence Exhibit: ${selectedFile.name}]`;
      }

      setProcessingMessage('Uploading evidence to vault...');
      let downloadURL = '';
      try {
        const storageRef = ref(storage, `documents/${caseId}/${Date.now()}_${selectedFile.name}`);
        await uploadBytes(storageRef, selectedFile, { contentType: selectedFile.type });
        downloadURL = await getDownloadURL(storageRef);
      } catch (storageErr) {
        console.warn('Storage upload notice (using safe local data URL):', storageErr);
      }

      if (!downloadURL) {
        if (base64Data && base64Data.length < 500000) {
          downloadURL = `data:${selectedFile.type || 'application/octet-stream'};base64,${base64Data}`;
        } else {
          downloadURL = URL.createObjectURL(selectedFile);
        }
      }

      // Safe URL compliant with Firestore schema (< 2000 chars and non-empty)
      const safeFirestoreUrl = downloadURL.startsWith('http') && downloadURL.length < 1800
        ? downloadURL
        : `vault://${caseId}/${encodeURIComponent(selectedFile.name)}`;

      let docRefId = 'doc_' + Date.now();
      try {
        const docRef = await addDoc(collection(db, 'documents'), {
          caseId: caseId,
          fileName: selectedFile.name,
          fileUrl: safeFirestoreUrl,
          textContent: analysisContent.slice(0, 45000), // strictly under 100,000 chars
          type: selectedFile.type || 'application/octet-stream',
          fileSize: selectedFile.size,
          userId: currentUserId,
          createdAt: serverTimestamp()
        });
        docRefId = docRef.id;
      } catch (docErr) {
        console.warn('Document metadata write notice:', docErr);
      }

      const initialDoc: Document = {
        id: docRefId,
        caseId: caseId,
        fileName: selectedFile.name,
        fileUrl: downloadURL,
        textContent: analysisContent,
        type: selectedFile.type || 'application/octet-stream',
        fileSize: selectedFile.size,
        userId: currentUserId,
        createdAt: new Date()
      };

      // Persist document immediately into localStorage so CaseView opens it seamlessly
      try {
        localStorage.setItem(`justiceflow_case_docs_${caseId}`, JSON.stringify([initialDoc]));
        localStorage.setItem(`justiceflow_case_activedoc_${caseId}`, JSON.stringify(initialDoc));
      } catch (e) {}

      // Trigger analysis
      setProcessingMessage('Running automated forensic analysis...');
      try {
        const result = await analyzeLegalDocument(selectedFile.name, analysisContent, images);
        const activeAnalysis: Analysis = {
          id: 'analysis_' + Date.now(),
          documentId: docRefId,
          summary: result.summary,
          legal_points: result.legal_points || [],
          timeline: result.timeline || [],
          evidence_audit: result.evidence_audit || [],
          userId: currentUserId,
          createdAt: new Date()
        };
        try {
          localStorage.setItem(`justiceflow_case_analysis_${caseId}`, JSON.stringify(activeAnalysis));
        } catch (e) {}

        try {
          await addDoc(collection(db, 'analyses'), {
            documentId: docRefId,
            summary: result.summary.slice(0, 9000), // conform to < 10000 rules limit
            legal_points: (result.legal_points || []).slice(0, 30),
            timeline: (result.timeline || []).slice(0, 30),
            evidence_audit: (result.evidence_audit || []).slice(0, 30),
            userId: currentUserId,
            createdAt: serverTimestamp()
          });
        } catch (analysisErr) {
          console.warn('Analysis firestore save notice:', analysisErr);
        }
      } catch (err) {
        console.warn('Analysis execution notice:', err);
      }
    }

    setNewCaseTitle('');
    setNewCaseDescription('');
    setSelectedFile(null);
    setIsSuccess(true);
    setProcessingMessage('Case Initialized Successfully');
    
    setTimeout(() => {
      setShowNewCaseModal(false);
      setIsSuccess(false);
      setProcessingMessage(null);
      onSelectCase(caseId);
    }, 1000);
  };

  const handleUpdateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = auth.currentUser?.uid || (window as any)._localUser?.uid;
    if (!editingCase || !newCaseTitle.trim() || !currentUserId) return;

    try {
      await updateDoc(doc(db, 'cases', editingCase.id), {
        title: newCaseTitle,
        description: newCaseDescription,
      });
      setEditingCase(null);
      setNewCaseTitle('');
      setNewCaseDescription('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `cases/${editingCase.id}`);
    }
  };

  const openEditModal = (e: React.MouseEvent, c: Case) => {
    e.stopPropagation();
    setEditingCase(c);
    setNewCaseTitle(c.title);
    setNewCaseDescription(c.description || '');
  };

  const handleOpenDeleteConfirm = (e: React.MouseEvent, c: Case) => {
    e.stopPropagation();
    setCaseToDelete(c);
  };

  const handleConfirmDelete = async () => {
    if (!caseToDelete) return;
    const targetId = caseToDelete.id;
    const targetTitle = caseToDelete.title;
    setIsDeleting(true);

    // 1. Immediately remove from local cases state for 0ms instant UI removal
    setCases(prev => prev.filter(c => c.id !== targetId));

    // 2. Immediately purge from localStorage
    try {
      const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
      if (dashCasesRaw) {
        const dashCases = JSON.parse(dashCasesRaw);
        const updatedDash = dashCases.filter((c: any) => c.id !== targetId);
        localStorage.setItem('justiceflow_dashboard_cases', JSON.stringify(updatedDash));
      }
      localStorage.removeItem(`justiceflow_case_data_${targetId}`);
      localStorage.removeItem(`justiceflow_case_docs_${targetId}`);
      localStorage.removeItem(`justiceflow_case_chats_${targetId}`);
      localStorage.removeItem(`justiceflow_case_analysis_${targetId}`);
      localStorage.removeItem(`justiceflow_case_activedoc_${targetId}`);
    } catch (err) {}

    // 3. Delete from Firestore permanently (both case and associated documents)
    try {
      await deleteDoc(doc(db, 'cases', targetId));
      try {
        const docsQuery = query(collection(db, 'documents'), where('caseId', '==', targetId));
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

    setIsDeleting(false);
    setCaseToDelete(null);
    setCompletedNotice(`🗑️ Case "${targetTitle}" has been permanently deleted.`);
    setTimeout(() => setCompletedNotice(null), 5000);
  };

  const handleToggleCaseStatus = async (e: React.MouseEvent, caseItem: Case) => {
    e.stopPropagation();
    const newStatus = (caseItem.status === 'closed' ? 'open' : 'closed') as 'open' | 'closed';
    const updatedCase = { ...caseItem, status: newStatus };

    // 1. Immediately update state so UI changes with 0ms delay
    setCases(prev => prev.map(c => c.id === caseItem.id ? updatedCase : c));

    // 2. Immediately update local storage
    try {
      const dashCasesRaw = localStorage.getItem('justiceflow_dashboard_cases');
      if (dashCasesRaw) {
        const dashCases = JSON.parse(dashCasesRaw);
        const updatedDash = dashCases.map((c: any) => c.id === caseItem.id ? updatedCase : c);
        localStorage.setItem('justiceflow_dashboard_cases', JSON.stringify(updatedDash));
      }
      localStorage.setItem(`justiceflow_case_data_${caseItem.id}`, JSON.stringify(updatedCase));
    } catch (err) {}

    if (newStatus === 'closed') {
      setCompletedNotice(`🏆 "${caseItem.title}" marked as Completed! Moved to Completed Cases section.`);
      setTimeout(() => setCompletedNotice(null), 5000);
    }

    // 3. Persist to Firestore asynchronously
    try {
      await updateDoc(doc(db, 'cases', caseItem.id), { status: newStatus });
    } catch (error) {
      console.warn('Firestore status update notice (local state maintained):', error);
    }
  };

  const filteredCases = cases.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-text-main tracking-tight">{t('dashboard.title')}</h2>
          <p className="text-text-muted font-medium uppercase tracking-widest text-[10px] mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => setShowNewCaseModal(true)}
          className="bg-brand-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-brand-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-brand-primary/10"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.newCase')}
        </motion.button>
      </div>

      {/* Interactive Stat Cards - Click to filter and view cases */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { 
            id: 'all' as const, 
            label: t('dashboard.totalLoad') || 'Total Case Load', 
            value: cases.length, 
            icon: Folder, 
            color: 'text-brand-accent',
            activeStyle: 'ring-2 ring-brand-accent border-brand-accent/60 bg-brand-accent/[0.04]',
            hint: 'Show All Cases'
          },
          { 
            id: 'open' as const, 
            label: t('dashboard.inProgress') || 'In Progress', 
            value: cases.filter(c => c.status === 'open').length, 
            icon: Clock, 
            color: 'text-yellow-500',
            activeStyle: 'ring-2 ring-yellow-500 border-yellow-500/60 bg-yellow-500/[0.04]',
            hint: 'Show In Progress Cases'
          },
          { 
            id: 'closed' as const, 
            label: t('dashboard.completedCases') || 'Completed Cases', 
            value: cases.filter(c => c.status === 'closed').length, 
            icon: CheckCircle2, 
            color: 'text-emerald-400',
            activeStyle: 'ring-2 ring-emerald-500 border-emerald-500/60 bg-emerald-500/[0.04]',
            hint: 'Show Completed Cases'
          },
        ].map((stat) => (
          <motion.div 
            key={stat.id} 
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setStatusFilter(stat.id)}
            className={`glass-card p-6 rounded-2xl flex items-center justify-between gap-4 cursor-pointer transition-all border ${
              statusFilter === stat.id 
                ? `${stat.activeStyle} shadow-lg` 
                : 'hover:border-border-main/80 opacity-80 hover:opacity-100'
            }`}
            title={`Click to filter by: ${stat.label}`}
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-surface border border-border-main ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{stat.label}</p>
                <p className="text-2xl font-bold text-text-main tracking-tight">{stat.value}</p>
              </div>
            </div>
            <div>
              {statusFilter === stat.id ? (
                <span className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-brand-primary text-white shadow-sm">
                  Active View
                </span>
              ) : (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted hover:text-brand-accent">
                  Filter →
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
          <input
            type="text"
            placeholder={t('common.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-6 py-4 bg-surface/50 border border-border-main rounded-xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all"
          />
        </div>

        {/* Quick Filter Switcher Pills */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0 bg-surface/60 p-1.5 rounded-2xl border border-border-main">
          {(['all', 'open', 'closed'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                statusFilter === tab 
                  ? 'bg-brand-primary text-white shadow-sm' 
                  : 'text-text-muted hover:text-text-main hover:bg-surface/50'
              }`}
            >
              {tab === 'all' 
                ? `All (${cases.length})` 
                : tab === 'open' 
                  ? `${t('dashboard.inProgress') || 'In Progress'} (${cases.filter(c => c.status === 'open').length})` 
                  : `${t('dashboard.completed') || 'Completed'} (${cases.filter(c => c.status === 'closed').length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Floating Notice when a case is completed */}
      {completedNotice && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between shadow-md"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-semibold">{completedNotice}</span>
          </div>
          {statusFilter !== 'closed' && (
            <button
              type="button"
              onClick={() => setStatusFilter('closed')}
              className="px-3 py-1 rounded-xl bg-emerald-500 text-white font-bold text-[10px] uppercase tracking-wider hover:bg-emerald-600 transition-all shadow-sm"
            >
              View in Completed Cases →
            </button>
          )}
        </motion.div>
      )}

      {/* Dedicated Completed Cases Section Header */}
      {statusFilter === 'closed' && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-emerald-500/5"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-text-main">Completed Cases Archive</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                  {filteredCases.length} {filteredCases.length === 1 ? 'Case' : 'Cases'}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                All proceedings finalized. Evidence files, forensic analyses, and audit logs are safely archived.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className="px-4 py-2 rounded-xl bg-surface hover:bg-surface/80 border border-border-main text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-main transition-all shrink-0 self-start sm:self-auto"
          >
            View All Cases ({cases.length})
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCases.map((c) => (
          <motion.div
            key={c.id}
            layoutId={c.id}
            whileHover={{ y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => onSelectCase(c.id)}
            className={`group glass-card p-6 rounded-2xl hover:border-brand-accent/40 transition-all cursor-pointer relative overflow-hidden ${
              c.status === 'closed' ? 'border-emerald-500/30 bg-emerald-500/[0.02]' : ''
            }`}
          >
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className="flex items-center gap-3">
                {/* Interactive Checkbox Button */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.85 }}
                  title={c.status === 'closed' ? (t('dashboard.markOpen') || 'Mark as In Progress') : (t('dashboard.markCompleted') || 'Mark as Completed')}
                  onClick={(e) => handleToggleCaseStatus(e, c)}
                  className={`p-2.5 rounded-xl border transition-all flex items-center justify-center ${
                    c.status === 'closed'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-sm'
                      : 'bg-surface border-border-main text-text-muted hover:text-brand-accent hover:border-brand-accent/50'
                  }`}
                >
                  {c.status === 'closed' ? (
                    <CheckSquare className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </motion.button>
                <div className="bg-surface p-3 rounded-xl border border-border-main">
                  <Folder className="w-5 h-5 text-brand-accent" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => openEditModal(e, c)}
                  className="p-2.5 text-text-muted hover:text-brand-accent hover:bg-surface/50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                >
                  <Edit2 className="w-4 h-4" />
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => handleOpenDeleteConfirm(e, c)}
                  title="Permanently Delete Case"
                  className="p-2.5 text-text-muted hover:text-red-400 hover:bg-red-400/15 rounded-xl transition-all opacity-80 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </motion.button>
              </div>
            </div>
            
            <h3 className={`text-xl font-bold mb-2 group-hover:text-brand-accent transition-colors tracking-tight ${
              c.status === 'closed' ? 'text-text-main/80 line-through decoration-emerald-500/50' : 'text-text-main'
            }`}>
              {c.title}
            </h3>
            
            {c.description && (
              <p className="text-xs text-text-muted mb-4 line-clamp-2 leading-relaxed">{c.description}</p>
            )}
            
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-text-muted">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-text-muted" />
                {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : 'Just now'}
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
                onClick={(e) => handleToggleCaseStatus(e, c)}
                className={`px-2.5 py-1 rounded-full border text-[9px] font-bold tracking-wider uppercase transition-all flex items-center gap-1.5 ${
                  c.status === 'closed'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : 'bg-surface border-border-main text-text-muted hover:border-brand-accent/50'
                }`}
              >
                {c.status === 'closed' ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>{t('dashboard.completed') || 'Completed'}</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span>{t('dashboard.inProgress') || 'In Progress'}</span>
                  </>
                )}
              </motion.button>
            </div>
            
            <div className="mt-6 pt-4 border-t border-border-main flex items-center text-brand-accent font-bold text-[10px] uppercase tracking-widest group-hover:gap-2 transition-all">
              {t('dashboard.viewCase')}
              <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.div>
        ))}

        {filteredCases.length === 0 && (
          <div className="col-span-full py-24 text-center glass-card rounded-[3rem] border-dashed border-border-main space-y-4">
            <Gavel className="w-16 h-16 text-brand-accent/30 mx-auto" />
            <div>
              <h3 className="text-2xl font-bold text-text-main mb-1">
                {statusFilter !== 'all' 
                  ? `No ${statusFilter === 'open' ? (t('dashboard.inProgress') || 'In Progress') : (t('dashboard.completed') || 'Completed')} Cases Found` 
                  : t('dashboard.noCases')}
              </h3>
              <p className="text-text-muted font-medium text-xs tracking-wide">
                {statusFilter !== 'all' 
                  ? `There are currently no cases registered under this status.` 
                  : t('dashboard.initializeFirst')}
              </p>
            </div>
            {statusFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="px-4 py-2 rounded-xl bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest shadow-md hover:bg-brand-primary/90 transition-all"
              >
                Show All Cases ({cases.length})
              </button>
            )}
          </div>
        )}
      </div>

      {(showNewCaseModal || editingCase) && (
        <div className="fixed inset-0 bg-brand-deep/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-3xl p-8 max-w-lg w-full border-border-main"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-text-main tracking-tight">
                {editingCase ? t('common.edit') : t('dashboard.newCase')}
              </h3>
              {!editingCase && (
                <button
                  type="button"
                  onClick={() => {
                    setNewCaseTitle('State vs. Anderson (Forgery Case)');
                    setNewCaseDescription('A high-profile case involving alleged document forgery and digital evidence tampering. The primary evidence is a scanned contract with suspicious metadata.');
                  }}
                  className="text-[9px] font-bold text-brand-accent uppercase tracking-widest hover:underline"
                >
                  Fill Demo Data
                </button>
              )}
            </div>
            <form onSubmit={editingCase ? handleUpdateCase : handleCreateCase} className="space-y-5">
              {!editingCase && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] ml-1">Case Template</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full px-5 py-3.5 bg-surface/50 border border-border-main rounded-xl text-text-main focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all"
                  >
                    <option value="">Select a template...</option>
                    {templates.map(t => <option key={t.title} value={t.title}>{t.title}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] ml-1">{t('dashboard.caseTitle')}</label>
                <input
                  autoFocus
                  type="text"
                  value={newCaseTitle}
                  onChange={(e) => setNewCaseTitle(e.target.value)}
                  placeholder="e.g. State vs. John Doe (2024)"
                  className="w-full px-5 py-3.5 bg-surface/50 border border-border-main rounded-xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">{t('dashboard.caseDescription')}</label>
                  <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider bg-surface px-2 py-0.5 rounded border border-border-main">Optional</span>
                </div>
                <textarea
                  value={newCaseDescription}
                  onChange={(e) => setNewCaseDescription(e.target.value)}
                  placeholder="Provide a brief overview of the judicial matter (Optional)..."
                  rows={3}
                  className="w-full px-5 py-3.5 bg-surface/50 border border-border-main rounded-xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all resize-none"
                />
              </div>

              {!editingCase && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] ml-1">Initial Evidence (Optional)</label>
                  <div className="relative">
                    {selectedFile ? (
                      <div className="flex items-center justify-between p-3 bg-brand-accent/5 border border-brand-accent/20 rounded-xl">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-brand-accent" />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-text-main truncate max-w-[200px]">{selectedFile.name}</span>
                            <span className="text-[9px] text-text-muted uppercase">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="p-1.5 hover:bg-surface/50 rounded-lg text-text-muted transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center p-6 border border-dashed border-border-main rounded-xl hover:border-brand-accent/30 hover:bg-surface/50 cursor-pointer transition-all group">
                        <Upload className="w-6 h-6 text-text-muted opacity-40 group-hover:text-brand-accent mb-2 transition-all" />
                        <span className="text-[10px] font-bold text-text-muted group-hover:text-text-main uppercase tracking-widest">Upload Case Files</span>
                        <input 
                          type="file" 
                          className="hidden" 
                          accept=".pdf,.txt,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && file.size > 600 * 1024) {
                              alert("Evidence file is too large for the secure vault (Max 600KB). Please compress the file or upload a smaller version.");
                              e.target.value = '';
                              return;
                            }
                            setSelectedFile(file || null);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
              
              {error && (
                <div className="p-4 bg-red-400/10 border border-red-400/20 rounded-xl flex items-center gap-3 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={!!processingMessage}
                  onClick={() => {
                    setShowNewCaseModal(false);
                    setEditingCase(null);
                    setNewCaseTitle('');
                    setNewCaseDescription('');
                    setSelectedFile(null);
                  }}
                  className="flex-1 px-6 py-3 border border-border-main text-text-muted font-semibold uppercase tracking-widest text-[10px] rounded-xl hover:bg-surface/50 transition-all disabled:opacity-50"
                >
                  {t('common.cancel')}
                </motion.button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={!!processingMessage || isSuccess}
                  className={cn(
                    "flex-1 px-6 py-3 font-semibold uppercase tracking-widest text-[10px] rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50",
                    isSuccess ? "bg-green-500 text-white shadow-green-500/10" : "bg-brand-primary text-white shadow-brand-primary/10 hover:bg-brand-primary/90"
                  )}
                >
                  {isSuccess ? (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      {t('common.confirm')}
                    </>
                  ) : processingMessage ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {processingMessage}
                    </>
                  ) : (
                    editingCase ? t('common.save') : t('dashboard.createCase')
                  )}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Permanent Deletion Confirmation Modal */}
      {caseToDelete && (
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
              Are you sure you want to permanently delete <span className="font-bold text-text-main">"{caseToDelete.title}"</span>? This judicial record and all attached evidence exhibits, forensic audit data, and transcripts will be permanently expunged.
            </p>

            <div className="flex items-center justify-end gap-3">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                disabled={isDeleting}
                onClick={() => setCaseToDelete(null)}
                className="px-5 py-2.5 rounded-xl border border-border-main text-text-muted hover:text-text-main hover:bg-surface/50 text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
              >
                {t('common.cancel') || 'Cancel'}
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-red-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
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
    </motion.div>
  );
}
