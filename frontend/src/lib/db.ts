// Typed client for the Supabase-backed DB, via the backend proxy.
// The browser never sees DATABASE_URL — every call hits a Next API route
// (/api/store/*, /api/me/*) that forwards to the FastAPI backend.
import type { CVData } from './types';

// ── Row types (mirror public.* tables; embedding columns are never returned) ──
export interface Company {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    career_url: string | null;
    ats_type: string | null;
    in_universe: boolean;
    segment: string | null;
    demand_score: number;
    last_swept_at: string | null;
    created_at: string;
    has_logo?: boolean;   // true when the company has an uploaded source logo
}

export interface Job {
    id: string;
    company_id: string | null;
    external_id: string;
    title: string;
    location: string | null;
    description: string | null;
    role_family: string | null;
    industry: string | null;
    seniority: string | null;
    must_have: string[] | null;
    source_url: string | null;
    content_hash: string | null;
    is_active: boolean;
    last_seen_at: string | null;
    last_verified_at: string | null;
    dead_reason: string | null;
    indexed_at: string | null;
    apply_count: number;
    bookmark_count: number;
    hotness: number;
    created_at: string;
    distance?: number; // present only on semantic-search results
}

export interface CvProfile {
    id: string;
    user_id: string;
    raw_cv_url: string | null;
    structured: CVData;
    is_active: boolean;
    created_at: string;
}

export interface SavedJob {
    id: string;
    user_id: string;
    job_id: string | null;
    company_name: string | null;
    company_domain: string | null;
    ats_type: string | null;
    job_url: string | null;
    requirement_facts: Record<string, unknown> | null;
    in_universe: boolean;
    intent: string | null;
    is_live: boolean;
    last_verified_at: string | null;
    created_at: string;
}

export type ApplicationStatus =
    | 'tailored' | 'filled' | 'submitted' | 'callback' | 'interview' | 'offer' | 'rejected';

export interface Application {
    id: string;
    user_id: string;
    cv_profile_id: string | null;
    job_id: string | null;
    saved_job_id: string | null;
    company_name: string | null;
    job_title: string | null;
    role_family: string | null;
    seniority: string | null;
    jd_facts: Record<string, unknown> | null;
    source_url: string | null;
    tailored_cv: CVData | null;
    fit_score: number | null;
    fit_breakdown: Record<string, unknown> | null;
    status: ApplicationStatus;
    notes: string | null;
    outcome_at: string | null;
    anonymized_at: string | null;
    created_at: string;
    updated_at: string;
}

// ── Auth seam ────────────────────────────────────────────────────────────────
// Shared with the AI calls (api.ts) — see lib/auth-headers.ts. Prefers the
// Supabase session JWT; falls back to the dev X-User-Id header. setUserId is
// kept as the public name used elsewhere.
import { getAuthHeaders, setDevUserId } from './auth-headers';
import { reportIncident } from './incidents';

export const setUserId = setDevUserId;

async function req<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (init?.body) headers['Content-Type'] = 'application/json';
    if (init?.auth) Object.assign(headers, await getAuthHeaders());
    let res: Response;
    try {
        res = await fetch(path, { ...init, headers });
    } catch (netErr) {
        // Network failure (offline, DNS, CORS) — log as an incident then rethrow.
        reportIncident({
            incident_type: 'api_error', module: 'db.req',
            message: netErr instanceof Error ? netErr.message : 'network error',
            context: { endpoint: path, kind: 'network' },
        });
        throw netErr;
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err.detail || `Request failed: ${res.status}`) as Error & { status?: number };
        e.status = res.status;   // let callers distinguish 403 (real) from 401/5xx (transient)
        // Only server-side faults are incidents; 4xx are expected client outcomes.
        if (res.status >= 500) {
            reportIncident({
                incident_type: 'api_error', module: 'db.req',
                message: e.message, code: `HTTP ${res.status}`,
                context: { endpoint: path, status: res.status },
            });
        }
        throw e;
    }
    return res.json();
}

