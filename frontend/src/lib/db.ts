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

export const setUserId = setDevUserId;

async function req<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (init?.body) headers['Content-Type'] = 'application/json';
    if (init?.auth) Object.assign(headers, await getAuthHeaders());
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ── Catalog (public) ─────────────────────────────────────────────────────────
export const catalog = {
    listCompanies: (opts: { inUniverse?: boolean; limit?: number; offset?: number } = {}) => {
        const q = new URLSearchParams();
        if (opts.inUniverse !== undefined) q.set('in_universe', String(opts.inUniverse));
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
};

// ── Account (user-scoped, requires auth) ──────────────────────────────────────
export const account = {
    getProfile: () => req<{ id: string; email: string | null }>(`/api/me`, { auth: true }),

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
    deleteApplication: (id: string) =>
        req<{ deleted: boolean }>(`/api/me/applications/${id}`, { method: 'DELETE', auth: true }),
};
