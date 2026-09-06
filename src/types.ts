export interface Case {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'closed' | 'archived';
  userId: string;
  createdAt: any;
}

export interface Document {
  id: string;
  caseId: string;
  fileName: string;
  fileUrl: string;
  textContent?: string;
  type: string;
  fileSize?: number;
  userId: string;
  createdAt: any;
}

export interface Contradiction {
  issue: string;
  conflict: string;
  severity: 'Critical' | 'Material' | 'Minor';
  sourceA: string;
  sourceB: string;
  impeachmentStrategy: string;
}

export interface CrossExamItem {
  id: string;
  question: string;
  targetVulnerability: string;
  purpose: string;
  recommendedDefense: string;
  objectionBasis: string;
}

export interface ChainOfCustodyData {
  sha256Hash: string;
  intakeTimestamp: string;
  custodian: string;
  tamperStatus: 'Verified Intact' | 'Protected';
  complianceStandard: string;
}

export interface Analysis {
  id: string;
  documentId: string;
  summary: string;
  timeline: TimelineEvent[];
  evidence_audit: ForensicReport[];
  legal_points: string[];
  contradictions?: Contradiction[];
  cross_examination?: CrossExamItem[];
  chain_of_custody?: ChainOfCustodyData;
  userId: string;
  createdAt: any;
}

export interface ForensicReport {
  description: string;
  verdict: 'Real' | 'Fake';
  ai_probability: number;
  true_probability: number;
  forensic_notes: string;
}

export interface TimelineEvent {
  date: string;
  event: string;
  description: string;
}

export interface Precedent {
  caseName: string;
  citation: string;
  relevance: string;
}

export interface ChatMessage {
  id: string;
  documentId: string;
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  createdAt: any;
}

export type JudicialRole = 
  | 'Chief Justice'
  | 'High Court Judge'
  | 'Magistrate'
  | 'Public Prosecutor'
  | 'Advocate / Legal Counsel'
  | 'Judicial Clerk'
  | 'Court Administrator';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: JudicialRole;
  bio?: string;
  gender?: 'Male' | 'Female' | 'Non-Binary' | 'Prefer not to say';
  updatedAt?: any;
}
