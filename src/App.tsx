/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { auth, signInWithJudicial, logOut, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { Gavel, LogOut, Plus, FileText, MessageSquare, BarChart3, ChevronRight, Upload, Search, Download, ShieldCheck, Lock, User as UserIcon, AlertCircle, Scale, Loader2, Eye, EyeOff, Languages } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { JusticeFlowLogo } from './components/Logo';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';
import LanguageSwitcher from './components/LanguageSwitcher';

import Dashboard from './components/Dashboard';
import CaseView from './components/CaseView';
import ProfileModal from './components/ProfileModal';
import GlobalAssistant from './components/GlobalAssistant';
import { UserProfile } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  // Login Form State
  const [judicialId, setJudicialId] = useState('');
  const [securityPin, setSecurityPin] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const cached = localStorage.getItem('justiceflow_profile_' + user.uid);
        if (cached) {
          try {
            setProfile(JSON.parse(cached));
          } catch (e) {}
        }

        const userRef = doc(db, 'users', user.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const data = userDoc.data();
            const prof: UserProfile = {
              uid: user.uid,
              displayName: data.displayName || user.displayName || 'Hon. Justice Sharma',
              email: data.email || user.email || 'judge@justiceflow.gov',
              photoURL: data.photoURL || user.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9',
              role: data.role || 'Magistrate',
              gender: data.gender || 'Prefer not to say',
              bio: data.bio || 'Presiding Magistrate with focus on evidentiary forensics and legal fairness.'
            };
            setProfile(prof);
            localStorage.setItem('justiceflow_profile_' + user.uid, JSON.stringify(prof));
          } else {
            const defaultProf: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'Hon. Justice Sharma',
              email: user.email || 'judge@justiceflow.gov',
              role: 'Magistrate',
              photoURL: user.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9',
              gender: 'Prefer not to say',
              bio: 'Presiding Magistrate with focus on evidentiary forensics and legal fairness.'
            };
            await setDoc(userRef, {
              ...defaultProf,
              createdAt: serverTimestamp()
            });
            setProfile(defaultProf);
            localStorage.setItem('justiceflow_profile_' + user.uid, JSON.stringify(defaultProf));
          }
        } catch (error) {
          console.error('Error syncing user profile:', error);
          if (!cached) {
            setProfile({
              uid: user.uid,
              displayName: user.displayName || 'Hon. Justice Sharma',
              email: user.email || 'judge@justiceflow.gov',
              role: 'Magistrate',
              photoURL: user.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9',
              gender: 'Prefer not to say',
              bio: 'Presiding Magistrate with focus on evidentiary forensics and legal fairness.'
            });
          }
        }
      } else {
        setProfile(null);
      }
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleSaveProfile = async (updated: UserProfile) => {
    setProfile(updated);
    localStorage.setItem('justiceflow_profile_' + updated.uid, JSON.stringify(updated));

    if (auth.currentUser) {
      try {
        await updateProfile(auth.currentUser, {
          displayName: updated.displayName,
          photoURL: updated.photoURL
        });
      } catch (err) {
        console.warn('Could not update Firebase auth profile:', err);
      }
    }

    try {
      const userRef = doc(db, 'users', updated.uid);
      await setDoc(userRef, {
        uid: updated.uid,
        displayName: updated.displayName,
        email: updated.email,
        photoURL: updated.photoURL,
        role: updated.role,
        gender: updated.gender || '',
        bio: updated.bio || '',
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.warn('Could not persist profile to Firestore:', err);
    }
  };

  const handleJudicialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);

    try {
      // Strictly enforce the specified credentials
      if (judicialId === 'judge@justiceflow.gov' && securityPin === 'Justice2026!') {
        try {
          // Attempt sign in
          await signInWithJudicial(judicialId, securityPin);
        } catch (signInError: any) {
          console.warn('Firebase Auth failed, attempting fallback...', signInError);
          
          // If it's a network error or user not found, try to create or use local fallback for the demo
          if (signInError.code === 'auth/network-request-failed') {
            setAuthError('Network connection to Judicial Servers is restricted. Initializing Local Secure Session...');
            // Wait a bit to show the message then bypass
            setTimeout(() => {
              const cached = localStorage.getItem('justiceflow_profile_demo-judge-001');
              let initialProf: UserProfile;
              if (cached) {
                try {
                  initialProf = JSON.parse(cached);
                } catch (e) {
                  initialProf = {
                    uid: 'demo-judge-001',
                    displayName: 'Hon. Justice Sharma',
                    photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9',
                    email: 'judge@justiceflow.gov',
                    role: 'Magistrate',
                    gender: 'Prefer not to say',
                    bio: 'Presiding Magistrate with focus on evidentiary forensics and legal fairness.'
                  };
                }
              } else {
                initialProf = {
                  uid: 'demo-judge-001',
                  displayName: 'Hon. Justice Sharma',
                  photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9',
                  email: 'judge@justiceflow.gov',
                  role: 'Magistrate',
                  gender: 'Prefer not to say',
                  bio: 'Presiding Magistrate with focus on evidentiary forensics and legal fairness.'
                };
              }

              const localUser = {
                uid: 'demo-judge-001',
                displayName: initialProf.displayName,
                photoURL: initialProf.photoURL,
                email: 'judge@justiceflow.gov'
              };
              (window as any)._localUser = localUser;
              setProfile(initialProf);
              setUser(localUser as any);
            }, 1500);
            return;
          }

          if (signInError.code === 'auth/user-not-found' || signInError.code === 'auth/invalid-credential' || signInError.code === 'auth/invalid-email') {
            await createUserWithEmailAndPassword(auth, judicialId, securityPin);
            if (auth.currentUser) {
              await updateProfile(auth.currentUser, {
                displayName: 'Hon. Justice Sharma',
                photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge'
              });
            }
          } else {
            throw signInError;
          }
        }
        return;
      }

      setAuthError('Unauthorized access. Please use the official judicial credentials.');
    } catch (error: any) {
      console.error('Login failed:', error);
      const errorCode = error.code || 'unknown';
      
      if (errorCode === 'auth/operation-not-allowed') {
        setAuthError('CRITICAL: Email/Password login is DISABLED. Please go to Firebase Console > Authentication > Sign-in method and ENABLE "Email/Password".');
      } else if (errorCode === 'auth/api-key-not-valid') {
        const config = require('../firebase-applet-config.json');
        setAuthError(`API Key Error: Please ensure "Identity Toolkit API" is ENABLED in your Google Cloud Console for project "${config.projectId}". Also check for any API key restrictions.`);
      } else {
        setAuthError(`Login Error (${errorCode}): Please verify your credentials or check your Firebase configuration.`);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-deep flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-brand-accent border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen brand-gradient flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-8 right-8 z-50 flex items-center gap-4">
          <LanguageSwitcher />
          <button
            onClick={toggleTheme}
            className="p-3 rounded-2xl bg-surface border border-border-main text-text-muted hover:text-brand-accent transition-all shadow-lg"
          >
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8 relative z-10"
        >
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <motion.div 
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="relative"
              >
                <div className="w-32 h-32 bg-surface border border-border-main rounded-3xl flex items-center justify-center shadow-lg overflow-hidden p-6">
                  <JusticeFlowLogo />
                </div>
              </motion.div>
            </div>
            <div className="space-y-1">
              <h1 className="text-4xl font-bold text-text-main tracking-tight">{t('auth.welcome')}</h1>
              <p className="text-text-muted text-sm font-medium uppercase tracking-[0.3em]">{t('auth.tagline')}</p>
            </div>
          </div>

          <div className="glass-card p-8 rounded-3xl space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3 text-brand-accent">
                <ShieldCheck className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-widest">Authorized Access Only</span>
              </div>
            </div>

            <form onSubmit={handleJudicialLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">Judicial Identifier</label>
                <div className="relative">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                  <input
                    type="text"
                    required
                    value={judicialId}
                    onChange={(e) => setJudicialId(e.target.value)}
                    placeholder="Enter ID"
                    className="w-full bg-surface/50 border border-border-main rounded-2xl py-4 pl-12 pr-4 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">Security Token</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={securityPin}
                    onChange={(e) => setSecurityPin(e.target.value)}
                    placeholder="Enter Token"
                    className="w-full bg-surface/50 border border-border-main rounded-2xl py-4 pl-12 pr-12 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-brand-accent transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {authError && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-2xl border border-red-400/20 text-xs font-medium"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {authError}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full bg-brand-primary hover:bg-brand-primary/90 text-white font-semibold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-primary/10"
              >
                {isAuthenticating ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                  />
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Authorize Session
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setJudicialId('judge@justiceflow.gov');
                  setSecurityPin('Justice2026!');
                }}
                className="w-full border border-border-main hover:bg-surface/50 text-text-muted font-medium py-3 px-6 rounded-xl transition-all text-[10px] uppercase tracking-widest"
              >
                Use Demo Credentials
              </button>
            </form>
          </div>

          <div className="text-center">
            <p className="text-text-muted text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2">
              <Lock className="w-3 h-3" />
              Secure Judicial Environment
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-deep text-text-main font-sans">
      {/* Navigation */}
      <nav className="bg-surface/80 backdrop-blur-md border-b border-border-main h-16 sm:h-20 flex items-center justify-between px-3 sm:px-8 sticky top-0 z-50">
        <div className="flex items-center gap-2.5 sm:gap-4 cursor-pointer" onClick={() => setActiveCaseId(null)}>
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-surface border border-border-main rounded-xl flex items-center justify-center shadow-sm overflow-hidden p-1 sm:p-1.5">
            <JusticeFlowLogo />
          </div>
          <span className="font-bold text-xl sm:text-2xl text-text-main tracking-tighter">JusticeFlow</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9, rotate: 18 }}
            onClick={toggleTheme}
            className="p-2 sm:p-2.5 text-text-muted hover:text-brand-accent hover:bg-brand-accent/10 rounded-xl transition-all"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? <Moon className="w-4 h-4 sm:w-5 sm:h-5" /> : <Sun className="w-4 h-4 sm:w-5 sm:h-5" />}
          </motion.button>

          <LanguageSwitcher />

          <motion.div 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setIsProfileModalOpen(true)}
            className="flex items-center gap-2 sm:gap-4 pr-2 sm:pr-6 border-r border-border-main cursor-pointer group hover:opacity-95 transition-all"
            title="Click to view & edit your profile"
          >
            <div className="text-right hidden md:block">
              <p className="text-sm font-bold text-text-main leading-none group-hover:text-brand-accent transition-colors">
                {profile?.displayName || user.displayName || 'Judicial Officer'}
              </p>
              <div className="flex items-center justify-end gap-1.5 mt-1">
                <p className="text-[10px] text-brand-accent font-bold uppercase tracking-widest">
                  {profile?.role || (user.uid === 'demo-judge-001' ? 'Local Secure Session' : 'Judicial Officer')}
                </p>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary border border-brand-primary/20 group-hover:bg-brand-primary group-hover:text-white transition-all uppercase tracking-wider">
                  Edit
                </span>
              </div>
            </div>
            {/* Custom or Selected Avatar */}
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl border border-border-main shadow-lg overflow-hidden bg-surface group-hover:ring-2 group-hover:ring-brand-accent transition-all relative">
              <img 
                src={profile?.photoURL || user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9`} 
                className="w-full h-full object-cover" 
                alt="Judicial Avatar" 
              />
            </div>
          </motion.div>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowSignOutConfirm(true)}
            className="p-2 sm:p-2.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
            title={t('auth.signOut') || 'Sign Out'}
          >
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
          </motion.button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-3 sm:p-6">
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-brand-accent" />
          </div>
        }>
          <AnimatePresence mode="wait">
            {!activeCaseId ? (
              <Dashboard key="dashboard" onSelectCase={setActiveCaseId} />
            ) : (
              <CaseView key="case-view" caseId={activeCaseId} onBack={() => setActiveCaseId(null)} />
            )}
          </AnimatePresence>
        </Suspense>
      </main>

      {profile && (
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          profile={profile}
          onSave={handleSaveProfile}
        />
      )}

      {/* Sign Out Confirmation Modal */}
      <AnimatePresence>
        {showSignOutConfirm && (
          <div className="fixed inset-0 bg-brand-deep/80 backdrop-blur-md flex items-center justify-center z-[110] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-card rounded-3xl p-8 max-w-md w-full border border-border-main shadow-2xl relative"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                  <LogOut className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-text-main tracking-tight">
                    {t('auth.confirmSignOut') || 'Confirm Sign Out'}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t('auth.tagline') || 'Judicial Intelligence Portal'}
                  </p>
                </div>
              </div>

              <p className="text-xs text-text-muted leading-relaxed mb-6">
                {t('auth.confirmSignOutDesc') || 'Are you sure you want to end your judicial session? Any open investigations will be safely preserved.'}
              </p>

              <div className="flex items-center justify-end gap-3">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setShowSignOutConfirm(false)}
                  className="px-5 py-2.5 rounded-xl border border-border-main text-text-muted hover:text-text-main hover:bg-surface/50 text-xs font-semibold uppercase tracking-wider transition-all"
                >
                  {t('common.cancel') || 'Cancel'}
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    setShowSignOutConfirm(false);
                    logOut();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider shadow-lg shadow-red-500/20 transition-all flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  {t('auth.signOut') || 'Sign Out'}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Anywhere AI Guide & Help Assistant */}
      <GlobalAssistant />
    </div>
  );
}
