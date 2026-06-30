// E2E-ish test of the job-history fix: the store writes through to a (mocked)
// backend, hydrates from it, maps the UI⇄DB status vocabularies, and — the
// reason for the whole change — wipes per-user data when the browser's owner
// changes so one account never sees another's history/CV on a shared machine.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared mutable fakes. Defined via vi.hoisted so they exist before the (also
// hoisted) vi.mock factories run.
const { authState, backend, makeRow, account } = vi.hoisted(() => {
    interface Row { id: string; user_id: string; status: string; notes: string | null; [k: string]: unknown }
    const authState = { logged_in: true };
    const backend = { currentUser: 'user-A', rows: [] as Row[], seq: 0 };
    const makeRow = (user: string, body: Record<string, unknown>): Row => {
        backend.seq += 1;
        return {
            id: `srv-${backend.seq}`, user_id: user,
            job_title: null, company_name: null, source_url: null, fit_score: null,
            jd_facts: null, fit_breakdown: null, tailored_cv: null,
            status: 'tailored', notes: null,
            outcome_at: null, anonymized_at: null,
            created_at: '2026-06-30T00:00:00Z', updated_at: '2026-06-30T00:00:00Z',
            ...body,
        } as Row;
    };
    const account = {
        listApplications: vi.fn(async () => backend.rows.filter((r) => r.user_id === backend.currentUser)),
        createApplication: vi.fn(async (body: Record<string, unknown>) => {
            const row = makeRow(backend.currentUser, body);
            backend.rows.push(row);
            return row;
        }),
        updateApplicationStatus: vi.fn(async (id: string, status: string) => {
            const r = backend.rows.find((x) => x.id === id && x.user_id === backend.currentUser);
            if (r) r.status = status;
            return r;
        }),
        updateApplicationNotes: vi.fn(async (id: string, notes: string) => {
            const r = backend.rows.find((x) => x.id === id && x.user_id === backend.currentUser);
            if (r) r.notes = notes;
            return r;
        }),
        updateApplicationCv: vi.fn(async (id: string, tailored_cv: unknown) => {
            const r = backend.rows.find((x) => x.id === id && x.user_id === backend.currentUser);
            if (r) r.tailored_cv = tailored_cv;
            return r;
        }),
        deleteApplication: vi.fn(async (id: string) => {
            const i = backend.rows.findIndex((x) => x.id === id && x.user_id === backend.currentUser);
            if (i >= 0) backend.rows.splice(i, 1);
            return { deleted: true };
        }),
    };
    return { authState, backend, makeRow, account };
});

vi.mock('@/lib/auth-headers', () => ({
    hasAuth: () => authState.logged_in,
    getAuthHeaders: async () => ({}),
    setDevUserId: () => {},
}));
vi.mock('@/lib/db', () => ({ account }));

import { useAppStore, type JobRecord } from '@/store/useAppStore';

const flush = () => new Promise((r) => setTimeout(r, 0));
const rec = (over: Partial<JobRecord> = {}): JobRecord => ({
    id: `client-${Math.random()}`, jobTitle: 'Frontend Engineer', company: 'One Mount',
    jobUrl: 'https://onemount.com/jobs/1', siteName: 'onemount.com',
    overallScore: 88, timestamp: 1, status: 'saved', ...over,
});

beforeEach(() => {
    backend.rows = []; backend.seq = 0; backend.currentUser = 'user-A';
    authState.logged_in = true;
    useAppStore.getState().resetAll();
    vi.clearAllMocks();
});

