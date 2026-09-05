import React, { useState, useRef } from 'react';
import { UserProfile, JudicialRole } from '../types';
import { X, Upload, Check, User, Shield, Briefcase, Info, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onSave: (updated: UserProfile) => Promise<void>;
}

const ROLE_DESCRIPTIONS: Record<JudicialRole, { title: string; desc: string; badgeColor: string }> = {
  'Magistrate': {
    title: 'Trial Magistrate',
    desc: 'Presides over trials, examines investigative evidence, and issues orders & warrants.',
    badgeColor: 'text-amber-400 bg-amber-400/10 border-amber-400/30'
  },
  'High Court Judge': {
    title: 'High Court Judge',
    desc: 'Hears appellate proceedings, writ petitions, and substantial questions of law.',
    badgeColor: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30'
  },
  'Chief Justice': {
    title: 'Chief Justice',
    desc: 'Head of the judicial bench, supervisory administrator, and constitutional bench chair.',
    badgeColor: 'text-purple-400 bg-purple-400/10 border-purple-400/30'
  },
  'Public Prosecutor': {
    title: 'Public Prosecutor',
    desc: 'Represents the State and public interest in criminal investigations and court trials.',
    badgeColor: 'text-red-400 bg-red-400/10 border-red-400/30'
  },
  'Advocate / Legal Counsel': {
    title: 'Advocate / Legal Counsel',
    desc: 'Represents clients, drafts pleadings, and conducts examination of legal witnesses.',
    badgeColor: 'text-blue-400 bg-blue-400/10 border-blue-400/30'
  },
  'Judicial Clerk': {
    title: 'Judicial Clerk',
    desc: 'Assists with legal precedent research, bench memorandums, and registry records.',
    badgeColor: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
  },
  'Court Administrator': {
    title: 'Court Administrator',
    desc: 'Oversees case scheduling, digital court dockets, registry operations, and portal access.',
    badgeColor: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30'
  }
};

const AVATAR_PRESETS = [
  { label: 'Magistrate', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProfessionalJudge&backgroundColor=b6e3f4,c0aede,d1d4f9' },
  { label: 'High Bench', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=JusticePrestige&backgroundColor=ffd5dc,ffdfbf' },
  { label: 'Counsel', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=LegalScholar&backgroundColor=c0aede,d1d4f9' },
  { label: 'Advocate', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=SeniorAdvocate&backgroundColor=b6e3f4,ffd5dc' },
  { label: 'Officer', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=JudicialOfficer&backgroundColor=d1d4f9,ffdfbf' },
  { label: 'Registry', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ChamberClerk&backgroundColor=c0aede' }
];

export default function ProfileModal({ isOpen, onClose, profile, onSave }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [photoURL, setPhotoURL] = useState(profile.photoURL || AVATAR_PRESETS[0].url);
  const [role, setRole] = useState<JudicialRole>(profile.role || 'Magistrate');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Non-Binary' | 'Prefer not to say'>(
    profile.gender || 'Prefer not to say'
  );
  const [bio, setBio] = useState(profile.bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file (PNG, JPG, SVG).');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Image file must be under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoURL(reader.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Name cannot be empty.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        ...profile,
        displayName: displayName.trim(),
        photoURL,
        role,
        gender,
        bio: bio.trim(),
        updatedAt: new Date()
      });
      onClose();
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setError(err?.message || 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-2xl bg-surface border border-border-main rounded-3xl shadow-2xl overflow-hidden z-10 my-8"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border-main bg-surface/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-text-main">Judicial Profile</h2>
                <p className="text-xs text-text-muted">Manage your identity, designation, and courtroom bio</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="p-2 text-text-muted hover:text-text-main hover:bg-surface rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </motion.button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[calc(85vh-120px)] overflow-y-auto custom-scrollbar">
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center gap-3">
                <Info className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Profile Picture Section */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-brand-accent" />
                Profile Picture & Avatar
              </label>
              
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-surface/40 border border-border-main rounded-2xl">
                {/* Active Avatar */}
                <div className="relative group">
                  <div className="w-20 h-20 rounded-2xl border-2 border-brand-primary/40 overflow-hidden shadow-lg bg-surface">
                    <img src={photoURL} alt="Profile" className="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl transition-all text-white text-xs font-semibold"
                  >
                    Change
                  </button>
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload Photo
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <span className="text-[11px] text-text-muted">PNG, JPG, or SVG up to 2MB</span>
                  </div>

                  {/* Avatar Presets */}
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold block mb-1.5">
                      Or select a preset avatar:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {AVATAR_PRESETS.map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPhotoURL(preset.url)}
                          className={`w-9 h-9 rounded-xl border overflow-hidden p-0.5 transition-all ${
                            photoURL === preset.url
                              ? 'border-brand-primary ring-2 ring-brand-primary/30 scale-105'
                              : 'border-border-main hover:border-text-muted opacity-80 hover:opacity-100'
                          }`}
                          title={preset.label}
                        >
                          <img src={preset.url} alt={preset.label} className="w-full h-full object-cover rounded-lg" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Name Input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-brand-accent" />
                Full Judicial Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Hon. Justice Sharma"
                className="w-full bg-surface/60 border border-border-main rounded-2xl py-3 px-4 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all font-medium"
              />
            </div>

            {/* Role & Designation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-brand-accent" />
                  Judicial Role & Jurisdiction
                </label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ROLE_DESCRIPTIONS[role]?.badgeColor || ''}`}>
                  {role}
                </span>
              </div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as JudicialRole)}
                className="w-full bg-surface/60 border border-border-main rounded-2xl py-3 px-4 text-text-main focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all font-medium cursor-pointer"
              >
                {(Object.keys(ROLE_DESCRIPTIONS) as JudicialRole[]).map((r) => (
                  <option key={r} value={r} className="bg-surface text-text-main">
                    {r} — {ROLE_DESCRIPTIONS[r].title}
                  </option>
                ))}
              </select>

              {/* Role explanation callout */}
              <div className="p-3 bg-surface/40 border border-border-main rounded-xl flex items-start gap-2.5 text-xs text-text-muted">
                <Info className="w-4 h-4 text-brand-accent shrink-0 mt-0.5" />
                <div>
                  <strong className="text-text-main font-semibold block">{role}</strong>
                  <span>{ROLE_DESCRIPTIONS[role]?.desc}</span>
                </div>
              </div>
            </div>

            {/* Gender Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5 text-brand-accent" />
                Gender
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['Male', 'Female', 'Non-Binary', 'Prefer not to say'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      gender === g
                        ? 'border-brand-primary bg-brand-primary/10 text-brand-primary shadow-sm'
                        : 'border-border-main bg-surface/40 text-text-muted hover:text-text-main hover:bg-surface'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Professional Bio */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                Courtroom Bio & Specialization
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="e.g. Presiding over criminal revisions and civil appeals. Specialization in digital forensic evidence and trial records."
                className="w-full bg-surface/60 border border-border-main rounded-2xl p-3.5 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all text-sm leading-relaxed"
              />
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-main">
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.94 }}
                onClick={onClose}
                disabled={isSaving}
                className="px-5 py-2.5 rounded-xl border border-border-main text-text-muted hover:text-text-main hover:bg-surface transition-all text-xs font-semibold uppercase tracking-wider disabled:opacity-50"
              >
                Cancel
              </motion.button>
              <motion.button
                type="submit"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.94 }}
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-white transition-all text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-brand-primary/20 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Profile
                  </>
                )}
              </motion.button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
