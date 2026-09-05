import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Case } from '../types';
import { Plus, Folder, Clock, ChevronRight, Trash2, Search, Edit2, Upload, FileText, X, Loader2, ShieldCheck, AlertCircle, Gavel } from 'lucide-react';
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
  const [cases, setCases] = useState<Case[]>([]);
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [editingCase, setEditingCase] = useState<Case | null>(null);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentUserId = auth.currentUser?.uid || (window as any)._localUser?.uid;
    if (!currentUserId) return;

    const q = query(
      collection(db, 'cases'),
      where('userId', '==', currentUserId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const casesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Case));
      setCases(casesData.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cases');
    });

    return unsubscribe;
  }, []);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = auth.currentUser?.uid || (window as any)._localUser?.uid;
    if (!newCaseTitle.trim() || !currentUserId) return;

    setProcessingMessage('Creating case record...');
    setError(null);
    try {
      const caseRef = await addDoc(collection(db, 'cases'), {
        title: newCaseTitle,
        description: newCaseDescription,
        status: 'open',
        userId: currentUserId,
        createdAt: serverTimestamp()
      });

      if (selectedFile) {
        setProcessingMessage('Processing file content...');
        let analysisContent = '';
        let base64Data = '';
        let images: { data: string, mimeType: string }[] = [];

        if (selectedFile.type === 'application/pdf') {
          const arrayBuffer = await selectedFile.arrayBuffer();
          
          // Get base64 for display
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(selectedFile);
          });
          base64Data = await base64Promise;

          // Extract text for analysis
          const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }
          analysisContent = fullText;
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
          // Use a safer base64 encoding that handles unicode
          base64Data = btoa(unescape(encodeURIComponent(analysisContent)));
        }

        // Upload to storage
        setProcessingMessage('Uploading evidence to vault...');
        const storageRef = ref(storage, `documents/${caseRef.id}/${selectedFile.name}`);
        await uploadBytes(storageRef, selectedFile, { contentType: selectedFile.type });
        const downloadURL = await getDownloadURL(storageRef);

        setProcessingMessage('Saving document metadata...');
        const docRef = await addDoc(collection(db, 'documents'), {
          caseId: caseRef.id,
          fileName: selectedFile.name,
          fileUrl: downloadURL,
          textContent: analysisContent,
          type: selectedFile.type,
          fileSize: selectedFile.size,
          userId: currentUserId,
          createdAt: serverTimestamp()
        });

        // Trigger Automated Analysis
        setProcessingMessage('Running automated legal analysis...');
        try {
          const result = await analyzeLegalDocument(selectedFile.name, analysisContent, images);
          await addDoc(collection(db, 'analyses'), {
            documentId: docRef.id,
            summary: result.summary,
            legal_points: result.legal_points,
            timeline: result.timeline,
            evidence_audit: result.evidence_audit || [],
            userId: currentUserId,
            createdAt: serverTimestamp()
          });
        } catch (analysisError) {
          console.error('Automated analysis failed:', analysisError);
        }
      }

      setNewCaseTitle('');
      setNewCaseDescription('');
      setSelectedFile(null);
      setIsSuccess(true);
      setProcessingMessage('Entry Successful');
      
      setTimeout(() => {
        setShowNewCaseModal(false);
        setIsSuccess(false);
        onSelectCase(caseRef.id);
      }, 1500);
    } catch (err: any) {
      console.error('Case creation failed:', err);
      setError(err.message || 'Failed to create judicial record. Please verify your connection.');
      handleFirestoreError(err, OperationType.CREATE, 'cases');
    } finally {
      if (!isSuccess) setProcessingMessage(null);
    }
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

  const handleDeleteCase = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // if (!confirm('Are you sure you want to delete this case? All associated documents will remain but the case entry will be removed.')) return;
    try {
      await deleteDoc(doc(db, 'cases', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `cases/${id}`);
    }
  };

  const filteredCases = cases.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <button
          onClick={() => setShowNewCaseModal(true)}
          className="bg-brand-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-brand-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-brand-primary/10"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.newCase')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Total Case Load', value: cases.length, icon: Folder, color: 'text-brand-accent' },
          { label: 'Pending Analysis', value: cases.filter(c => c.status === 'open').length, icon: Clock, color: 'text-yellow-500' },
        ].map((stat, i) => (
          <div key={i} className="glass-card p-6 rounded-2xl flex items-center gap-4">
            <div className={`p-3 rounded-xl bg-surface border border-border-main ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{stat.label}</p>
              <p className="text-2xl font-bold text-text-main tracking-tight">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

    <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
        <input
          type="text"
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-6 py-4 bg-surface/50 border border-border-main rounded-xl text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCases.map((c) => (
          <motion.div
            key={c.id}
            layoutId={c.id}
            onClick={() => onSelectCase(c.id)}
            className="group glass-card p-6 rounded-2xl hover:border-brand-accent/40 transition-all cursor-pointer relative overflow-hidden"
          >
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className="bg-surface p-3 rounded-xl border border-border-main">
                <Folder className="w-5 h-5 text-brand-accent" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => openEditModal(e, c)}
                  className="p-2.5 text-text-muted hover:text-brand-accent hover:bg-surface/50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => handleDeleteCase(e, c.id)}
                  className="p-2.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <h3 className="text-xl font-bold text-text-main mb-2 group-hover:text-brand-accent transition-colors tracking-tight">
              {c.title}
            </h3>
            
            {c.description && (
              <p className="text-xs text-text-muted mb-4 line-clamp-2 leading-relaxed">{c.description}</p>
            )}
            
            <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-text-muted">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-text-muted" />
                {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : 'Just now'}
              </div>
              <div className="px-2 py-0.5 bg-surface text-text-main rounded border border-border-main">
                {c.status}
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-border-main flex items-center text-brand-accent font-bold text-[10px] uppercase tracking-widest group-hover:gap-2 transition-all">
              {t('dashboard.viewCase')}
              <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.div>
        ))}

        {filteredCases.length === 0 && (
          <div className="col-span-full py-24 text-center glass-card rounded-[3rem] border-dashed border-border-main">
            <Gavel className="w-16 h-16 text-brand-accent/30 mx-auto mb-6" />
            <h3 className="text-2xl font-bold text-text-main mb-2">{t('dashboard.noCases')}</h3>
            <p className="text-text-main font-semibold tracking-wide">{t('dashboard.initializeFirst')}</p>
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
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] ml-1">{t('dashboard.caseDescription')}</label>
                <textarea
                  value={newCaseDescription}
                  onChange={(e) => setNewCaseDescription(e.target.value)}
                  placeholder="Provide a brief overview of the judicial matter..."
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
                <button
                  type="button"
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
                </button>
                <button
                  type="submit"
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
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