// ── Catalog (public) ─────────────────────────────────────────────────────────
export const catalog = {
    listCompanies: (opts: { inUniverse?: boolean; q?: string; limit?: number; offset?: number } = {}) => {
        const q = new URLSearchParams();
        if (opts.inUniverse !== undefined) q.set('in_universe', String(opts.inUniverse));
        if (opts.q) q.set('q', opts.q);
        if (opts.limit !== undefined) q.set('limit', String(opts.limit));
        if (opts.offset !== undefined) q.set('offset', String(opts.offset));
        return req<Company[]>(`/api/store/companies?${q}`);
    },
    getCompany: (id: string) => req<Company>(`/api/store/companies/${id}`),

    listJobs: (opts: {
        roleFamily?: string; industry?: string; seniority?: string;
        isActive?: boolean; limit?: number; offset?: number;
    } = {}) => {
        const q = new URLSearchParams();
        if (opts.roleFamily) q.set('role_family', opts.roleFamily);
        if (opts.industry) q.set('industry', opts.industry);
        if (opts.seniority) q.set('seniority', opts.seniority);
        if (opts.isActive !== undefined) q.set('is_active', String(opts.isActive));
        if (opts.limit !== undefined) q.set('limit', String(opts.limit));
        if (opts.offset !== undefined) q.set('offset', String(opts.offset));
        return req<Job[]>(`/api/store/jobs?${q}`);
    },
    getJob: (id: string) => req<Job>(`/api/store/jobs/${id}`),

    // Real HTTP URL of a company's stored (uploaded) logo. 404s when the company
    // has none — use it as an <img src> with an onError fallback to a
    // domain/Clearbit guess or a letter avatar, e.g.:
    //   <img src={catalog.companyLogoUrl(id)} onError={() => setFailed(true)} />
    companyLogoUrl: (companyId: string) => `/api/store/companies/${encodeURIComponent(companyId)}/logo`,

    // Real HTTP URL of a company's stored logo keyed by DOMAIN — for surfaces
    // that only know a domain (landing marquee, featured groups). 404s when the
    // company has no uploaded logo; fall back to Clearbit/letter via onError.
    companyLogoUrlByDomain: (domain: string) =>
        `/api/store/companies/logo-by-domain/${encodeURIComponent(domain)}`,

    searchJobs: (body: {
        query?: string; embedding?: number[];
        roleFamily?: string; industry?: string; limit?: number;
    }) => req<Job[]>(`/api/store/jobs/search`, {
        method: 'POST',
        body: JSON.stringify({
            query: body.query, embedding: body.embedding,
            role_family: body.roleFamily, industry: body.industry, limit: body.limit,
        }),
    }),
};

// ── Credits (user-scoped, requires auth) ──────────────────────────────────────
export const credits = {
    balance: () => req<{ balance: number; signup_grant: number }>(`/api/credits/balance`, { auth: true }),
    costs: () => req<Record<string, number>>(`/api/credits/costs`),
    // One-time free top-up; after that returns requires_payment=true.
    requestTopup: () => req<{ granted: number; balance: number; requires_payment: boolean }>(
        `/api/credits/request-topup`, { method: 'POST', auth: true }),
};

// ── Admin (allowlisted operators only; backend enforces via ADMIN_EMAILS) ─────
// Job row as the admin search returns it: full jobs columns + joined company.
export type AdminJob = Job & {
    company_name: string | null;
    career_url: string | null;
    // Latest promoted landing page for this job, if one exists (any session).
    promoted_slug?: string | null;
    promoted_status?: PromotedStatus | null;
    promoted_id?: string | null;
};

export interface AdminJobSearchParams {
    q?: string;
    mode?: 'keyword' | 'semantic';
    roleFamily?: string;
    industry?: string;
    seniority?: string;
    status?: 'all' | 'active' | 'dead';
    sort?: 'hotness' | 'created_at' | 'title' | 'company_name' | 'location';
    limit?: number;
    offset?: number;
}

