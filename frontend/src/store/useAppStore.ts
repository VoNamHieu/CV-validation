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

type Step = 1 | 2 | 3 | 4 | 5;

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

  // JD
  jdRawText: string;
  jdData: JDData | null;
  setJdRawText: (text: string) => void;
  setJdData: (data: JDData) => void;

  // Match
  matchResult: MatchResult | null;
  setMatchResult: (result: MatchResult) => void;

  // Optimized CV
  optimizedCv: CVData | null;
  setOptimizedCv: (data: CVData) => void;

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

      setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'ai-job-fit-optimizer',
    }
  )
);
