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
import type { CvImprovement } from '@/lib/cv-improvements';

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
  source: string; // URL or "text" or "pdf" — the JD page crawled/scored
  // Official link to send the user to when applying (e.g. company career page).
  // Falls back to `source` when unset. Lets us crawl an aggregator JD for
  // scoring without ever surfacing that aggregator URL as the apply target.
  applyUrl?: string;
  label: string;  // display name (URL hostname or filename)
  status: JDEntryStatus;
  optimizing?: boolean; // background auto-optimize in flight
  error?: string;
  jdData?: JDData;
  matchResult?: MatchResult;
  optimizedCv?: CVData;
  // Why/what the optimizer changed for this job — shown in the editor.
  optimizedCvImprovements?: CvImprovement[];
  optimizedCvPdfBase64?: string;
  optimizedCvFileName?: string;
  jobTitle?: string;
  company?: string;
  // Job's free-text location (from the listing), used for city matching.
  location?: string;
  // JD text the search layer already fetched from an ATS API. When present and
  // substantial, the pipeline scores it directly instead of re-crawling the
  // (often SPA / IP-blocked) JD page.
  prefetchedJd?: string;
  // Set when this job matched the target title but NOT the chosen city — the
  // UI labels it "khác thành phố" so the user knows it's an off-city result.
  locationNote?: string;
  // Which CV template the candidate chose for this job.
  selectedTemplateId?: CvTemplateId;
  // Role family (taxonomy) this job was ranked under — drives the role-adjacent
  // backfill: a dead posting is replaced by another job in the SAME family.
  roleFamily?: string;
}

type Step = 1 | 2 | 3 | 4;
export type AppView = 'apply' | 'editor' | 'history';

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

  // Job targeting — confirmed on the upload step, consumed by the job finder.
  // targetJobTitle defaults to the AI-inferred desired_job_title but the user
  // can override it. targetLocation is a CITY_OPTIONS key ('' = freestyle).
  targetJobTitle: string;
  targetLocation: string;
  // User's seniority preference ('' = no preference / infer from CV). A
  // canonical level string the facet engine understands; demotes ill-fitting
  // levels at search time.
  targetLevel: string;
  setTargetJobTitle: (title: string) => void;
  setTargetLocation: (cityKey: string) => void;
  setTargetLevel: (level: string) => void;
  // Honest pivot hint: set after a search when the target role's family differs
  // from the CV's proven family ('' = not a pivot / not yet searched).
  searchPivotNote: string;
  setSearchPivotNote: (note: string) => void;

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
  targetJobTitle: '',
  targetLocation: '',
  targetLevel: '',
  searchPivotNote: '',
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

      setTargetJobTitle: (title) => set({ targetJobTitle: title }),
      setTargetLocation: (cityKey) => set({ targetLocation: cityKey }),
      setTargetLevel: (level) => set({ targetLevel: level }),
      setSearchPivotNote: (note) => set({ searchPivotNote: note }),

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
        // Drop the heaviest field from persistence: each optimized CV caches its
        // rendered PDF as base64 (~100–500KB each). Persisting these across many
        // entries overflows the ~5MB localStorage quota — the write throws, the
        // in-memory store keeps the CV (so the editor still shows it this session)
        // but disk holds a stale snapshot WITHOUT it. On the next reload the entry
        // rehydrates as done-but-not-optimized → sortedEntries is empty → the
        // editor flaps to "No Optimized CVs Yet". The PDF is re-rendered on demand
        // (cache miss) in the download / batch-apply path, so memory-only is safe.
        if (Array.isArray(rest.jdEntries)) {
          rest.jdEntries = rest.jdEntries.map((e) => {
            if (!e.optimizedCvPdfBase64 && !e.optimizedCvFileName) return e;
            const slim = { ...e };
            delete slim.optimizedCvPdfBase64;
            delete slim.optimizedCvFileName;
            return slim;
          });
        }
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
        // A reload interrupts two kinds of in-flight work that would otherwise
        // hang forever after rehydration:
        //  - status still in a crawl/score phase → mark as an interrupted error.
        //  - `optimizing: true` left over (its status is already 'done') → clear
        //    it, else the editor's jobsInFlight check stays true and shows the
        //    "Optimizing your CVs…" spinner permanently.
        const needsFix = state.jdEntries.some((e) => inFlight.has(e.status) || e.optimizing);
        if (!needsFix) return;
        const fixed = state.jdEntries.map((e) => {
          if (inFlight.has(e.status)) {
            return { ...e, optimizing: false, status: 'error' as const, error: 'Interrupted by page reload' };
          }
          if (e.optimizing) return { ...e, optimizing: false };
          return e;
        });
        // Defer: this callback can run synchronously inside create(), before
        // the exported store binding exists.
        setTimeout(() => useAppStore.setState({ jdEntries: fixed }), 0);
      },
    }
  )
);