export type FacetValue = { value: string; count: number };

// ── Analytics dashboard payloads ──
export interface AnalyticsSummary {
    window_days: number;
    users: { total: number; new: number };
    engagement: { sessions: number; events: number };
    applications: { total: number; new: number; by_status: Record<string, number> };
    credits: {
        granted: number; spent: number;
        by_reason: Record<string, { count: number; total: number }>;
    };
    jobs: { total: number; active: number; dead: number; companies: number };
    promoted: { total: number; published: number; views: number };
    interview: { preps: number; attempts: number };
    feedback: { total: number; avg_rating: number | null; rating_dist: Record<string, number> };
    top_events: { event: string; count: number }[];
    facets: { role_family?: FacetValue[]; industry?: FacetValue[]; seniority?: FacetValue[] };
}
export interface AnalyticsTimeseries {
    dates: string[];
    signups: number[];
    sessions: number[];
    applications: number[];
    spend: number[];
}

export type AdminRole = 'super' | 'member';

export interface AdminMember {
    email: string;
    added_by: string | null;
    created_at: string;
}

export const admin = {
    // 200 when the caller is an admin; throws (403) otherwise. Used to gate the
    // page. `role` distinguishes env SUPER admins from UI-granted members so the
    // UI can hide member-only-forbidden actions (e.g. removing members).
    check: () => req<{ ok: boolean; role: AdminRole; email: string }>(`/api/admin/check`, { auth: true }),

    // ── Admin members (phân quyền) ──
    listMembers: () =>
        req<{ super_admins: string[]; members: AdminMember[] }>(`/api/admin/members`, { auth: true }),
    addMember: (email: string) =>
        req<AdminMember>(`/api/admin/members`, {
            method: 'POST', body: JSON.stringify({ email }), auth: true,
        }),
    removeMember: (email: string) =>
        req<{ ok: boolean; email: string }>(
            `/api/admin/members/${encodeURIComponent(email)}`, { method: 'DELETE', auth: true },
        ),
    lookupUser: (email: string) =>
        req<{ user_id: string; email: string; balance: number }>(
            `/api/admin/users/lookup?email=${encodeURIComponent(email)}`, { auth: true },
        ),
    grantCredits: (body: { email: string; amount: number; reason?: string }) =>
        req<{ user_id: string; email: string; granted: number; balance: number; reason: string }>(
            `/api/admin/credits/grant`, { method: 'POST', body: JSON.stringify(body), auth: true },
        ),
    listFeedback: () => req<Feedback[]>(`/api/admin/feedback`, { auth: true }),

    // Operator search over the whole job store (dead rows included).
    searchJobs: (p: AdminJobSearchParams = {}) => {
        const qs = new URLSearchParams();
        if (p.q) qs.set('q', p.q);
        if (p.mode) qs.set('mode', p.mode);
        if (p.roleFamily) qs.set('role_family', p.roleFamily);
        if (p.industry) qs.set('industry', p.industry);
        if (p.seniority) qs.set('seniority', p.seniority);
        if (p.status) qs.set('status', p.status);
        if (p.sort) qs.set('sort', p.sort);
        if (p.limit !== undefined) qs.set('limit', String(p.limit));
        if (p.offset !== undefined) qs.set('offset', String(p.offset));
        return req<{ total: number; results: AdminJob[] }>(
            `/api/admin/jobs/search?${qs}`, { auth: true },
        );
    },
    jobFacets: () =>
        req<{ role_family: FacetValue[]; industry: FacetValue[]; seniority: FacetValue[] }>(
            `/api/admin/jobs/facets`, { auth: true },
        ),

    // Crawl trigger: ATS ingest + embedding backfill runs as a backend
    // background task; POST kicks it off, GET polls until running=false.
    triggerIngest: (render = false) =>
        req<IngestState & { started: boolean }>(
            `/api/admin/jobs/ingest?render=${render}`, { method: 'POST', auth: true },
        ),
    ingestStatus: () => req<IngestState>(`/api/admin/jobs/ingest/status`, { auth: true }),

    // Create a DRAFT landing page ("trang truyền thông") from a stored job. The
    // backend enriches the JD (crawls if empty) and returns jd_chars. Draft =
    // not public until published from the management tab. Idempotent per job.
    promoteJob: (jobId: string) =>
        req<{ id: string; slug: string; status: string; reused: boolean; jd_chars: number }>(
            `/api/store/promoted`,
            { method: 'POST', body: JSON.stringify({ job_id: jobId }), auth: true },
        ),

    // ── Promoted-page management (audit / publish / delete) ──
    listPromoted: () => req<PromotedPage[]>(`/api/store/promoted`, { auth: true }),
    patchPromoted: (
        id: string,
        body: { status?: PromotedStatus; slug?: string; template?: string; snapshot?: Record<string, unknown> },
    ) =>
        req<PromotedPage>(`/api/store/promoted/${id}`, {
            method: 'PATCH', body: JSON.stringify(body), auth: true,
        }),
    deletePromoted: (id: string) =>
        req<{ deleted: boolean }>(`/api/store/promoted/${id}`, { method: 'DELETE', auth: true }),

    // ── Company logos ──
    // List companies for the logo manager (name/domain filter, has_logo flag).
    listCompanies: (opts: { q?: string; limit?: number; offset?: number } = {}) =>
        catalog.listCompanies(opts),
    // Attach a source logo (base64, no data: prefix) to a company. Reused
    // everywhere the company shows up (promoted pages + surfaces) instead of a
    // letter avatar.
    setCompanyLogo: (companyId: string, body: { logo_b64: string; logo_mime: string }) =>
        req<{ id: string; has_logo: boolean }>(`/api/store/companies/${companyId}/logo`, {
            method: 'POST', body: JSON.stringify(body), auth: true,
        }),
    deleteCompanyLogo: (companyId: string) =>
        req<{ id: string; has_logo: boolean }>(`/api/store/companies/${companyId}/logo`, {
            method: 'DELETE', auth: true,
        }),

    // ── Analytics dashboard ──
    analyticsSummary: (days: number) =>
        req<AnalyticsSummary>(`/api/admin/analytics/summary?days=${days}`, { auth: true }),
    analyticsTimeseries: (days: number) =>
        req<AnalyticsTimeseries>(`/api/admin/analytics/timeseries?days=${days}`, { auth: true }),
    analyticsFunnel: (days: number) =>
        req<Record<string, number>>(`/api/admin/analytics/funnel?days=${days}`, { auth: true }),
    analyticsTopOptimizers: (days: number, limit = 20) =>
        req<TopOptimizer[]>(`/api/admin/analytics/top-optimizers?days=${days}&limit=${limit}`, { auth: true }),

    // ── Incident log ──
    listIncidents: (p: { incidentType?: string; resolved?: boolean; limit?: number; offset?: number } = {}) => {
        const qs = new URLSearchParams();
        if (p.incidentType) qs.set('incident_type', p.incidentType);
        if (p.resolved !== undefined) qs.set('resolved', String(p.resolved));
        if (p.limit !== undefined) qs.set('limit', String(p.limit));
        if (p.offset !== undefined) qs.set('offset', String(p.offset));
        return req<{ total: number; results: Incident[] }>(`/api/admin/incidents?${qs}`, { auth: true });
    },
    incidentsSummary: (days: number) =>
        req<IncidentSummary>(`/api/admin/incidents/summary?days=${days}`, { auth: true }),
    resolveIncident: (id: string, note?: string) =>
        req<{ ok: boolean }>(`/api/admin/incidents/${id}/resolve`, {
            method: 'POST', body: JSON.stringify({ resolution_note: note ?? null }), auth: true,
        }),
};