describe('write-through to backend', () => {
    it('persists a new record and swaps the client id for the server id', async () => {
        useAppStore.getState().addJobRecord(rec({ id: 'client-1' }));
        // optimistic: visible immediately under the client id
        expect(useAppStore.getState().jobHistory).toHaveLength(1);
        expect(useAppStore.getState().jobHistory[0].id).toBe('client-1');
        await flush();
        expect(account.createApplication).toHaveBeenCalledOnce();
        // after the server responds, the cache holds the server id
        expect(useAppStore.getState().jobHistory[0].id).toBe('srv-1');
        expect(backend.rows).toHaveLength(1);
    });

    it('dedups by job URL — the same posting is never recorded twice', async () => {
        useAppStore.getState().addJobRecord(rec());
        useAppStore.getState().addJobRecord(rec({ jobTitle: 'dup' }));
        await flush();
        expect(useAppStore.getState().jobHistory).toHaveLength(1);
        expect(account.createApplication).toHaveBeenCalledOnce();
    });

    it('maps UI status → DB funnel status on status change', async () => {
        useAppStore.getState().addJobRecord(rec({ id: 'c' }));
        await flush();
        const id = useAppStore.getState().jobHistory[0].id;
        useAppStore.getState().updateJobRecord(id, { status: 'applied' });
        await flush();
        // 'applied' (UI) → 'submitted' (DB)
        expect(account.updateApplicationStatus).toHaveBeenCalledWith(id, 'submitted');
        expect(backend.rows[0].status).toBe('submitted');
    });

    it('writes notes through to the backend', async () => {
        useAppStore.getState().addJobRecord(rec({ id: 'c' }));
        await flush();
        const id = useAppStore.getState().jobHistory[0].id;
        useAppStore.getState().updateJobRecord(id, { notes: 'referral' });
        await flush();
        expect(account.updateApplicationNotes).toHaveBeenCalledWith(id, 'referral');
        expect(backend.rows[0].notes).toBe('referral');
    });

    it('deletes through to the backend', async () => {
        useAppStore.getState().addJobRecord(rec({ id: 'c' }));
        await flush();
        const id = useAppStore.getState().jobHistory[0].id;
        useAppStore.getState().removeJobRecord(id);
        await flush();
        expect(account.deleteApplication).toHaveBeenCalledWith(id);
        expect(backend.rows).toHaveLength(0);
    });
});

describe('hydration from backend', () => {
    it('loadJobHistory maps DB rows into the cache (status + notes + url)', async () => {
        backend.rows = [
            makeRow('user-A', { job_title: 'X', source_url: 'https://a.com/1', status: 'interview', notes: 'n', fit_score: 70 }),
        ];
        await useAppStore.getState().loadJobHistory();
        const h = useAppStore.getState().jobHistory;
        expect(h).toHaveLength(1);
        expect(h[0].status).toBe('interviewing'); // 'interview' (DB) → 'interviewing' (UI)
        expect(h[0].notes).toBe('n');
        expect(h[0].jobUrl).toBe('https://a.com/1');
        expect(h[0].siteName).toBe('a.com');
    });

    it('logged-out loadJobHistory clears the cache and never calls the backend', async () => {
        authState.logged_in = false;
        useAppStore.setState({ jobHistory: [rec()] });
        await useAppStore.getState().loadJobHistory();
        expect(useAppStore.getState().jobHistory).toEqual([]);
        expect(account.listApplications).not.toHaveBeenCalled();
    });
});

describe('cross-account isolation (the leak fix)', () => {
    it('switching owner wipes the previous user\'s data', () => {
        const s = useAppStore.getState();
        s.claimOwnership('user-A');
        useAppStore.setState({
            cvData: { name: 'A' } as never,
            jobHistory: [rec()],
            jdEntries: [{ id: 'j1' } as never],
        });
        // a different user signs in on the same browser
        useAppStore.getState().claimOwnership('user-B');
        const after = useAppStore.getState();
        expect(after.ownerUserId).toBe('user-B');
        expect(after.cvData).toBeNull();
        expect(after.jobHistory).toEqual([]);
        expect(after.jdEntries).toEqual([]);
    });

    it('logout (owner → null) wipes data too', () => {
        useAppStore.getState().claimOwnership('user-A');
        useAppStore.setState({ cvData: { name: 'A' } as never, jobHistory: [rec()] });
        useAppStore.getState().claimOwnership(null);
        expect(useAppStore.getState().cvData).toBeNull();
        expect(useAppStore.getState().jobHistory).toEqual([]);
    });

    it('anonymous → login adopts the local work instead of wiping it', () => {
        // owner starts null (anonymous); user uploads a CV before signing in
        useAppStore.setState({ cvData: { name: 'pre-login' } as never });
        useAppStore.getState().claimOwnership('user-A');
        expect(useAppStore.getState().ownerUserId).toBe('user-A');
        expect(useAppStore.getState().cvData).toEqual({ name: 'pre-login' }); // kept
    });

    it('re-claiming the same owner is a no-op (page refresh keeps data)', () => {
        useAppStore.getState().claimOwnership('user-A');
        useAppStore.setState({ cvData: { name: 'A' } as never });
        useAppStore.getState().claimOwnership('user-A');
        expect(useAppStore.getState().cvData).toEqual({ name: 'A' });
    });
});

