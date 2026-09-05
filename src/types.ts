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

export interface Analysis {
  id: string;
  documentId: string;
  summary: string;
  timeline: TimelineEvent[];
  evidence_audit: ForensicReport[];
  legal_points: string[];
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