export interface TopOptimizer {
    email: string;
    jobs: number;
}

export type IncidentType = 'system_error' | 'extension_error' | 'api_error' | 'db_error';

export interface Incident {
    id: string;
    incident_type: IncidentType;
    source: string;
    module: string | null;
    severity: string;
    message: string | null;
    code: string | null;
    stack: string | null;
    context: Record<string, unknown> | null;
    resolved: boolean;
    resolved_at: string | null;
    resolved_by: string | null;
    user_id: string | null;
    session_id: string | null;
    created_at: string;
}

export interface IncidentSummary {
    window_days: number;
    total: number;
    unresolved: number;
    by_type: Record<string, number>;
    by_source: Record<string, number>;
    top_modules: { module: string; count: number }[];
}

export type PromotedStatus = 'draft' | 'published' | 'unpublished';

export interface PromotedPage {
    id: string;
    slug: string;
    job_id: string | null;
    snapshot: {
        title?: string;
        company_name?: string;
        location?: string;
        description?: string;
        industry?: string;
        seniority?: string;
        source_url?: string;
        logo_mime?: string;
        has_logo?: boolean;   // list endpoint strips raw logo_b64, exposes this
    };
    status: PromotedStatus;
    template: string;
    og_image_url: string | null;
    view_count: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface IngestState {
    running: boolean;
    last: {
        at: number;
        phase: 'crawling' | 'embedding' | 'done' | 'error';
        duration_s?: number;
        error: string | null;
        stats: {
            companies_with_feed: number;
            jobs_upserted: number;
            jobs_deactivated: number;
            jobs_embedded?: number;
            by_source: Record<string, number>;
        } | null;
    } | null;
}

// ── Account (user-scoped, requires auth) ──────────────────────────────────────
export interface Profile {
    id: string;
    email: string | null;
    created_at?: string;
    terms_accepted_at: string | null;
    terms_version: string | null;
    agent_consent_at: string | null;
}

export interface Feedback {
    id: string;
    user_id: string | null;
    email: string | null;
    message: string;
    rating: number | null;
    source: string | null;
    page_url: string | null;
    created_at: string;
}

export const account = {
    getProfile: () => req<Profile>(`/api/me`, { auth: true }),

    // Layer 1: record the mandatory Terms + Privacy acceptance from signup.
    acceptTerms: (version: string) =>
        req<Profile>(`/api/me/accept-terms`, { method: 'POST', body: JSON.stringify({ version }), auth: true }),
    // Layer 2: record the just-in-time consent for the auto-apply agent.
    recordAgentConsent: () =>
        req<Profile>(`/api/me/agent-consent`, { method: 'POST', auth: true }),

    // Permanently delete the account + all data (Privacy §5).
    deleteAccount: () =>
        req<{ deleted: boolean }>(`/api/me/account`, { method: 'DELETE', auth: true }),

    // Submit a feedback / support message (shared /feedback endpoint).
    submitFeedback: (body: { message: string; rating?: number; source?: string; page_url?: string }) =>
        req<Feedback>(`/api/feedback`, { method: 'POST', body: JSON.stringify(body), auth: true }),

    listCvProfiles: () => req<CvProfile[]>(`/api/me/cv-profiles`, { auth: true }),
    getActiveCvProfile: () => req<CvProfile>(`/api/me/cv-profiles/active`, { auth: true }),
    createCvProfile: (body: { structured: CVData; raw_cv_url?: string; embedding?: number[]; make_active?: boolean }) =>
        req<CvProfile>(`/api/me/cv-profiles`, { method: 'POST', body: JSON.stringify(body), auth: true }),
    activateCvProfile: (id: string) =>
        req<CvProfile>(`/api/me/cv-profiles/${id}/activate`, { method: 'PUT', auth: true }),
    deleteCvProfile: (id: string) =>
        req<{ deleted: boolean }>(`/api/me/cv-profiles/${id}`, { method: 'DELETE', auth: true }),

    listSavedJobs: () => req<SavedJob[]>(`/api/me/saved-jobs`, { auth: true }),
    saveJob: (body: Partial<Omit<SavedJob, 'id' | 'user_id' | 'is_live' | 'last_verified_at' | 'created_at'>>) =>
        req<SavedJob>(`/api/me/saved-jobs`, { method: 'POST', body: JSON.stringify(body), auth: true }),
    deleteSavedJob: (id: string) =>
        req<{ deleted: boolean }>(`/api/me/saved-jobs/${id}`, { method: 'DELETE', auth: true }),

    listApplications: (status?: ApplicationStatus) =>
        req<Application[]>(`/api/me/applications${status ? `?status=${status}` : ''}`, { auth: true }),
    getApplication: (id: string) => req<Application>(`/api/me/applications/${id}`, { auth: true }),
    createApplication: (body: Partial<Omit<Application, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'outcome_at' | 'anonymized_at'>>) =>
        req<Application>(`/api/me/applications`, { method: 'POST', body: JSON.stringify(body), auth: true }),
    updateApplicationStatus: (id: string, status: ApplicationStatus) =>
        req<Application>(`/api/me/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }), auth: true }),
    updateApplicationNotes: (id: string, notes: string) =>
        req<Application>(`/api/me/applications/${id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }), auth: true }),
    updateApplicationCv: (id: string, tailored_cv: CVData) =>
        req<Application>(`/api/me/applications/${id}/cv`, { method: 'PATCH', body: JSON.stringify({ tailored_cv }), auth: true }),
    deleteApplication: (id: string) =>
        req<{ deleted: boolean }>(`/api/me/applications/${id}`, { method: 'DELETE', auth: true }),

    // ── Interview prep (user-scoped; dossier cached by job_ref + cv_hash) ──
    listInterviewPreps: () => req<InterviewPrepSummary[]>(`/api/me/interview/preps`, { auth: true }),
    getInterviewPrep: (jobRef: string, cvHash: string) =>
        req<InterviewPrep>(
            `/api/me/interview/prep?job_ref=${encodeURIComponent(jobRef)}&cv_hash=${encodeURIComponent(cvHash)}`,
            { auth: true }),
    putInterviewPrep: (jobRef: string, cvHash: string, dossier: unknown) =>
        req<InterviewPrep>(`/api/me/interview/prep`, {
            method: 'PUT', auth: true,
            body: JSON.stringify({ job_ref: jobRef, cv_hash: cvHash, dossier }),
        }),
    addPracticeAttempt: (body: {
        prep_id: string; question_id: string; attempt_no: number;
        answer_text?: string; self_reflection?: string; checklist?: unknown;
    }) => req<PracticeAttempt>(`/api/me/interview/attempts`, {
        method: 'POST', auth: true, body: JSON.stringify(body),
    }),
    listPracticeAttempts: (prepId: string) =>
        req<PracticeAttempt[]>(`/api/me/interview/attempts?prep_id=${encodeURIComponent(prepId)}`, { auth: true }),
};

export interface InterviewPrep {
    id: string;
    user_id: string;
    job_ref: string;
    cv_hash: string;
    dossier: import('@/lib/skills/interview/types').Dossier;
    created_at: string;
    updated_at: string;
}

// Lightweight row for the interview-prep landing list (no dossier body).
export interface InterviewPrepSummary {
    id: string;
    job_ref: string;
    cv_hash: string;
    question_count: number;
    created_at: string;
    updated_at: string;
}

export interface PracticeAttempt {
    id: string;
    user_id: string;
    prep_id: string;
    question_id: string;
    attempt_no: number;
    answer_text: string | null;
    self_reflection: string | null;
    checklist: Record<string, unknown>;
    created_at: string;
}