describe('reopen a saved job into the editor (the wizard bug)', () => {
    it('reconstructs a jdEntry from the record and selects it — not the search session', () => {
        // a leftover search session is present…
        useAppStore.setState({ jdEntries: [{ id: 'search-1', source: 's', label: 'search', status: 'done', optimizedCv: { name: 'search-cv' } } as never] });
        useAppStore.setState({ jobHistory: [rec({ id: 'rec-1', jobUrl: 'https://co.com/x', jobTitle: 'Backend Eng', optimizedCv: { name: 'tailored' } as never })] });
        useAppStore.getState().loadJobRecordIntoWizard('rec-1');
        const st = useAppStore.getState();
        expect(st.jdEntries).toHaveLength(1);                     // search entry replaced
        expect(st.jdEntries[0].id).toBe('history-rec-1');
        expect(st.jdEntries[0].optimizedCv).toEqual({ name: 'tailored' });
        expect(st.selectedJdId).toBe('history-rec-1');
        expect(st.currentStep).toBe(3);
        expect(st.view).toBe('apply');
    });

    it('is a no-op for an unknown record id', () => {
        useAppStore.getState().loadJobRecordIntoWizard('does-not-exist');
        expect(useAppStore.getState().currentStep).not.toBe(3);
    });
});

describe('attachCvToJobRecord persists the tailored CV', () => {
    it('updates the matching record (by jobUrl) in cache + backend', async () => {
        useAppStore.getState().addJobRecord(rec({ id: 'c1', jobUrl: 'https://co.com/job', jobTitle: 'X' }));
        await flush();
        const id = useAppStore.getState().jobHistory[0].id; // server id after swap
        const cv = { name: 'tailored A' } as never;
        useAppStore.getState().attachCvToJobRecord('https://co.com/job', cv);
        await flush();
        expect(useAppStore.getState().jobHistory[0].optimizedCv).toEqual(cv);
        expect(account.updateApplicationCv).toHaveBeenCalledWith(id, cv);
        expect(backend.rows[0].tailored_cv).toEqual(cv);
    });

    it('ignores a jobUrl with no matching record', () => {
        useAppStore.setState({ jobHistory: [] });
        useAppStore.getState().attachCvToJobRecord('https://nope.com', { name: 'x' } as never);
        expect(account.updateApplicationCv).not.toHaveBeenCalled();
    });
});

describe('END-TO-END: score → optimize → new session → reopen', () => {
    it('a tailored CV saved on a job survives a reload and shows on reopen', async () => {
        const url = 'https://acme.com/jobs/se';

        // 1. Search flow scores the job → record created (no CV yet), like StepInputUrl.
        useAppStore.getState().addJobRecord(rec({ id: 'job-xyz', jobUrl: url, jobTitle: 'SE', status: 'saved' }));
        await flush();
        expect(backend.rows).toHaveLength(1);
        expect(backend.rows[0].tailored_cv ?? null).toBeNull();

        // 2. Auto-optimize completes → attachCvToJobRecord (same jobUrl).
        const cv = { name: 'Tailored SE' } as never;
        useAppStore.getState().attachCvToJobRecord(url, cv);
        await flush();
        expect(backend.rows[0].tailored_cv).toEqual(cv);     // persisted to backend

        // 3. NEW SESSION: cache is empty, hydrate from the backend.
        useAppStore.setState({ jobHistory: [], jdEntries: [], selectedJdId: null, currentStep: 1 });
        await useAppStore.getState().loadJobHistory();
        const hist = useAppStore.getState().jobHistory;
        expect(hist).toHaveLength(1);
        expect(hist[0].optimizedCv).toEqual(cv);             // CV survived the round-trip

        // 4. Reopen from history → editor gets a single entry WITH the CV.
        useAppStore.getState().loadJobRecordIntoWizard(hist[0].id);
        const st = useAppStore.getState();
        expect(st.currentStep).toBe(3);
        expect(st.jdEntries).toHaveLength(1);
        expect(st.selectedJdId).toBe(`history-${hist[0].id}`);
        // The editor renders sortedEntries = entries WITH optimizedCv — non-empty here.
        expect(st.jdEntries.filter((e) => e.optimizedCv)).toHaveLength(1);
    });

    it('create-race: optimize fires before the create POST resolves, CV still persists', async () => {
        const url = 'https://acme.com/jobs/race';
        useAppStore.getState().addJobRecord(rec({ id: 'job-race', jobUrl: url }));
        // intentionally NOT flushing — the create POST is still in flight
        const cv = { name: 'Race CV' } as never;
        useAppStore.getState().attachCvToJobRecord(url, cv);
        // cache updated immediately; backend not yet (id still client-side)
        expect(useAppStore.getState().jobHistory[0].optimizedCv).toEqual(cv);

        await flush(); // create resolves → re-persists the pending CV
        expect(backend.rows[0].tailored_cv).toEqual(cv);
        expect(useAppStore.getState().jobHistory[0].optimizedCv).toEqual(cv);
    });
});
