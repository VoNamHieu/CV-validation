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
import type { CvImprovement, CvSuggestion } from '@/lib/cv-improvements';
import { account, type Application, type ApplicationStatus } from '@/lib/db';
import { hasAuth } from '@/lib/auth-headers';
import type { GapReport } from '@/lib/gap-report';

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

// ── JobRecord ⇄ server Application mapping ──
// The history board is now backed by public.applications (user-scoped), not
// localStorage. The board's 5-stage vocabulary maps onto the DB funnel's 7
// stages both ways so the backend stays the source of truth without changing
// the UI. Stages with no board equivalent (filled/callback) fold into the
// nearest board stage on read.
const STATUS_TO_DB: Record<JobStatus, ApplicationStatus> = {
  saved: 'tailored', applied: 'submitted', interviewing: 'interview',
  offer: 'offer', rejected: 'rejected',
};
const STATUS_FROM_DB: Record<ApplicationStatus, JobStatus> = {
  tailored: 'saved', filled: 'applied', submitted: 'applied',
  callback: 'interviewing', interview: 'interviewing',
  offer: 'offer', rejected: 'rejected',
};

function hostnameOf(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Dedup key: prefer the job URL; fall back to title|company when there's no URL
// (e.g. text/PDF-pasted JDs) so the same posting isn't recorded twice.
function seenKey(url?: string, title?: string, company?: string): string {
  const u = (url ?? '').trim();
  return u || `${title ?? ''}|${company ?? ''}`;
}

function appToRecord(a: Application): JobRecord {
  return {
    id: a.id,
    jobTitle: a.job_title ?? '',
    company: a.company_name ?? '',
    jobUrl: a.source_url ?? '',
    siteName: hostnameOf(a.source_url ?? ''),
    overallScore: a.fit_score ?? 0,
    timestamp: a.created_at ? Date.parse(a.created_at) : Date.now(),
    jdData: (a.jd_facts as unknown as JDData) ?? undefined,
    matchResult: (a.fit_breakdown as unknown as MatchResult) ?? undefined,
    optimizedCv: a.tailored_cv ?? undefined,
    status: STATUS_FROM_DB[a.status] ?? 'saved',
    notes: a.notes ?? undefined,
  };
}

function recordToCreate(r: JobRecord) {
  return {
    job_title: r.jobTitle || null,
    company_name: r.company || null,
    source_url: r.jobUrl || null,
    fit_score: Number.isFinite(r.overallScore) ? Math.round(r.overallScore) : null,
    jd_facts: (r.jdData as unknown as Record<string, unknown>) ?? null,
    fit_breakdown: (r.matchResult as unknown as Record<string, unknown>) ?? null,
    tailored_cv: r.optimizedCv ?? null,
    status: STATUS_TO_DB[r.status] ?? 'tailored',
    notes: r.notes ?? null,
  };
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
  // Prospective improvements needing the candidate's real input (quantify →
  // re-optimize). Rendered as the "Có thể cân nhắc" section in the editor.
  optimizedCvSuggestions?: CvSuggestion[];
  optimizedCvPdfBase64?: string;
  optimizedCvFileName?: string;
  // Per-job tailored cover letter (from /api/ai/cover-letter), on-demand in the
  // chosen language. Switching language regenerates + replaces it (no cache).
  // Fed into the extension profile at apply time so auto-apply fills a letter
  // written for THIS job, not the generic summary. coverLetterLang labels it.
  coverLetter?: string;
  coverLetterLang?: string;
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
  // Deep gap-analysis result + in-flight flag, kept on the entry (not in the
  // GapReportSection's local state) so switching tabs/jobs doesn't discard a
  // credit-charged report mid-flight. gapLoading is reset on rehydrate (no
  // in-flight request survives a reload).
  gapReport?: GapReport;
  gapLoading?: boolean;
  gapError?: string;
}

// A discovered-but-not-yet-processed job, shown on the results page so the user
// can curate (remove / find more) BEFORE we spend credits crawling + scoring +
// tailoring. Carries everything needed to later build a JDEntry without a
// re-search. Transient: never persisted (see partialize).
export interface CandidateJob {
  id: string;
  url: string;
  applyUrl: string;
  title: string;
  company: string;
  careerUrl: string;
  location: string;
  description: string;    // JD text the search layer already fetched (prefetch)
  roleFamily?: string;
  locationNote?: string;  // "Khác <city>" when off the chosen city
}

type Step = 1 | 2 | 3 | 4;
export type AppView = 'apply' | 'editor' | 'history';

interface AppState {
  // Has the visitor left the landing page and entered the app (persisted, so
  // returning anonymous users skip the landing). Logged-in users skip it too.
  entered: boolean;
  enterApp: () => void;

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
  // Persist/restore the base CV per account via cv_profiles, so it survives
  // logout→login (resetUserData wipes it for isolation; this brings it back for
  // the same user). Restores when local is empty; persists local when the
  // backend has none yet.
  syncActiveCvProfile: () => Promise<void>;

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

  // Job History Board — backed by the server (public.applications), scoped to
  // the signed-in user. `jobHistory` is an in-memory cache hydrated by
  // loadJobHistory(); it is NOT persisted to localStorage (that leaked one
  // user's saved jobs to the next person on the same browser). Mutations write
  // through to the backend and update the cache optimistically.
  jobHistory: JobRecord[];
  loadJobHistory: () => Promise<void>;
  addJobRecord: (record: JobRecord) => void;
  updateJobRecord: (id: string, updates: Partial<JobRecord>) => void;
  removeJobRecord: (id: string) => void;
  clearJobHistory: () => void;
  loadJobRecordIntoWizard: (id: string) => void;
  // Attach a tailored CV to a saved-job record (by jobUrl) after optimization.
  attachCvToJobRecord: (jobUrl: string, cv: CVData) => void;

  // Multi-JD Ranking
  jdEntries: JDEntry[];
  addJdEntry: (entry: JDEntry) => void;
  updateJdEntry: (id: string, updates: Partial<JDEntry>) => void;
  removeJdEntry: (id: string) => void;
  clearJdEntries: () => void;
  selectedJdId: string | null;
  setSelectedJdId: (id: string | null) => void;

  // Results page (between search and edit). `candidates` = the jobs currently
  // shown for curation; `candidatePool` = ranked spares revealed by "find more".
  // `wizardStage` switches step 2 between the search form and the results list.
  candidates: CandidateJob[];
  candidatePool: CandidateJob[];
  wizardStage: 'search' | 'results';
  setDiscovery: (shown: CandidateJob[], pool: CandidateJob[]) => void;
  removeCandidate: (id: string) => void;
  revealMoreCandidates: (n?: number) => void;
  clearCandidates: () => void;
  setWizardStage: (stage: 'search' | 'results') => void;

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

  // Whose data currently lives in this browser's persisted store. Set on login;
  // when the signed-in user differs from this, resetUserData() wipes the
  // previous owner's CV / JD entries / optimized CVs so nothing leaks across
  // accounts on a shared browser. null = anonymous / unclaimed.
  ownerUserId: string | null;
  claimOwnership: (userId: string | null) => void;

  // Reset
  resetAll: () => void;
  // Clears per-user content (CV, JD entries, history cache, avatar, targets)
  // but keeps app-shell flags (entered/view). Used on logout / account switch.
  resetUserData: () => void;
}

const initialState = {
  entered: false,
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
  candidates: [] as CandidateJob[],
  candidatePool: [] as CandidateJob[],
  wizardStage: 'search' as 'search' | 'results',
  isLoading: false,
  loadingMessage: '',
  fullyAutoMode: false,
  userAvatarBase64: null as string | null,
  ownerUserId: null as string | null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      enterApp: () => set({ entered: true }),

      setView: (view) => set({ view }),
      setStep: (step) => set({ currentStep: step }),

      setCvRawText: (text, fileName) => set({ cvRawText: text, cvFileName: fileName }),
      setCvData: (data) => {
        set({ cvData: data });
        // Persist the base CV to the account so it survives logout→login.
        if (hasAuth()) void account.createCvProfile({ structured: data, make_active: true }).catch(() => {});
      },

      syncActiveCvProfile: async () => {
        if (!hasAuth()) return;
        try {
          const p = await account.getActiveCvProfile();
          if (p?.structured && !get().cvData) set({ cvData: p.structured });
        } catch {
          // No active profile on the backend yet — persist the local CV if any
          // (covers the anon-upload-then-login path).
          const local = get().cvData;
          if (local) { try { await account.createCvProfile({ structured: local, make_active: true }); } catch { /* best-effort */ } }
        }
      },

      setTargetJobTitle: (title) => set({ targetJobTitle: title }),
      setTargetLocation: (cityKey) => set({ targetLocation: cityKey }),
      setTargetLevel: (level) => set({ targetLevel: level }),
      setSearchPivotNote: (note) => set({ searchPivotNote: note }),

      setJdRawText: (text) => set({ jdRawText: text }),
      setJdData: (data) => set({ jdData: data }),

      setMatchResult: (result) => set({ matchResult: result }),
      setOptimizedCv: (data) => set({ optimizedCv: data }),

      // Job History — server-backed (public.applications), user-scoped. The
      // cache is hydrated from the backend; mutations write through.
      loadJobHistory: async () => {
        if (!hasAuth()) { set({ jobHistory: [] }); return; }
        try {
          const apps = await account.listApplications();
          set({ jobHistory: apps.map(appToRecord) });
        } catch { /* offline / 401 — keep whatever's cached */ }
      },

      addJobRecord: (record) => {
        const key = seenKey(record.jobUrl, record.jobTitle, record.company);
        if (get().jobHistory.some((j) => seenKey(j.jobUrl, j.jobTitle, j.company) === key)) return;
        const optimistic: JobRecord = { ...record, status: record.status ?? 'saved' };
        set((s) => ({ jobHistory: [optimistic, ...s.jobHistory].slice(0, MAX_JOB_HISTORY) }));
        if (!hasAuth()) return;
        // Persist, then swap the optimistic client id for the server id so later
        // status/notes/delete calls address the real row.
        void account.createApplication(recordToCreate(optimistic))
          .then((app) => {
            const saved = appToRecord(app);
            // Race: the CV may have been optimized (attachCvToJobRecord) while the
            // POST was in flight — the optimistic row holds it but the server row
            // doesn't. Re-persist so the tailored CV survives across sessions.
            const live = get().jobHistory.find((j) => j.id === optimistic.id);
            const pendingCv = live?.optimizedCv;
            set((s) => ({
              jobHistory: s.jobHistory.map((j) =>
                j.id === optimistic.id ? { ...saved, optimizedCv: pendingCv ?? saved.optimizedCv } : j),
            }));
            if (pendingCv && !saved.optimizedCv) {
              void account.updateApplicationCv(saved.id, pendingCv).catch(() => {});
            }
          })
          .catch(() => { /* keep optimistic; reconciles on next loadJobHistory */ });
      },

      updateJobRecord: (id, updates) => {
        set((s) => ({
          jobHistory: s.jobHistory.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        }));
        if (!hasAuth()) return;
        if (updates.status) {
          void account.updateApplicationStatus(id, STATUS_TO_DB[updates.status]).catch(() => {});
        }
        if (updates.notes !== undefined) {
          void account.updateApplicationNotes(id, updates.notes ?? '').catch(() => {});
        }
      },

      removeJobRecord: (id) => {
        set((s) => ({ jobHistory: s.jobHistory.filter((r) => r.id !== id) }));
        if (hasAuth()) void account.deleteApplication(id).catch(() => {});
      },

      clearJobHistory: () => {
        const ids = get().jobHistory.map((r) => r.id);
        set({ jobHistory: [] });
        if (hasAuth()) ids.forEach((id) => void account.deleteApplication(id).catch(() => {}));
      },

      // Re-open a saved job inside the wizard's editor (step 3). The editor
      // renders from jdEntries/selectedJdId — NOT the legacy single-JD fields —
      // so we reconstruct a self-contained entry from the record and make it the
      // only one shown, otherwise the editor keeps showing the last search's
      // entries instead of the job the user clicked. (The legacy fields are kept
      // in sync for any code path that still reads them.)
      loadJobRecordIntoWizard: (id) => {
        const record = get().jobHistory.find((r) => r.id === id);
        if (!record) return;
        const entryId = `history-${record.id}`;
        const entry: JDEntry = {
          id: entryId,
          source: record.jobUrl || entryId,
          applyUrl: record.jobUrl || undefined,
          label: record.jobTitle || record.company || 'Việc đã lưu',
          status: 'done',
          jdData: record.jdData,
          matchResult: record.matchResult,
          optimizedCv: record.optimizedCv,
          jobTitle: record.jobTitle || undefined,
          company: record.company || undefined,
        };
        set({
          jdEntries: [entry],
          selectedJdId: entryId,
          jdData: record.jdData ?? null,
          matchResult: record.matchResult ?? null,
          optimizedCv: record.optimizedCv ?? null,
          currentStep: 3,
          view: 'apply',
        });
      },

      // Persist a tailored CV onto the saved-job record (cache + backend) once it
      // exists. Called from the search/optimize flow with the SAME jobUrl used to
      // create the record, so the match is exact (no fuzzy URL correlation). This
      // is what lets a re-opened history job show its tailored CV across sessions
      // — records are created at scoring time, before the CV is optimized.
      attachCvToJobRecord: (jobUrl, cv) => {
        if (!jobUrl) return;
        const rec = get().jobHistory.find((r) => r.jobUrl === jobUrl);
        if (!rec || rec.optimizedCv === cv) return;
        set((s) => ({
          jobHistory: s.jobHistory.map((r) => (r.id === rec.id ? { ...r, optimizedCv: cv } : r)),
        }));
        // Skip when the create POST hasn't resolved yet (id still client-side);
        // addJobRecord re-persists the CV after the swap in that race.
        if (hasAuth() && !rec.id.startsWith('client-') && !rec.id.startsWith('job-') && !rec.id.startsWith('mode1-')) {
          void account.updateApplicationCv(rec.id, cv).catch(() => {});
        }
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

      // Results-page curation
      setDiscovery: (shown, pool) =>
        set({ candidates: shown, candidatePool: pool, wizardStage: 'results' }),
      removeCandidate: (id) =>
        set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) })),
      revealMoreCandidates: (n = 3) =>
        set((s) => {
          if (!s.candidatePool.length) return {} as Partial<AppState>;
          return {
            candidates: [...s.candidates, ...s.candidatePool.slice(0, n)],
            candidatePool: s.candidatePool.slice(n),
          };
        }),
      clearCandidates: () => set({ candidates: [], candidatePool: [] }),
      setWizardStage: (stage) => set({ wizardStage: stage }),

      setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

      setFullyAutoMode: (v) => set({ fullyAutoMode: v }),

      setUserAvatar: (dataUrl) => set({ userAvatarBase64: dataUrl }),

      // Claim the persisted store for `userId`. If it was owned by a DIFFERENT
      // user (account switch or stale data from a previous session on this
      // browser), wipe that user's content first so nothing leaks. An anonymous
      // visitor (current owner null) signing in just adopts their own local work.
      claimOwnership: (userId) => {
        const prev = get().ownerUserId;
        if (prev === userId) return;
        if (prev !== null && prev !== userId) get().resetUserData();
        set({ ownerUserId: userId });
      },

      resetUserData: () => set({
        cvRawText: '', cvFileName: '', cvData: null,
        targetJobTitle: '', targetLocation: '', targetLevel: '', searchPivotNote: '',
        jdRawText: '', jdData: null, matchResult: null, optimizedCv: null,
        jobHistory: [], jdEntries: [], selectedJdId: null,
        candidates: [], candidatePool: [], wizardStage: 'search',
        userAvatarBase64: null, currentStep: 1,
      }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'ai-job-fit-optimizer',
      version: 3,
      // fullyAutoMode is intentionally excluded so a reload mid-pipeline
      // doesn't resurrect auto-apply on a stale state.
      partialize: (state) => {
        const rest: Partial<AppState> = { ...state };
        delete (rest as { fullyAutoMode?: boolean }).fullyAutoMode;
        // jobHistory is server-backed now (public.applications) — never persist
        // it to localStorage. Persisting it is exactly what leaked one user's
        // saved jobs to the next person on the same browser. Rehydrated empty,
        // then loadJobHistory() fills it from the backend for the signed-in user.
        delete (rest as Record<string, unknown>).jobHistory;
        // Transient discovery state — re-derived from a fresh search, never
        // restored (a persisted 'results' stage with no candidates would be a
        // dead-end on reload).
        delete (rest as Record<string, unknown>).candidates;
        delete (rest as Record<string, unknown>).candidatePool;
        delete (rest as Record<string, unknown>).wizardStage;
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
        // v3: history moved to the server. Drop any locally-persisted jobHistory
        // (previous-user leak) — loadJobHistory() repopulates it from the backend.
        if (version < 3) delete (state as Record<string, unknown>).jobHistory;
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
        const needsFix = state.jdEntries.some((e) => inFlight.has(e.status) || e.optimizing || e.gapLoading);
        if (!needsFix) return;
        const fixed = state.jdEntries.map((e) => {
          // A gap report that was mid-flight at reload can't resume — clear the
          // flag so the button is clickable again (the report itself, if it
          // landed before reload, is kept).
          const base = e.gapLoading ? { ...e, gapLoading: false } : e;
          if (inFlight.has(base.status)) {
            return { ...base, optimizing: false, status: 'error' as const, error: 'Interrupted by page reload' };
          }
          if (base.optimizing) return { ...base, optimizing: false };
          return base;
        });
        // Defer: this callback can run synchronously inside create(), before
        // the exported store binding exists.
        setTimeout(() => useAppStore.setState({ jdEntries: fixed }), 0);
      },
    }
  )
);
