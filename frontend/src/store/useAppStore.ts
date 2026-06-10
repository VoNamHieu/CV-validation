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
import type { CvTemplateId } from '@/lib/cv-templates';

// Re-export for backward compatibility
export type { ExperienceDetail, EducationDetail, ProjectDetail, CVData, JDData, CategoryScore, MatchResult };

// ── Application Status (ATS-lite) ──
export type JobStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected';

export const JOB_STATUS_ORDER: JobStatus[] = ['saved', 'applied', 'interviewing', 'offer', 'rejected'];

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
  optimizedCv?: CVData;
  status: JobStatus;
  notes?: string;
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
  optimizedCvPdfBase64?: string;
  optimizedCvFileName?: string;
  jobTitle?: string;
  company?: string;
  // Which CV template the candidate chose for this job.
  selectedTemplateId?: CvTemplateId;
}

type Step = 1 | 2 | 3 | 4;
export type AppView = 'apply' | 'history';

interface AppState {
  // Top-level navigation (sidebar)
  view: AppView;
  setView: (view: AppView) => void;

  // Wizard step
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
  updateJobRecord: (id: string, updates: Partial<JobRecord>) => void;
  removeJobRecord: (id: string) => void;
  clearJobHistory: () => void;
  loadJobRecordIntoWizard: (id: string) => void;

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

  // Fully-auto pipeline (CV upload → search → optimize → batch apply, no clicks)
  // Volatile: not persisted, so a page reload exits auto mode.
  fullyAutoMode: boolean;
  setFullyAutoMode: (v: boolean) => void;

  // User avatar — global (one photo applies to every template render).
  // Stored as a small JPEG data URL produced by lib/avatar.ts.
  userAvatarBase64: string | null;
  setUserAvatar: (dataUrl: string | null) => void;

  // Reset
  resetAll: () => void;
}

const initialState = {
  view: 'apply' as AppView,
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
  fullyAutoMode: false,
  userAvatarBase64: null as string | null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setView: (view) => set({ view }),
      setStep: (step) => set({ currentStep: step }),

      setCvRawText: (text, fileName) => set({ cvRawText: text, cvFileName: fileName }),
      setCvData: (data) => set({ cvData: data }),

      setJdRawText: (text) => set({ jdRawText: text }),
      setJdData: (data) => set({ jdData: data }),

      setMatchResult: (result) => set({ matchResult: result }),
      setOptimizedCv: (data) => set({ optimizedCv: data }),

      // Job History (auto-prune oldest)
      addJobRecord: (record) => set((s) => {
        const updated = [{ ...record, status: record.status ?? 'saved' }, ...s.jobHistory];
        return { jobHistory: updated.slice(0, MAX_JOB_HISTORY) };
      }),
      updateJobRecord: (id, updates) => set((s) => ({
        jobHistory: s.jobHistory.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      })),
      removeJobRecord: (id) => set((s) => ({
        jobHistory: s.jobHistory.filter((r) => r.id !== id),
      })),
      clearJobHistory: () => set({ jobHistory: [] }),

      // Re-open a saved job inside the wizard at the Report step
      loadJobRecordIntoWizard: (id) => {
        const record = get().jobHistory.find((r) => r.id === id);
        if (!record) return;
        set({
          jdData: record.jdData ?? null,
          matchResult: record.matchResult ?? null,
          optimizedCv: record.optimizedCv ?? null,
          currentStep: 3,
          view: 'apply',
        });
      },

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

      setFullyAutoMode: (v) => set({ fullyAutoMode: v }),

      setUserAvatar: (dataUrl) => set({ userAvatarBase64: dataUrl }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'ai-job-fit-optimizer',
      version: 2,
      // fullyAutoMode is intentionally excluded so a reload mid-pipeline
      // doesn't resurrect auto-apply on a stale state.
      partialize: (state) => {
        const rest: Partial<AppState> = { ...state };
        delete (rest as { fullyAutoMode?: boolean }).fullyAutoMode;
        return rest;
      },
      // Defaults missing fields on persisted records from older versions.
      // Why: jobHistory existed before status/notes/view — without this, restored
      // records would crash filters/dropdowns expecting `status` to be set.
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<AppState> & Record<string, unknown>;
        if (version < 2 && state?.jobHistory && Array.isArray(state.jobHistory)) {
          state.jobHistory = (state.jobHistory as JobRecord[]).map((r) => ({
            ...r,
            status: r.status ?? 'saved',
          }));
        }
        if (!state.view) state.view = 'apply';
        return state as AppState;
      },
      // The crawl→extract→score run itself is volatile (it lives in a React
      // component), but jdEntries are persisted. After a reload, an entry
      // still marked in-flight can never progress — it would show a spinner
      // forever. Surface it as an interrupted error instead.
      onRehydrateStorage: () => (state) => {
        if (!state?.jdEntries?.length) return;
        const inFlight = new Set<JDEntryStatus>(['pending', 'crawling', 'parsing', 'scoring']);
        if (!state.jdEntries.some((e) => inFlight.has(e.status))) return;
        const fixed = state.jdEntries.map((e) =>
          inFlight.has(e.status)
            ? { ...e, status: 'error' as const, error: 'Interrupted by page reload' }
            : e,
        );
        // Defer: this callback can run synchronously inside create(), before
        // the exported store binding exists.
        setTimeout(() => useAppStore.setState({ jdEntries: fixed }), 0);
      },
    }
  )
);
