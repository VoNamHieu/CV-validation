import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Types ──
export interface ExperienceDetail {
  title: string;
  company: string;
  duration_months: number;
  description: string;
}

export interface EducationDetail {
  degree: string;
  institution: string;
  year: string;
}

export interface ProjectDetail {
  name: string;
  description: string;
}

export interface CVData {
  name: string;
  summary: string;
  skills: string[];
  experience: ExperienceDetail[];
  education: EducationDetail[];
  projects: ProjectDetail[];
}

export interface JDData {
  must_have: string[];
  nice_to_have: string[];
  responsibilities: string[];
  seniority_expected: string;
  domain: string;
}

export interface CategoryScore {
  score: number;
  reasoning: string;
  gaps: string[];
}

export interface MatchResult {
  overall_score: number;
  must_have_match: CategoryScore;
  experience_match: CategoryScore;
  domain_match: CategoryScore;
  seniority_match: CategoryScore;
  nice_to_have_match: CategoryScore;
  strength_summary: string;
  risk_flags: string[];
}

// ── Job History Board ──
export interface JobRecord {
  id: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  siteName: string;
  overallScore: number;
  timestamp: number;
  jdData?: JDData;
  matchResult?: MatchResult;
}

// ── Multi-JD Ranking ──
export type JDEntryStatus = 'pending' | 'crawling' | 'parsing' | 'scoring' | 'done' | 'error';

export interface JDEntry {
  id: string;
  source: string; // URL or "text" or "pdf"
  label: string;  // display name (URL hostname or filename)
  status: JDEntryStatus;
  error?: string;
  jdData?: JDData;
  matchResult?: MatchResult;
}

type Step = 1 | 2 | 3;

interface AppState {
  // Navigation
  currentStep: Step;
  setStep: (step: Step) => void;

  // CV
  cvRawText: string;
  cvFileName: string;
  cvData: CVData | null;
  setCvRawText: (text: string, fileName: string) => void;
  setCvData: (data: CVData) => void;

  // Single JD (legacy, still used for text/pdf input)
  jdRawText: string;
  jdData: JDData | null;
  setJdRawText: (text: string) => void;
  setJdData: (data: JDData) => void;

  // Match
  matchResult: MatchResult | null;
  setMatchResult: (result: MatchResult) => void;

  // Optimized CV
  optimizedCv: CVData | null;
  setOptimizedCv: (data: CVData | null) => void;

  // Job History Board
  jobHistory: JobRecord[];
  addJobRecord: (record: JobRecord) => void;
  clearJobHistory: () => void;

  // Multi-JD Ranking
  jdEntries: JDEntry[];
  addJdEntry: (entry: JDEntry) => void;
  updateJdEntry: (id: string, updates: Partial<JDEntry>) => void;
  removeJdEntry: (id: string) => void;
  clearJdEntries: () => void;
  selectedJdId: string | null;
  setSelectedJdId: (id: string | null) => void;

  // Loading states
  isLoading: boolean;
  loadingMessage: string;
  setLoading: (loading: boolean, message?: string) => void;

  // Reset
  resetAll: () => void;
}

const initialState = {
  currentStep: 1 as Step,
  cvRawText: '',
  cvFileName: '',
  cvData: null,
  jdRawText: '',
  jdData: null,
  matchResult: null,
  optimizedCv: null,
  jobHistory: [] as JobRecord[],
  jdEntries: [] as JDEntry[],
  selectedJdId: null as string | null,
  isLoading: false,
  loadingMessage: '',
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ currentStep: step }),

      setCvRawText: (text, fileName) => set({ cvRawText: text, cvFileName: fileName }),
      setCvData: (data) => set({ cvData: data }),

      setJdRawText: (text) => set({ jdRawText: text }),
      setJdData: (data) => set({ jdData: data }),

      setMatchResult: (result) => set({ matchResult: result }),
      setOptimizedCv: (data) => set({ optimizedCv: data }),

      // Job History
      addJobRecord: (record) => set((s) => ({ jobHistory: [record, ...s.jobHistory] })),
      clearJobHistory: () => set({ jobHistory: [] }),

      // Multi-JD
      addJdEntry: (entry) => set((s) => ({ jdEntries: [...s.jdEntries, entry] })),
      updateJdEntry: (id, updates) =>
        set((s) => ({
          jdEntries: s.jdEntries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        })),
      removeJdEntry: (id) =>
        set((s) => ({ jdEntries: s.jdEntries.filter((e) => e.id !== id) })),
      clearJdEntries: () => set({ jdEntries: [] }),
      setSelectedJdId: (id) => set({ selectedJdId: id }),

      setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'ai-job-fit-optimizer',
    }
  )
);
