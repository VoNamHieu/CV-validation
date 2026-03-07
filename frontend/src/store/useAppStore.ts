import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Auto-prune limits to prevent localStorage overflow (~5MB) ──
const MAX_JD_ENTRIES = 100;
const MAX_JOB_HISTORY = 200;

// ── Shared types — single source of truth in types.ts (M1) ──
import type {
  ExperienceDetail, EducationDetail, ProjectDetail,
  CVData, JDData, CategoryScore, MatchResult,
} from '@/lib/types';

// Re-export for backward compatibility
export type { ExperienceDetail, EducationDetail, ProjectDetail, CVData, JDData, CategoryScore, MatchResult };

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
  optimizedCv?: CVData;
  jobTitle?: string;
  company?: string;
}

type Step = 1 | 2 | 3 | 4;

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

      // Job History (auto-prune oldest)
      addJobRecord: (record) => set((s) => {
        const updated = [record, ...s.jobHistory];
        return { jobHistory: updated.slice(0, MAX_JOB_HISTORY) };
      }),
      clearJobHistory: () => set({ jobHistory: [] }),

      // Multi-JD (auto-prune oldest when limit reached)
      addJdEntry: (entry) => set((s) => {
        const updated = [...s.jdEntries, entry];
        return { jdEntries: updated.length > MAX_JD_ENTRIES ? updated.slice(-MAX_JD_ENTRIES) : updated };
      }),
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
