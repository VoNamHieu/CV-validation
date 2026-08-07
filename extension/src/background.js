/**
 * Copo — Auto Apply Extension — Background Service Worker
 * Handles: single apply, batch apply queue, extension communication
 */

import { mvpApply, readForm, reconcileSubmission } from './workday-api.js';
import { tenantRefFor, sortJobsByTenant } from './ats/tenant.js';
import { BLOCKING_STATES } from './ats/states.js';
import * as atsBackend from './ats/backend.js';
import * as atsCoord from './ats/coordinator.js';
import { FIXTURE_CREDS_SUPPORTED as fixtureCredsSupported, initFixture, readFixtureCredential } from './fixtures/dummy.js';

// Seeds a fake candidate in `npm run build:test` bundles, and does nothing at all
// in a normal one — build.mjs resolves this import to fixtures/noop.js, so there
// is no flag to read and no branch to get wrong. Called on every worker wake
// rather than on install: MV3 recycles the worker constantly, and a seed that ran
// once would miss storage cleared in between. It no-ops when the slots are
// already filled, so repeating it costs one read.
initFixture();

/**
 * Drive ONE wizard page from the service-worker console.
 *
 *   copoStep()                  fill the step on screen, stop
 *   copoStep({fill:false})      only report what the agent sees, touch nothing
 *   copoStep({advance:true})    fill, then click Next once
 *
 * Testing a single step through the whole flow costs a login, an upload and two
 * or three pages before reaching it — paid again for every fix, and the failure
 * arrives buried in three pages of unrelated trace. This runs the step where it
 * already is.
 *
 * It cannot submit: the advance goes through the same policy choke point as the
 * agent's own click, which refuses the review step and the submit control.
 *
 * Lives here rather than on the page because this is the console already open for
 * copoFixture, and a content script's globals are not reachable from the page
 * console without switching execution context.
 */
/**
 * The tab the user means.
 *
 * NOT `currentWindow` — called from the service-worker console, the "current
 * window" IS the DevTools window, which owns no tabs, so the query comes back
 * empty every time. Ask the browser for its normal windows instead and take the
 * active tab, preferring one the agent can actually run on.
 */
/** Incoming profile wins per key; keys only the EXTENSION holds (a console-
 *  injected gpa, an ethnicity the web app doesn't ship yet) survive every
 *  sync and every run trigger. These writes used to replace the WHOLE object,
 *  which silently erased a storage injection the moment a run started from
 *  the app — a debugging mystery that cost several rounds. */
async function mergedProfile(incoming) {
    const { jobfitProfile } = await chrome.storage.local.get('jobfitProfile');
    const merged = { ...(jobfitProfile || {}) };
    for (const [k, v] of Object.entries(incoming || {})) {
        // An EMPTY incoming value must not erase a real one we hold: the app
        // sends '' for every profile field its user left blank, which would
        // wipe an injected addressStreet on every run trigger. Empty only
        // lands when we hold nothing at all.
        if ((v === '' || v === null || v === undefined) && (k in merged) && merged[k] !== '' && merged[k] != null) continue;
        merged[k] = v;
    }
    return merged;
}

async function debugTargetTab(tabId) {
    if (tabId) return await chrome.tabs.get(tabId).catch(() => null);
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }).catch(() => []);
    const active = wins.flatMap(w => (w.tabs || []).filter(t => t.active).map(t => ({ t, focused: w.focused })));
    if (!active.length) return null;
    // A tab the agent is injected into beats whichever window happens to be focused.
    const applyable = active.filter(({ t }) => /myworkdayjobs|myworkdaysite|smartrecruiters/i.test(t.url || ''));
    const pool = applyable.length ? applyable : active;
    return (pool.find(x => x.focused) || pool[0]).t;
}

/** List the tabs copoStep could target, so an ambiguous case is visible. */
self.copoTabs = async () => {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }).catch(() => []);
    const rows = wins.flatMap(w => (w.tabs || []).map(t => ({
        tabId: t.id, active: t.active, focusedWindow: w.focused, url: (t.url || '').slice(0, 90),
    })));
    console.table(rows);
    return rows;
};

self.copoStep = async (opts = {}) => {
    const tab = await debugTargetTab(opts.tabId);
    if (!tab?.id) {
        console.warn('[Copo] no candidate tab — run copoTabs() to see what is open, '
            + 'then copoStep({tabId: <id>}).');
        return null;
    }
    try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'AGENT_TEST_STEP', opts });
        console.log(`[Copo] step on tab ${tab.id} →`, r);
        return r;
    } catch (e) {
        // The usual cause, and it has its own fix: no content script in that tab.
        console.warn(`[Copo] no agent in tab ${tab.id} (${(tab.url || '').slice(0, 60)}) — `
            + 'reload that page (F5) and retry.', e?.message);
        return null;
    }
};

// Dev triggers (run in the service-worker console against your live session):
//   copoWdApi('<apply url>')        — create/fill an application (uses jobfitProfile)
//   copoWdReadForm('<apply url>')   — dump the WHOLE form (all sections + questionnaire)
//   copoWdReadForm('<apply url>', '<existing appId>')  — read an existing application
self.copoWdApi = async (jobUrl) => {
    const { jobfitProfile, cvFileBase64, cvFileName } = await chrome.storage.local.get(['jobfitProfile', 'cvFileBase64', 'cvFileName']);
    const cv = cvFileBase64 ? { base64: cvFileBase64, fileName: cvFileName } : null;
    const report = await mvpApply(jobUrl, jobfitProfile || {}, cv);
    console.log('[Copo WD-API] report:', JSON.stringify(report, null, 2));
    return report;
};
self.copoWdReadForm = async (jobUrl, appId) => {
    const form = await readForm(jobUrl, appId ? { appId } : {});
    console.log('[Copo WD-API] FORM:', JSON.stringify(form, null, 2));
    return form;
};

// ─── Job Queue State ───
let applyQueue = [];       // [{jobUrl, profile, jobTitle, company}, ...]
let currentJobIndex = -1;
let currentTabId = null;
let isProcessing = false;
let jobSafetyTimer = null;  // per-job watchdog handle, re-armed by agent heartbeats
let jobStartedAt = 0;       // when the current job's tab was opened
// Union of the field gaps every job in this batch reported.
const batchFieldGaps = new Map();
const TAB_DELAY_MS = 3000; // Delay between opening tabs

// Watchdog window. One agent iteration can legitimately take a minute+ (LLM
// call up to 30s, scroll passes, post-action waits), so a fixed short timeout
// would kill healthy jobs. The agent sends AUTO_APPLY_HEARTBEAT every
// iteration; the timer only fires if the page goes silent for a full window.
const JOB_SAFETY_WINDOW_MS = 120000;
// Absolute ceiling per job — heartbeats stop extending past this point so a
// looping page can't hold the queue hostage.
const JOB_HARD_CAP_MS = 15 * 60 * 1000;

// Last sign of life from the driven page. Persisted (not just held in memory)
// because it is the only evidence the watchdog has after a worker restart.
let lastHeartbeatAt = 0;

/** User-facing wording per block reason — mirrors the content agent's copy. */
const ATS_BLOCK_DETAIL = {
    verification: 'Chờ bạn xác minh email của công ty này',
    credential: 'Cần thông tin đăng nhập riêng cho công ty này',
    manual: 'Cần bạn xử lý trực tiếp trên trang này',
};

// Which credential we handed out per tenant this batch, so the auth result can
// pin it — that pin is what keeps the tenant working after a password rotation.
// Declared up here with the rest of the durable state: `adoptPersistedState`
// rehydrates it on worker wake, so it must not sit below that function's use.
const pendingAtsCredential = {};

// Tenants whose credential came from the fixture rather than the backend.
// Deliberately NOT persisted: it exists only to stop the auth result being
// reported for an account the backend has no row for, and a worker recycled
// mid-attempt loses nothing that matters — the report would be rejected anyway.
// Always empty in production, where readFixtureCredential returns null.
const fixtureServedTenants = new Set();

// ─── Restore in-flight state on service-worker wake (MV3 kills idle SWs) ───
const RESTORE_KEYS = [
    'applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt',
    'lastHeartbeatAt', 'applySession', 'atsRuntime',
];

/** Pull persisted batch state back into memory. Safe to call repeatedly: it only
 *  adopts state when a batch is genuinely in flight. */
function adoptPersistedState(data) {
    if (!data?.isProcessing || !Array.isArray(data.applyQueue) || data.applyQueue.length === 0) return false;

    // A batch nobody ended is not a batch still running. `isProcessing` survives
    // a worker kill, a closed tab and an extension reload, so without a staleness
    // check the state below is adopted forever — and the part of it that hurts is
    // the attempt budget, which then refuses to log into that company again with
    // a message about attempts made hours ago. No single job can outlive the hard
    // cap, so a last sign of life older than that means the batch is dead.
    const alive = Math.max(data.lastHeartbeatAt || 0, data.jobStartedAt || 0);
    if (alive && Date.now() - alive > JOB_HARD_CAP_MS) {
        console.warn('[Copo] discarding a batch that went silent '
            + `${Math.round((Date.now() - alive) / 60000)} min ago — its attempt budget dies with it`);
        chrome.storage.local.remove(RESTORE_KEYS);
        atsCoord.endBatch();
        return false;
    }

    applyQueue = data.applyQueue;
    isProcessing = data.isProcessing;
    currentJobIndex = typeof data.currentJobIndex === 'number' ? data.currentJobIndex : -1;
    currentTabId = data.currentTabId ?? null;
    jobStartedAt = typeof data.jobStartedAt === 'number' ? data.jobStartedAt : Date.now();
    lastHeartbeatAt = typeof data.lastHeartbeatAt === 'number' ? data.lastHeartbeatAt : 0;
    applySessionId = data.applySession?.sessionId ?? null;
    applyTabId = data.applySession?.tabId ?? applyTabId;
    // Per-tenant verdicts + the attempt budget. Losing these was not a cosmetic
    // regression: a tenant already waiting on the user read as `unknown` again,
    // so the runner re-probed it and spent another signup/login against an
    // account that may be counting failures. See ATS_AUTH_REQUEST, which now also
    // refuses on the server's own verdict as a second line of defence.
    if (data.atsRuntime?.coord) atsCoord.restore(data.atsRuntime.coord);
    if (data.atsRuntime?.pendingCredential) {
        Object.assign(pendingAtsCredential, data.atsRuntime.pendingCredential);
    }
    return true;
}

chrome.storage.local.get(RESTORE_KEYS, (data) => {
    if (adoptPersistedState(data)) {
        console.log('[Copo] SW woke — restored batch state:', {
            queue: applyQueue.length, currentJobIndex, currentTabId,
            tenants: Object.keys(data.atsRuntime?.coord?.tenantStates || {}).length,
        });
        // The timer died with the old SW. Re-arm it so a tab that crashed
        // while we slept can't leave the queue stuck forever.
        if (currentJobIndex >= 0 && applyQueue[currentJobIndex]?.status === 'processing') {
            armJobSafetyTimer(currentJobIndex);
        }
    }
});

function persistState() {
    chrome.storage.local.set({
        applyQueue, isProcessing, currentJobIndex, currentTabId, jobStartedAt, lastHeartbeatAt,
    });
}

/**
 * End the batch and leave nothing running. THE single path out of a batch —
 * user cancel, out of credit, expired token, queue exhausted.
 *
 * Each of those used to unwind by hand, and each forgot something different: the
 * credit path left the watchdog armed and the apply session live, cancel left the
 * ATS runtime behind, completion left the pending flags. What survives is not
 * cosmetic — a live `pendingAutoApply` fires the agent on the next job page the
 * user opens, and a stale alarm wakes the worker to police a batch that ended.
 */
function abortBatch(reason, { keepQueue = true } = {}) {
    console.log(`[Copo] Batch Apply: ending — ${reason}`);
    if (batchFieldGaps.size) {
        const gaps = [...batchFieldGaps.values()];
        console.log('[Copo] field gaps this batch:', gaps.map(g => g.key || g.label).join(', '));
        pushToWebApp({ type: 'JOBFIT_FIELD_GAPS', gaps, reason });
    }
    batchFieldGaps.clear();
    isProcessing = false;
    currentTabId = null;
    currentJobIndex = keepQueue ? currentJobIndex : -1;
    if (!keepQueue) applyQueue = [];
    clearJobSafetyTimer();
    atsCoord.endBatch();
    endApplySession();
    chrome.storage.local.remove([
        'pendingAutoApply', 'autoApplyJobUrl', 'batchMode', 'atsRuntime', 'lastHeartbeatAt',
        ...(keepQueue ? [] : ['applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt']),
    ]);
    if (keepQueue) persistState();   // keep the terminal per-job rows for the UI
    broadcastProgress();
}

/** Persist the ATS coordinator's runtime so a recycled worker doesn't hand a
 *  blocked tenant a fresh attempt budget. */
function persistAtsRuntime() {
    chrome.storage.local.set({
        atsRuntime: { coord: atsCoord.snapshot(), pendingCredential: pendingAtsCredential },
    });
}

// ─── Per-job watchdog ───
// Two layers, because neither is sufficient alone:
//   · setTimeout — precise, but dies with the service worker.
//   · chrome.alarms — survives the worker and wakes it, but is coarse.
// The gap the alarm closes is real and reachable: if the content script dies
// before its FIRST heartbeat (an import error, a PDF/404 shell, a hostile CSP),
// nothing ever messages the worker again, the worker goes idle, its setTimeout
// dies with it, and the batch sits on "đang xử lý" forever with no way out.
const JOB_ALARM = 'copo-job-watchdog';

function armJobSafetyTimer(timedJobIndex) {
    if (jobSafetyTimer) clearTimeout(jobSafetyTimer);
    jobSafetyTimer = setTimeout(() => failStalledJob(timedJobIndex), JOB_SAFETY_WINDOW_MS);
    // Slightly longer than the in-memory timer so the precise one wins when the
    // worker is alive, and the alarm is only ever the fallback.
    chrome.alarms.create(JOB_ALARM, { delayInMinutes: (JOB_SAFETY_WINDOW_MS * 1.25) / 60000 });
}

function clearJobSafetyTimer() {
    if (jobSafetyTimer) { clearTimeout(jobSafetyTimer); jobSafetyTimer = null; }
    chrome.alarms.clear(JOB_ALARM);
}

/**
 * Stop the abandoned run's agent and close its tab. Every driven tab was
 * created by this worker (tabs.create), so closing is ours to do.
 *
 * Leaving it alive was measured 2026-08-07: the watchdog moved the queue on,
 * the orphan agent kept driving its now-hidden tab for 11 more minutes —
 * burning LLM calls, its clicks misread as no-effect under tab throttling,
 * its final result refused as 'stale tab'. An abandoned job must END.
 */
function stopDrivenTab(tabId, why) {
    if (tabId == null) return;
    try {
        chrome.tabs.sendMessage(tabId, { type: 'AGENT_STOP', why }, () => void chrome.runtime.lastError);
    } catch { /* tab already gone */ }
    // A beat for the stop to land and the agent to trace it before the
    // document dies with the tab.
    setTimeout(() => {
        try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); } catch { /* gone */ }
    }, 400);
}

/** Give up on the job at `idx` and move the queue along. */
function failStalledJob(idx, detail = 'Timeout — page did not respond') {
    if (!isProcessing || idx !== currentJobIndex) return;
    if (applyQueue[idx]?.status !== 'processing') return;
    console.warn(`[Copo] Batch Apply: timeout for job ${idx + 1}, skipping`);
    applyQueue[idx].status = 'error';
    applyQueue[idx].result = { success: false, detail };
    stopDrivenTab(currentTabId, detail);
    endApplySession();   // retire the dead run's CV + profile keys
    persistState();
    broadcastProgress();
    processNextJob();
}

// Alarm path: the worker may have just been woken by this very alarm, so read
// the persisted state rather than trusting whatever is (not) in memory.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== JOB_ALARM) return;
    chrome.storage.local.get(RESTORE_KEYS, (data) => {
        if (!data.isProcessing) { chrome.alarms.clear(JOB_ALARM); return; }
        adoptPersistedState(data);
        const idx = currentJobIndex;
        if (idx < 0 || applyQueue[idx]?.status !== 'processing') return;
        const alive = Math.max(lastHeartbeatAt || 0, jobStartedAt || 0);
        if (Date.now() - alive < JOB_SAFETY_WINDOW_MS) {
            armJobSafetyTimer(idx);   // still working — re-arm and keep watching
            return;
        }
        failStalledJob(idx, 'Timeout — trang không phản hồi');
    });
});

// ─── Optional host-permission gating ───────────────────────────────────────
// The manifest ships a NARROW host_permissions allowlist (known job boards +
// ATS platforms) so the install-time warning reads "đọc dữ liệu trên các trang
// tuyển dụng đã biết" instead of "…mọi trang web". Any other site is covered
// by optional_host_permissions ("https://*/*") and must be granted just-in-time.
//
// Known hosts get the content-agent via the declarative content_scripts entry.
// On a freshly granted UNKNOWN host there's no declarative match, so we inject
// the agent programmatically (chrome.scripting) after the tab loads.

// Mirror of manifest content_scripts.matches — these auto-inject, no grant needed.
const KNOWN_HOST_RE = /(^|\.)(topcv\.vn|vietnamworks\.com|itviec\.com|careerbuilder\.vn|careerlink\.vn|careerviet\.vn|vieclam24h\.vn|linkedin\.com|lever\.co|greenhouse\.io|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|breezy\.hr|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com)$/i;

function originPattern(url) {
    try { return `${new URL(url).origin}/*`; } catch (e) { return null; }
}
function isKnownHost(url) {
    try { return KNOWN_HOST_RE.test(new URL(url).hostname); } catch (e) { return false; }
}

// Ensure the agent is allowed to run on `url`. Known hosts: always. Unknown
// hosts: check the optional grant and, if missing, request it just-in-time with
// a clear reason. NOTE: chrome.permissions.request() needs a user gesture; mid-
// batch in the service worker that gesture is usually absent, so the request is
// best-effort — if it rejects, the job is skipped with a "needs permission"
// result and the user can grant it from the popup ("Cho phép trên trang này").
async function ensureHostAccess(url) {
    if (isKnownHost(url)) return { ok: true, known: true };
    const pattern = originPattern(url);
    if (!pattern) return { ok: false, known: false };
    const has = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
    if (has) return { ok: true, known: false };
    try {
        // "Trang này dùng hệ thống tuyển dụng chưa nhận diện — Copo cần quyền
        //  truy cập để điền form tự động." (the Chrome dialog shows the origin)
        const granted = await chrome.permissions.request({ origins: [pattern] });
        return { ok: granted, known: false };
    } catch (e) {
        return { ok: false, known: false, gestureRequired: true };
    }
}

// (Agent injection for granted UNKNOWN hosts is handled per apply-session by the
// webNavigation.onCompleted → ensureAgentInjected path below, which also covers
// redirect targets — a one-shot on-load inject couldn't.)

// ─── Credit metering ────────────────────────────────────────────────────────
// Charge the user for an LLM-backed action via the web app's /api/credits/spend
// (server prices the action; we just name it). Auth = the JWT the web app synced
// into storage (jobfitToken). Returns:
//   { ok: true }                        — charged, proceed
//   { ok: false, insufficient: true }   — out of credits (HTTP 402)
//   { ok: false, auth: true }           — no/expired token (re-sync from web app)
//   { ok: false }                       — transient/other (fail-open: don't block)
async function extSpend(action, units = 1) {
    const { jobfitAppUrl, jobfitToken } = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
    if (!jobfitToken) return { ok: false, auth: true };
    const appUrl = jobfitAppUrl || 'https://copoai.net';
    try {
        const res = await fetch(`${appUrl}/api/credits/spend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jobfitToken}` },
            body: JSON.stringify({ action, units }),
        });
        if (res.ok) return { ok: true };
        if (res.status === 402) return { ok: false, insufficient: true };
        if (res.status === 401) return { ok: false, auth: true };
        return { ok: false }; // unexpected — fail open so a billing hiccup can't block applies
    } catch (e) {
        console.warn('[Copo] credit spend failed (fail-open):', e?.message || e);
        return { ok: false }; // network error — fail open
    }
}

// ─── Apply-session: follow the flow across full-page redirects / new tabs ────
// One "apply" is rarely one page. Clicking Apply frequently does a full-page
// redirect to another ATS domain, or opens the form in a NEW tab — and a content
// script's JS context dies on a full navigation, so runAgentLoop can't just
// "continue". We instead keep the driven tab under a lightweight session:
// pendingAutoApply stays set (the re-injected agent RESUMES the fill), we cap the
// redirect chain, adopt a spawned tab, and re-inject on granted unknown hosts.
// Known ATS targets re-inject declaratively (manifest content_scripts), so this
// works out of the box for job-page → known-ATS redirects.
const APPLY_MAX_HOPS = 6;   // initial job page + up to ~5 redirects before we bail
let applyTabId = null;
let applyHops = 0;
let applySessionId = null;

// Per-job documents are SESSION-SCOPED, not global. The tailored CV belongs to
// one job at one company: writing it to a shared `cvFileBase64` meant the next
// job in the batch — one that carries no CV of its own — silently inherited the
// previous company's tailored document and uploaded it. That is the worst class
// of bug this agent can have, because it succeeds: the wrong PDF reaches a real
// employer and nothing reports a failure.
//
// So `run:<runId>:cv` holds a job's own CV and dies with the run.
//
// Note what the global `cvFileBase64` actually is, because the name suggests
// otherwise: it is NOT a generic CV. The web app's buildCvPdfCache pushes
// whichever job was optimised most recently into it (that job's title is even in
// the filename), so it is only meaningful for an apply that has no session of its
// own — the floating button on a page the user opened. A driven apply must never
// fall back to it; doing so re-creates the leak above one hop removed. See
// loadSessionCv in the content agent.
// Per-run keys live under one prefix — `run:<runId>:cv`, `run:<runId>:profile` —
// so everything a run owns can be retired (or swept) by prefix. The runId IS the
// sessionId; two names for one identity would just be a bug factory.
const RUN_PREFIX = 'run:';
const LEGACY_CV_PREFIX = 'applyCv:';   // pre-runId key, still swept

function newSessionId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function runKey(runId, part) { return `${RUN_PREFIX}${runId}:${part}`; }
function sessionCvKey(sessionId) { return runKey(sessionId, 'cv'); }
function sessionProfileKey(sessionId) { return runKey(sessionId, 'profile'); }

/**
 * Build the storage fragment that OPENS a session. Returned rather than written
 * so the caller can persist it in the SAME set() as the rest of the job's state,
 * before the tab exists — the content script reads this during its first paint,
 * so a write that races the tab creation reads as "no CV".
 */
function prepareApplySession(jobUrl, cv, opts = {}) {
    const sessionId = newSessionId();
    let jobHost = '';
    try { jobHost = new URL(jobUrl).hostname; } catch (e) { }
    const fragment = {
        applySession: {
            // runId === sessionId: the run's identity, stamped into every trace
            // line the content agent writes for this job.
            sessionId, runId: sessionId, tabId: null, jobHost, startedAt: Date.now(),
            // Did the user grant the agent permission to accept a company's
        },
    };
    if (cv?.base64 && cv?.fileName) {
        fragment[sessionCvKey(sessionId)] = { base64: cv.base64, fileName: cv.fileName };
    }
    // The profile SNAPSHOT this run fills from. The global jobfitProfile stays
    // (the ⚡ button and profile sync read it), but a driven run must not pick
    // up whatever a LATER start wrote there — the 2026-08-07 double-run had the
    // second job's profile write racing the first job's fills.
    if (opts.profile) {
        fragment[sessionProfileKey(sessionId)] = opts.profile;
    }
    return { sessionId, fragment };
}

/** Bind the freshly-created tab to the session prepared above, and retire the
 *  previous job's document. Removing the predecessor by key is O(1); enumerating
 *  storage to find it would mean deserializing every CV blob in it, once per job. */
function adoptApplySession(sessionId, tabId) {
    const previous = applySessionId;
    applySessionId = sessionId;
    applyTabId = tabId;
    applyHops = 0;
    if (previous && previous !== sessionId) {
        chrome.storage.local.remove([sessionCvKey(previous), sessionProfileKey(previous)]);
    }
    chrome.storage.local.get('applySession', (d) => {
        if (d.applySession?.sessionId === sessionId) {
            chrome.storage.local.set({ applySession: { ...d.applySession, tabId } });
        }
    });
}

function endApplySession() {
    const stale = applySessionId;
    applyTabId = null;
    applyHops = 0;
    applySessionId = null;
    const keys = ['applySession'];
    if (stale) keys.push(sessionCvKey(stale), sessionProfileKey(stale));
    chrome.storage.local.remove(keys, () => sweepSessionCvs());
}

/**
 * Drop every session CV blob left behind by a crash or a recycled worker.
 *
 * Only runs at a BATCH boundary, not per job: chrome.storage exposes no
 * keys-only read, so enumerating means deserializing every value in storage —
 * including the multi-megabyte base64 PDFs this is trying to clean up. The
 * per-job case is handled by `adoptApplySession`, which knows the previous key
 * outright.
 */
function sweepSessionCvs() {
    chrome.storage.local.get(null, (all) => {
        // NEVER the live session's blob. This swept every applyCv:* including
        // the one the web app had JUST synced for the tab being opened — the
        // agent then fell back to the stale global PDF and uploaded the wrong
        // document to a real application.
        const liveSid = all.applySession?.sessionId || null;
        const livePrefix = liveSid ? `${RUN_PREFIX}${liveSid}:` : null;
        const dead = Object.keys(all).filter((k) =>
            (k.startsWith(RUN_PREFIX) && !(livePrefix && k.startsWith(livePrefix)))
            || k.startsWith(LEGACY_CV_PREFIX));   // pre-runId builds left these
        if (dead.length) {
            chrome.storage.local.remove(dead);
            console.log(`[Copo] run-key sweep: removed ${dead.length} key(s)`);
        }
    });
}

// Ensure the agent is present on a (possibly redirected) apply page. Skip KNOWN
// hosts — they inject content-agent.js declaratively, and re-executing that file
// into a document that already has it throws ("Identifier already declared").
// Unknown hosts have no declarative match, so inject once, guarded by a page flag
// so a repeat onCompleted can't double-run it.
async function ensureAgentInjected(tabId, url) {
    if (isKnownHost(url)) return;
    const access = await ensureHostAccess(url);
    if (!access.ok) return;   // host not granted mid-flow (no gesture) → can't drive it
    try {
        const [{ result: already }] = await chrome.scripting.executeScript({
            target: { tabId }, func: () => !!window.__copoAgentInjected,
        });
        if (already) return;
        await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__copoAgentInjected = true; } });
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => { });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-agent.js'] });
    } catch (e) {
        console.warn('[Copo] ensureAgentInjected failed:', e?.message || e);
    }
}

// Bound the redirect chain — a bounce loop or a redirect to an unrelated page
// must not keep the agent running forever.
chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || d.tabId !== applyTabId) return;
    applyHops++;
    if (applyHops > APPLY_MAX_HOPS) {
        console.warn(`[Copo] apply: redirect chain > ${APPLY_MAX_HOPS} hops — aborting session`);
        chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl']);
        stopDrivenTab(d.tabId, 'Chuỗi redirect quá dài');
        if (isProcessing && currentJobIndex >= 0 && currentJobIndex < applyQueue.length) {
            applyQueue[currentJobIndex].status = 'error';
            applyQueue[currentJobIndex].result = { success: false, detail: 'Chuỗi redirect quá dài — bỏ qua job này.' };
            persistState(); broadcastProgress();
            endApplySession();
            setTimeout(() => processNextJob(), TAB_DELAY_MS);
        } else {
            endApplySession();
        }
    }
});

// After each full page load on the apply tab, make sure the agent is running —
// pendingAutoApply is still set, so it resumes the fill on the redirect target.
chrome.webNavigation.onCompleted.addListener((d) => {
    if (d.frameId !== 0 || d.tabId !== applyTabId) return;
    ensureAgentInjected(d.tabId, d.url);
});

// Apply opened the form in a NEW tab (target=_blank). Adopt it as the tab we
// drive so redirect-following + batch result routing track the real form tab.
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
    if (d.sourceTabId !== applyTabId) return;
    console.log('[Copo] apply: adopting spawned tab', d.tabId, 'from', d.sourceTabId);
    applyTabId = d.tabId;
    if (isProcessing) currentTabId = d.tabId;   // keep AUTO_APPLY_RESULT routing correct
    jobStartedAt = Date.now();
    // Keep the persisted session tab id in sync so the content agent's tab-scope
    // check (IS_APPLY_TAB) still recognizes this tab if the service worker restarts.
    chrome.storage.local.get('applySession', (s) => {
        if (s.applySession) chrome.storage.local.set({ applySession: { ...s.applySession, tabId: d.tabId } });
    });
    // known host → declarative agent resumes; unknown → onCompleted injects.
});

// Driven tab closed by the user → the run is over NOW.
// · Batch: fail the job immediately and move on. Waiting for the 120s watchdog
//   here just held the queue on a tab that no longer exists.
// · Single: clear the stale pending flag so it can't auto-fire on the next job
//   page the user opens.
chrome.tabs.onRemoved.addListener((tabId) => {
    if (isProcessing && tabId === currentTabId
        && applyQueue[currentJobIndex]?.status === 'processing') {
        failStalledJob(currentJobIndex, 'Tab bị đóng giữa chừng');
        return;
    }
    if (tabId === applyTabId && !isProcessing) {
        chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl']);
        endApplySession();
    }
});

// ─── Single auto-apply (shared by relay + external paths) ───
function handleAutoApplyStart(message, sendResponse) {
    const { jobUrl, profile } = message;
    if (!jobUrl || !profile) {
        sendResponse({ success: false, error: 'Missing jobUrl or profile' });
        return true;
    }
    // A single apply mid-batch would overwrite jobfitProfile/pendingAutoApply
    // in storage and corrupt the job the batch is currently driving.
    if (isProcessing) {
        sendResponse({ success: false, error: 'Batch apply đang chạy — hãy chờ xong hoặc hủy batch trước.' });
        return true;
    }
    // Per-job CV file from the web app (rendered at Optimize time) so the agent
    // can satisfy required file-upload fields on single applies too. It rides in
    // the SESSION, not the global CV slot: this document was tailored for this
    // one job and must not outlive it.
    const jobCv = message.cvFileBase64 && message.cvFileName
        ? { base64: message.cvFileBase64, fileName: message.cvFileName }
        : null;
    (async () => {
        // ONE driven run at a time, across tabs. A second single apply while
        // one is live is the 2026-08-07 double-run exactly: two agents in two
        // tabs, the new tab hides the old one (whose throttled verify windows
        // then misread working clicks as no-effect), and adopting the new
        // session would delete the live run's CV blob mid-flight. The per-page
        // single-flight (_loopLive) cannot see across tabs; this guard can.
        const prior = (await chrome.storage.local.get('applySession')).applySession;
        const priorFresh = prior?.tabId != null
            && Date.now() - (prior.startedAt || 0) < JOB_HARD_CAP_MS;
        if (priorFresh) {
            const alive = await new Promise((r) => {
                chrome.tabs.get(prior.tabId, (t) => r(!chrome.runtime.lastError && !!t));
            });
            if (alive) {
                sendResponse({
                    success: false,
                    error: 'Một job khác đang được ứng tuyển ở tab khác — chờ nó xong hoặc đóng tab đó rồi thử lại.',
                });
                return;
            }
            // The tab is gone → that run is dead, whatever the flags say.
            endApplySession();
        }
        // MERGE, never clobber: the app's payload wins per key, but keys
        // only the extension holds (a console-injected gpa, an ethnicity
        // the web app doesn't ship yet) must survive the trigger — this
        // write used to erase them the moment a run started from the app.
        const merged = await mergedProfile(profile);
        const { sessionId, fragment } = prepareApplySession(jobUrl, jobCv, { profile: merged });
        const storage = {
            jobfitProfile: merged,
            pendingAutoApply: true,
            autoApplyJobUrl: jobUrl,
            batchMode: false,   // don't inherit a stale batchMode from a prior batch
            ...fragment,
        };
        const access = await ensureHostAccess(jobUrl);
        if (!access.ok) {
            sendResponse({ success: false, error: 'Cần cấp quyền truy cập trang này. Mở popup Copo để cho phép.' });
            return;
        }
        // Per-job flat fee (covers all the agent-plan + map-form LLM calls).
        const charge = await extSpend('auto_apply');
        if (charge.insufficient) {
            sendResponse({ success: false, error: 'Không đủ credit để ứng tuyển. Nạp thêm tại Copo.' });
            return;
        }
        if (charge.auth) {
            sendResponse({ success: false, error: 'Phiên đăng nhập đã hết hạn — mở copoai.net (đang đăng nhập) là token tự làm mới; KHÔNG cần đồng bộ CV.' });
            return;
        }
        chrome.storage.local.set(storage, () => {
            chrome.tabs.create({ url: jobUrl, active: true }, (tab) => {
                adoptApplySession(sessionId, tab.id);  // follow redirects/new-tabs; onCompleted injects unknown hosts
                console.log('[Copo] Auto Apply: opened tab', tab.id, 'for', jobUrl);
                sendResponse({ success: true, tabId: tab.id });
            });
        });
    })();
    return true;
}

// ─── Listen for external messages from Copo web app ───
// NOTE: only reachable if the manifest declares externally_connectable.
// The supported path is the content-webapp.js relay → onMessage below.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'JOBFIT_EXPORT_PROFILE') {
        const syncedAt = Date.now();
        chrome.storage.local.set(
            { jobfitProfile: message.profile, jobfitProfileSyncedAt: syncedAt },
            () => {
                sendResponse({ success: true, syncedAt });
                chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED', syncedAt }).catch(() => { });
            },
        );
        return true;
    }

    if (message.type === 'AUTO_APPLY_START') {
        return handleAutoApplyStart(message, sendResponse);
    }

    // Ping check
    if (message.type === 'JOBFIT_PING') {
        sendResponse({ success: true, version: chrome.runtime.getManifest().version });
        return true;
    }
});

// ─── Listen for internal messages (content scripts + popup) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Single auto-apply relayed from the web app via content-webapp.js.
    // This used to live ONLY in onMessageExternal, which never fires without
    // externally_connectable in the manifest — so web-app single applies
    // silently went nowhere.
    if (message.type === 'AUTO_APPLY_START') {
        return handleAutoApplyStart(message, sendResponse);
    }

    // ── Profile management ──
    if (message.type === 'GET_PROFILE') {
        chrome.storage.local.get('jobfitProfile', (data) => {
            sendResponse({ profile: data.jobfitProfile || null });
        });
        return true;
    }

    if (message.type === 'SAVE_PROFILE') {
        const syncedAt = Date.now();
        (async () => {
            // Persist the JWT alongside the profile so credit-metered auto-apply /
            // tailor calls can be charged to this user. Only overwrite when present
            // (a profile-only sync without a token shouldn't wipe a good token).
            // The profile itself MERGES (see mergedProfile) — extension-only keys
            // survive a web-app sync instead of vanishing with every F5.
            const toStore = { jobfitProfile: await mergedProfile(message.profile), jobfitProfileSyncedAt: syncedAt };
            if (message.token) toStore.jobfitToken = message.token;
            chrome.storage.local.set(
                toStore,
                () => {
                    sendResponse({ success: true, syncedAt });
                    // Push to popup if open so the "Synced …" line refreshes immediately.
                    chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED', syncedAt }).catch(() => { });
                },
            );
        })();
        return true;
    }

    // Refresh the stored JWT without touching the profile. The web app pushes
    // this on every Supabase auth-state change (incl. the ~hourly token
    // refresh), which keeps the just-in-time ATS credential fetch alive through
    // a long batch — and when the user acts on a blocked tenant hours later.
    if (message.type === 'SAVE_TOKEN') {
        if (!message.token) { sendResponse({ success: false, error: 'No token' }); return true; }
        chrome.storage.local.set({ jobfitToken: message.token },
            () => sendResponse({ success: true }));
        return true;
    }

    // Sync generated CV PDF from the web app into extension storage so the
    // agent can upload it without the user manually using the popup.
    if (message.type === 'SYNC_CV_FILE') {
        const { cvFileBase64, cvFileName } = message;
        if (!cvFileBase64 || !cvFileName) {
            sendResponse({ success: false, error: 'Missing cvFileBase64 or cvFileName' });
            return true;
        }
        chrome.storage.local.set({ cvFileBase64, cvFileName }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'GET_APP_URL') {
        chrome.storage.local.get('jobfitAppUrl', (data) => {
            sendResponse({ url: data.jobfitAppUrl || 'https://copoai.net' });
        });
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── WORKDAY API (MVP) — POST the application straight to Workday's REST API
    // instead of driving the UI. Auth = the user's session cookie + CSRF token
    // (read here via chrome.cookies). Reads jobfitProfile from storage. Never
    // submits — milestone 1 just creates/resumes the app + writes the name.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'WORKDAY_API_MVP') {
        (async () => {
            try {
                const { jobfitProfile, cvFileBase64, cvFileName } = await chrome.storage.local.get(['jobfitProfile', 'cvFileBase64', 'cvFileName']);
                const cv = cvFileBase64 ? { base64: cvFileBase64, fileName: cvFileName } : null;
                const report = await mvpApply(message.jobUrl, jobfitProfile || {}, cv);
                console.log('[Copo WD-API] report:', report);
                sendResponse({ success: true, report });
            } catch (e) {
                console.warn('[Copo WD-API] error:', e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── APPLY RECIPES — per-ATS form recipes for the auto-apply agent ──
    // Public feed (/api/apply-recipes, no auth — recipes carry no user data).
    // Cached in storage for 6h; on a network failure we serve the last cache
    // (even stale) so the agent degrades to the bundled fallback only when it
    // has never fetched. Content script matches the recipe by host itself.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'GET_APPLY_RECIPES') {
        (async () => {
            const CACHE_TTL = 6 * 3600 * 1000;
            try {
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitApplyRecipes']);
                const cached = data.jobfitApplyRecipes;
                if (cached?.recipes?.length && (Date.now() - (cached.fetchedAt || 0) < CACHE_TTL)) {
                    sendResponse({ success: true, data: { version: cached.version, recipes: cached.recipes }, cached: true });
                    return;
                }
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                const res = await fetch(`${appUrl}/api/apply-recipes`, { signal: AbortSignal.timeout(15000) });
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const result = await res.json();
                const recipes = Array.isArray(result?.recipes) ? result.recipes : [];
                if (recipes.length) {
                    chrome.storage.local.set({ jobfitApplyRecipes: { version: result.version, recipes, fetchedAt: Date.now() } });
                }
                sendResponse({ success: true, data: { version: result.version, recipes } });
            } catch (e) {
                const { jobfitApplyRecipes: cached } = await chrome.storage.local.get('jobfitApplyRecipes');
                if (cached?.recipes?.length) {
                    sendResponse({ success: true, data: { version: cached.version, recipes: cached.recipes }, cached: true, stale: true });
                } else {
                    console.warn('[Copo] apply-recipes fetch failed, no cache:', e.message);
                    sendResponse({ success: false, error: e.message });
                }
            }
        })();
        return true; // async response
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — content scripts route AI calls through the background ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'PROXY_LLM_MAP_FORM') {
        const { formFields, profileData } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};

                const urls = [appUrl];

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/map-form`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ formFields, profileData }),
                            signal: AbortSignal.timeout(120000),  // room for slow / thinking model (App Questions big prompt)
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở copoai.net (đang đăng nhập) là token tự làm mới; KHÔNG cần đồng bộ CV.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[Copo] LLM proxy failed for ${baseUrl}:`, e.message);
                    }
                }
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true; // async response
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — Agent Plan (agentic loop brain) ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'PROXY_LLM_AGENT_PLAN') {
        const { pageState, profileData, history, hasCV, credentials } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};

                const urls = [appUrl];

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/agent-plan`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ pageState, profileData, history, hasCV, credentials }),
                            signal: AbortSignal.timeout(120000),  // room for slow / thinking model (App Questions big prompt)
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở copoai.net (đang đăng nhập) là token tự làm mới; KHÔNG cần đồng bộ CV.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[Copo] Agent plan proxy failed for ${baseUrl}:`, e.message);
                    }
                }
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — Message to the hiring team (free-text box) ──
    // ══════════════════════════════════════════════════════════════
    // Reuses the web app's cover-letter route in its 'message' format. Kept as
    // its own proxy rather than folded into agent-plan because the reply is
    // prose the agent types verbatim, not a plan it interprets — and because it
    // bills as its own action, so the cost of writing a note is visible in the
    // ledger instead of hidden inside the per-job auto_apply fee.
    if (message.type === 'PROXY_LLM_APPLY_MESSAGE') {
        const { job, cv, lang } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};
                const res = await fetch(`${appUrl}/api/ai/cover-letter`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify({ cv, jd: job, lang, format: 'message' }),
                    signal: AbortSignal.timeout(120000),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    if (res.status === 401) {
                        throw new Error('Phiên đăng nhập đã hết hạn — mở copoai.net (đang đăng nhập) là token tự làm mới; KHÔNG cần đồng bộ CV.');
                    }
                    throw new Error(err.detail || `API error: ${res.status}`);
                }
                const result = await res.json();
                sendResponse({ success: true, data: result });
            } catch (e) {
                console.warn('[Copo] Apply-message proxy failed:', e.message);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── Strip TEST artifacts out of storage, keep the real data. ──
    //    Testing leaves exactly three things behind that must not ride
    //    into a real application: the local-creds blob (the LOCAL-CREDS
    //    build reads it; production ignores but should not carry it),
    //    and the dummy GPA injected to exercise the grade rule — which
    //    the merge semantics can never clear (empty values do not
    //    clobber, by design). Profile, CV, PDF stay: they are the
    //    user's real data, not test data.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'CLEAR_TEST_DATA') {
        (async () => {
            const removed = [];
            const d = await chrome.storage.local.get(['jobfitApplyCredentials', 'jobfitProfile', 'jobfitCv']);
            if (d.jobfitApplyCredentials) {
                await chrome.storage.local.remove('jobfitApplyCredentials');
                removed.push('jobfitApplyCredentials');
            }
            const patch = {};
            if (d.jobfitProfile?.gpa) {
                patch.jobfitProfile = { ...d.jobfitProfile, gpa: '' };
                removed.push('jobfitProfile.gpa');
            }
            if (d.jobfitCv?.education?.[0]?.gpa) {
                const cv = structuredClone(d.jobfitCv);
                cv.education[0].gpa = '';
                patch.jobfitCv = cv;
                removed.push('jobfitCv.education[0].gpa');
            }
            if (Object.keys(patch).length) await chrome.storage.local.set(patch);
            sendResponse({ success: true, removed });
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── MODE 1 — Sync rich CV JSON (needed for tailoring) ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'SAVE_CV_DATA') {
        if (!message.cv) {
            sendResponse({ success: false, error: 'Missing cv' });
            return true;
        }
        chrome.storage.local.set({ jobfitCv: message.cv, jobfitCvSyncedAt: Date.now() }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── MODE 1 — Tailor CV for the JD on the current job page. ──
    //    Proxies the no-store /api/ai/tailor (the ONLY endpoint that
    //    sees raw board JD). On success: store source_ref → job_url
    //    LOCALLY (the server never learns the URL) and hand the
    //    tailored CV to the web app for rendering.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'MODE1_TAILOR') {
        const M1 = '[Copo Mode1/bg]';
        const { cv, jdText, sourceRef, jobUrl, jobTitle, options } = message;
        console.log(`${M1} received`, {
            hasCv: !!cv, jdChars: jdText?.length || 0, sourceRef,
            jobUrl, options,
        });
        (async () => {
            try {
                if (!cv || !jdText || !sourceRef || !jobUrl) {
                    console.warn(`${M1} ✖ missing fields`, { cv: !!cv, jdText: !!jdText, sourceRef: !!sourceRef, jobUrl: !!jobUrl });
                    sendResponse({ success: false, error: 'Missing cv, jdText, sourceRef, or jobUrl' });
                    return;
                }
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};
                const urls = [appUrl];
                console.log(`${M1} endpoints to try (in order):`, urls);

                // Charge the tailor fee up front (the pipeline is 3 LLM calls).
                const charge = await extSpend('tailor');
                if (charge.insufficient) {
                    sendResponse({ success: false, error: 'Không đủ credit để tối ưu CV. Nạp thêm tại Copo.' });
                    return;
                }
                if (charge.auth) {
                    sendResponse({ success: false, error: 'Phiên đăng nhập hết hạn — mở copoai.net (đang đăng nhập) để token tự làm mới.' });
                    return;
                }

                let lastError = null;
                for (const baseUrl of urls) {
                    const t0 = Date.now();
                    try {
                        console.log(`${M1} → POST ${baseUrl}/api/ai/tailor`);
                        const res = await fetch(`${baseUrl}/api/ai/tailor`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ cv, jd_text: jdText, source_ref: sourceRef, options }),
                            // Pipeline = 3 sequential LLM calls (extract → score → optimize).
                            signal: AbortSignal.timeout(120000),
                        });
                        console.log(`${M1} ← ${baseUrl} status=${res.status} ok=${res.ok} in ${Date.now() - t0}ms`);
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở copoai.net (đang đăng nhập) là token tự làm mới; KHÔNG cần đồng bộ CV.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        console.log(`${M1} ✓ tailor result`, {
                            keys: Object.keys(result || {}),
                            variants: result?.variants?.length ?? 0,
                            score: result?.match?.overall_score,
                        });
                        // source_ref → job_url lives ONLY here, never on the server.
                        const store = await chrome.storage.local.get('mode1RefMap');
                        const map = store.mode1RefMap || {};
                        map[sourceRef] = { jobUrl, at: Date.now() };
                        await chrome.storage.local.set({ mode1RefMap: map });
                        console.log(`${M1} stored sourceRef→jobUrl map (local only)`);
                        // Push the tailored CV to the web-app tab(s) to render
                        // (pushToWebApp logs the Copo-app tab count + warns if none open).
                        // jobUrl + jobTitle ride along so the web app can save the
                        // job to history (client-side only — still never sent to
                        // the server; source_ref stays the apply handle).
                        pushToWebApp({ type: 'JOBFIT_MODE1_RESULT', ...result, jobUrl, jobTitle });
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`${M1} ✖ tailor proxy failed for ${baseUrl} after ${Date.now() - t0}ms:`, e.message);
                    }
                }
                console.error(`${M1} ✖ all endpoints failed:`, lastError?.message);
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                console.error(`${M1} ✖ handler exception:`, e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── MODE 1 — Apply: resolve source_ref → job_url LOCALLY, then
    //    reuse the existing single-apply path. The web app only ever
    //    holds the opaque source_ref.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'MODE1_APPLY') {
        const MA = '[Copo Mode1/apply]';
        // Wrap sendResponse so the final outcome is always logged.
        const reply = (r) => {
            if (r?.success) console.log(`${MA} ✅ apply handed off / started`, r);
            else console.warn(`${MA} ✖ apply failed:`, r?.error, r);
            sendResponse(r);
        };
        (async () => {
            try {
                const { sourceRef } = message;
                console.log(`${MA} received`, {
                    sourceRef,
                    profileInMsg: !!message.profile,
                    cvFile: message.cvFileName || null,
                    cvBytes: message.cvFileBase64?.length || 0,
                });
                const store = await chrome.storage.local.get(['mode1RefMap', 'jobfitProfile']);
                const entry = (store.mode1RefMap || {})[sourceRef];
                if (!entry?.jobUrl) {
                    console.warn(`${MA} ✖ unknown source_ref — not in local ref-map (tailor this job first?)`, {
                        sourceRef, knownRefs: Object.keys(store.mode1RefMap || {}).length,
                    });
                    reply({ success: false, error: 'Unknown source_ref — hãy tailor job này trước.' });
                    return;
                }
                console.log(`${MA} ✓ resolved source_ref → jobUrl (local only)`, {
                    jobUrl: entry.jobUrl,
                    tailoredAt: entry.at ? new Date(entry.at).toISOString() : '?',
                });
                const profile = message.profile || store.jobfitProfile;
                if (!profile) {
                    console.warn(`${MA} ✖ no profile (message + storage both empty) — sync profile first`);
                    reply({ success: false, error: 'Chưa có profile — hãy đồng bộ profile trước.' });
                    return;
                }
                console.log(`${MA} → handleAutoApplyStart (opens tab + runs auto-apply agent)`, {
                    jobUrl: entry.jobUrl,
                    hasCvFile: !!message.cvFileBase64,
                    profileFields: Object.keys(profile || {}).length,
                });
                handleAutoApplyStart(
                    {
                        jobUrl: entry.jobUrl,
                        profile,
                        cvFileBase64: message.cvFileBase64,
                        cvFileName: message.cvFileName,
                    },
                    reply,
                );
            } catch (e) {
                console.error(`${MA} ✖ handler exception:`, e);
                reply({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── EXT_CRAWL — Crawl a URL by opening a background tab. ──
    //    Used by the web app as a Cloudflare bypass: when the Railway
    //    backend's Playwright fetch is blocked, we open the page in the
    //    user's own browser (residential IP, real Chrome) and scrape it
    //    via chrome.scripting.executeScript.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'EXT_CRAWL') {
        const { url } = message;
        if (!url) {
            sendResponse({ success: false, error: 'Missing url' });
            return true;
        }
        extCrawl(url).then(sendResponse).catch((e) => {
            sendResponse({ success: false, error: e?.message || String(e) });
        });
        return true; // async
    }

    // ══════════════════════════════════════════════════════════════
    // ── BATCH AUTO APPLY — Start processing a queue of jobs ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'AUTO_APPLY_ALL_START') {
        const { jobs } = message; // [{jobUrl, profile, jobTitle, company}, ...]
        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
            sendResponse({ success: false, error: 'No jobs provided' });
            return true;
        }

        if (isProcessing) {
            sendResponse({ success: false, error: 'Already processing a batch' });
            return true;
        }

        console.log(`[Copo] Batch Apply: starting ${jobs.length} jobs`);

        (async () => {
            // Same cross-tab single-flight as handleAutoApplyStart: a batch must
            // not start on top of a live SINGLE run — its first tab would hide
            // the driven one and both degrade (measured 2026-08-07).
            const prior = (await chrome.storage.local.get('applySession')).applySession;
            if (prior?.tabId != null && Date.now() - (prior.startedAt || 0) < JOB_HARD_CAP_MS) {
                const alive = await new Promise((r) => {
                    chrome.tabs.get(prior.tabId, (t) => r(!chrome.runtime.lastError && !!t));
                });
                if (alive) {
                    sendResponse({
                        success: false,
                        error: 'Một job đang được ứng tuyển ở tab khác — chờ nó xong hoặc đóng tab đó rồi chạy batch.',
                    });
                    return;
                }
                endApplySession();   // tab gone → dead run, clear and proceed
            }
            // Load each account-gated tenant's standing verdict BEFORE the first
            // tab opens, so a tenant already waiting on the user is skipped
            // instead of re-probed. Fails open: no verdicts → everything reads as
            // 'unknown' and probes normally.
            const resolved = await atsBackend.resolveTenants(jobs);
            atsCoord.beginBatch(`batch-${Date.now()}`, resolved.states);
            persistAtsRuntime();
            // Group jobs by tenant so one company's jobs run back to back — the
            // first probes, the rest inherit the verdict.
            applyQueue = sortJobsByTenant(jobs).map((job, idx) => ({
                ...job,
                index: idx,
                // pending | processing | done | error | blocked
                status: 'pending',
                tenantKey: tenantRefFor(job.jobUrl)?.tenantKey || null,
                result: null,
            }));
            currentJobIndex = -1;
            isProcessing = true;

            persistState();
            broadcastProgress();
            processNextJob();
            // Answered HERE, not synchronously below: the single-flight guard
            // above must be able to refuse, and a success sent before it ran
            // would have the web app showing a batch that never started.
            sendResponse({ success: true, totalJobs: jobs.length });
        })();

        return true;
    }

    // ── ATS candidate account: the agent hit a login wall and needs a credential ──
    // The background answers because it owns the per-tenant attempt budget and
    // the backend token; the content script only drives the form.
    if (message.type === 'ATS_AUTH_REQUEST') {
        (async () => {
            const ref = tenantRefFor(message.url);
            if (!ref) { sendResponse({ ok: false, reason: 'manual', detail: 'Trang này không cần tài khoản' }); return; }

            // Fixture builds only — resolves to null in production, so the branch
            // is dead weight there rather than a second credential path.
            //
            // A supplied credential is a statement that the account EXISTS, and
            // that is what 'ready' encodes, so setting it here is not a shortcut
            // around the coordinator: nextOperation reads the same state it always
            // does and returns 'login' instead of the signup-first probe, and the
            // per-tenant attempt budget still applies. Testing against a real ATS
            // otherwise starts by trying to register an account that is already
            // there.
            const fixtureCred = await readFixtureCredential();
            if (fixtureCred && fixtureCred.operation === 'login') {
                atsCoord.setState(ref.tenantKey, { accountState: 'ready' });
            }

            // The budget decision lives here, so the content script's trace cannot
            // show it — and "hết lượt" without the counters behind it is what made
            // the last three investigations start from a guess.
            console.log(`[Copo ATS] grant? ${ref.tenantKey}`, {
                state: atsCoord.stateFor(ref.tenantKey),
                attempts: atsCoord.snapshot().attempts?.[ref.tenantKey] || { signup: 0, login: 0 },
                batch: atsCoord.currentBatchId(),
                source: fixtureCred ? 'fixture' : 'backend',
            });

            const operation = atsCoord.nextOperation(ref.tenantKey);
            if (!operation) {
                // Name the batch. The old wording ("Đã thử đăng nhập tối đa cho
                // công ty này") reads as a permanent verdict on the company, and
                // it was being shown for attempts spent in an earlier run — so it
                // looked like the agent had given up without doing anything.
                console.warn(`[Copo ATS] ${ref.tenantKey} budget spent this batch:`,
                    atsCoord.snapshot().attempts?.[ref.tenantKey]);
                sendResponse({
                    ok: false,
                    reason: 'manual',
                    detail: 'Đã dùng hết lượt đăng nhập cho công ty này trong lượt chạy hiện tại. '
                        + 'Bắt đầu lượt mới để thử lại.',
                });
                return;
            }

            if (fixtureCred) {
                console.warn(`[Copo] ⚠️  FIXTURE CREDENTIAL used for ${ref.tenantKey} (${operation}) — `
                    + 'this password came from chrome.storage.local, which production never reads.');
                atsCoord.recordAttempt(ref.tenantKey, operation);
                fixtureServedTenants.add(ref.tenantKey);
                sendResponse({
                    ok: true,
                    operation,
                    credentials: { email: fixtureCred.email, password: fixtureCred.password },
                });
                return;
            }

            const cred = await atsBackend.fetchCredential(ref);
            // The SERVER's verdict outranks anything we remember. `atsCoord` lives
            // in worker memory, and MV3 recycles the worker mid-batch as a matter
            // of course — so "this tenant is waiting on the user" can be forgotten
            // while remaining durably true. The credential response carries the
            // account's current state precisely so this check is possible; without
            // it a recycled worker hands out a fresh budget and re-probes an
            // account that may be counting failed attempts against us.
            if (cred.ok && BLOCKING_STATES.has(cred.accountState)) {
                atsCoord.setState(ref.tenantKey, { accountState: cred.accountState });
                persistAtsRuntime();
                const reason = atsCoord.blockedReason(cred.accountState);
                console.log(`[Copo ATS] ${ref.tenantKey} blocked server-side (${cred.accountState}) — not probing`);
                sendResponse({ ok: false, reason, detail: ATS_BLOCK_DETAIL[reason] });
                return;
            }
            if (!cred.ok) {
                // A production bundle deliberately ignores `jobfitApplyCredentials`
                // — it must never turn a password sitting in storage into a login.
                // But when that key IS present and the backend has nothing, the
                // failure looks like a broken agent rather than the wrong build,
                // and that cost real debugging time. Name it. Only the key's
                // PRESENCE is read here; the value is never touched.
                if (cred.missing && !fixtureCredsSupported) {
                    const has = await chrome.storage.local.get('jobfitApplyCredentials')
                        .then(d => !!d?.jobfitApplyCredentials).catch(() => false);
                    if (has) {
                        console.warn('[Copo ATS] jobfitApplyCredentials is set, but THIS IS A '
                            + 'PRODUCTION BUILD and ignores it. Run `npm run build:test` for the '
                            + 'bundle that reads it, or store the credential on the backend.');
                        sendResponse({
                            ok: false, reason: 'manual',
                            detail: 'Bản production không dùng thông tin đăng nhập lưu cục bộ — '
                                + 'dùng bản test (npm run build:test) hoặc lưu credential trên server.',
                        });
                        return;
                    }
                }
                // Distinguish "your session expired" from "this tenant is blocked":
                // the first is fixable by re-opening the web app, the second isn't.
                const detail = cred.auth ? 'Phiên đăng nhập hết hạn — mở copoai.net (đang đăng nhập) để token tự làm mới.'
                    : cred.missing ? 'Chưa có thông tin đăng nhập cho trang tuyển dụng.'
                        : cred.revoked ? 'Thông tin đăng nhập đã bị thu hồi — cần nhập lại.'
                            : cred.disabled ? 'Tính năng tài khoản ATS chưa được bật.'
                                : 'Không lấy được thông tin đăng nhập.';
                sendResponse({ ok: false, reason: cred.revoked ? 'credential' : 'manual', detail });
                return;
            }

            atsCoord.recordAttempt(ref.tenantKey, operation);
            // The password lives only in this response and the content script's
            // local scope for the duration of the fill — never in storage.
            sendResponse({
                ok: true,
                operation,
                credentials: { email: cred.email, password: cred.password },
            });
            // Remember which credential we used, so the result can pin it. Both
            // this and the spent attempt are persisted: a worker recycled between
            // handing out the credential and hearing the verdict must not forget
            // either. (Only the credential ID is stored — never the password.)
            pendingAtsCredential[ref.tenantKey] = cred.credentialId;
            persistAtsRuntime();
        })();
        return true; // async
    }

    // ── ATS candidate account: the agent's normalized verdict ──
    // ── The agent got a credential and could not use it ──
    // Nothing was submitted, so the attempt goes back. Without this, a login wall
    // that was still rendering when the agent looked cost the tenant its only
    // login for the whole batch.
    if (message.type === 'ATS_AUTH_ABANDON') {
        const ref = tenantRefFor(message.url);
        if (ref && message.operation) {
            atsCoord.refundAttempt(ref.tenantKey, message.operation);
            fixtureServedTenants.delete(ref.tenantKey);
            delete pendingAtsCredential[ref.tenantKey];
            persistAtsRuntime();
            console.log(`[Copo ATS] ${ref.tenantKey}: ${message.operation} refunded (${message.why || 'not attempted'})`);
        }
        sendResponse({ ok: true });
        return true;
    }

    if (message.type === 'ATS_AUTH_RESULT') {
        (async () => {
            const ref = tenantRefFor(message.url);
            if (!ref || !message.result) { sendResponse({ ok: false }); return; }

            // A fixture credential has no row on the backend, so reporting it
            // would POST an attempt against a credentialId that does not exist
            // and come back rejected — noise that reads like a real failure while
            // testing. Record the outcome locally and stop there.
            if (fixtureServedTenants.has(ref.tenantKey)) {
                const ok = message.result.outcome === 'success';
                const local = ok ? 'ready' : 'unknown';
                atsCoord.setState(ref.tenantKey, { accountState: local });
                console.warn(`[Copo] ⚠️  FIXTURE — auth result for ${ref.tenantKey} `
                    + `(${message.result.outcome}) NOT reported to the backend.`);
                sendResponse({ ok: true, state: local, reason: atsCoord.blockedReason(local) });
                return;
            }

            const report = await atsBackend.reportAuthResult(ref, message.result, {
                credentialId: pendingAtsCredential[ref.tenantKey],
                batchId: atsCoord.currentBatchId(),
                // Idempotent per (tenant, batch, operation): a network retry of a
                // report that already landed won't double-count the attempt.
                idempotencyKey: `${atsCoord.currentBatchId()}:${ref.tenantKey}:${message.result.operation}`,
                automationVersion: chrome.runtime.getManifest().version,
            });
            if (report.ok && report.account) atsCoord.setState(ref.tenantKey, report.account);
            persistAtsRuntime();

            const state = report.account?.accountState || 'unknown';
            sendResponse({ ok: true, state, reason: atsCoord.blockedReason(state) });
        })();
        return true; // async
    }

    // ── Cancel batch ──
    if (message.type === 'AUTO_APPLY_ALL_CANCEL') {
        abortBatch('cancelled by user', { keepQueue: false });
        sendResponse({ success: true });
        return true;
    }

    // ── Get batch progress ──
    if (message.type === 'GET_APPLY_PROGRESS') {
        sendResponse({
            isProcessing,
            queue: applyQueue,
            currentIndex: currentJobIndex,
            total: applyQueue.length,
            completed: applyQueue.filter(j => j.status === 'done' || j.status === 'error').length,
        });
        return true;
    }

    // ── Tab-scope check: is the asking content script running in the tab that
    // actually launched the current apply session? The agent uses this to avoid
    // auto-running on an unrelated known-host page (e.g. the user's LinkedIn feed)
    // just because a pendingAutoApply flag is still live. Falls back to the
    // persisted session tab id so it survives a service-worker restart.
    if (message.type === 'IS_APPLY_TAB') {
        const tid = sender.tab && sender.tab.id;
        if (tid && tid === applyTabId) { sendResponse({ isApplyTab: true }); return true; }
        chrome.storage.local.get('applySession', (d) => {
            sendResponse({ isApplyTab: !!(tid && d.applySession && d.applySession.tabId === tid) });
        });
        return true;  // async response
    }

    // ── Agent heartbeat: the driven page is alive, extend the watchdog ──
    if (message.type === 'AUTO_APPLY_HEARTBEAT') {
        if (isProcessing && sender.tab && sender.tab.id === currentTabId
            && Date.now() - jobStartedAt < JOB_HARD_CAP_MS) {
            // Persisted, not just in memory: after a worker restart this is the
            // only way the alarm-driven watchdog can tell a page that is working
            // from one that died before it ever checked in.
            lastHeartbeatAt = Date.now();
            persistState();
            armJobSafetyTimer(currentJobIndex);
        }
        sendResponse({ ok: true });
        return true;
    }

    // ── Content script reports single auto-apply result ──
    if (message.type === 'AUTO_APPLY_RESULT') {
        console.log('[Copo] Auto Apply result:', message.result);

        // Ignore stray/late results from tabs that aren't the one we're driving —
        // otherwise a result from a previous job's tab can corrupt the current entry.
        if (isProcessing && sender.tab && sender.tab.id !== currentTabId) {
            sendResponse({ success: false, detail: 'stale tab' });
            return true;
        }

        // If this is part of a batch, update queue and continue
        if (isProcessing && currentJobIndex >= 0 && currentJobIndex < applyQueue.length) {
            // This job reported back — cancel its safety timeout so it can't fire
            // later against a different job.
            clearJobSafetyTimer();
            // 'blocked' is its own terminal state: the agent stopped because the
            // tenant needs the USER, not because the job failed. Recording it as
            // an error would put a red row in front of someone who has merely not
            // clicked a verification link yet.
            const blocked = message.result?.outcome === 'blocked';
            applyQueue[currentJobIndex].status = blocked ? 'blocked'
                : message.result?.success ? 'done' : 'error';
            if (blocked) {
                applyQueue[currentJobIndex].blockedReason = message.result?.blockedReason || 'manual';
            }
            applyQueue[currentJobIndex].result = message.result;
            // Which fields this application asked for that the user's stored data
            // could not answer. Accumulated across the batch and pushed to the web
            // app, so the product can ask ONCE instead of discovering the same
            // hole at every company — which is what happens today: an application
            // stalls on "Overall Result (GPA)", the user fixes it by hand, and the
            // next company asks for exactly the same thing.
            for (const g of message.result?.fieldGaps || []) {
                if (g?.key || g?.label) batchFieldGaps.set(g.key || g.label, g);
            }
            persistState();

            // Broadcast progress update to web app
            broadcastProgress();

            // Process next job after a delay
            setTimeout(() => processNextJob(), TAB_DELAY_MS);
        } else {
            // Single apply (not batch)
            chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl']);
            endApplySession();
        }

        sendResponse({ success: true });
        return true;
    }
});

// ─── Process next job in queue ───
async function processNextJob() {
    if (!isProcessing) return;

    currentJobIndex++;

    if (currentJobIndex >= applyQueue.length) {
        // All done!
        abortBatch('all jobs completed');
        return;
    }

    const job = applyQueue[currentJobIndex];

    // ── Tenant gate: skip BEFORE opening a tab ──
    // If this job's company is already waiting on the user (unverified email, an
    // account under a different password, a CAPTCHA), there is nothing to try.
    // Skipping here costs no tab, no credit, and — critically — no extra failed
    // login against a tenant that may be counting them.
    const tenantRef = tenantRefFor(job.jobUrl);
    const gate = atsCoord.gateJob(tenantRef);
    if (gate.skip) {
        job.status = 'blocked';
        job.blockedReason = gate.reason;
        job.result = { success: false, blocked: true, detail: ATS_BLOCK_DETAIL[gate.reason] };
        console.log(`[Copo] Batch Apply: job ${currentJobIndex + 1} blocked (${tenantRef?.tenantKey} → ${gate.state})`);
        persistState();
        broadcastProgress();
        processNextJob();
        return;
    }

    job.status = 'processing';
    persistState();

    console.log(`[Copo] Batch Apply: processing job ${currentJobIndex + 1}/${applyQueue.length} — ${job.jobUrl}`);

    // Save profile + this job's own CV (scoped to its session) + the pending flag.
    // The CV deliberately does NOT go into the shared slot: job N+1 without a
    // tailored CV would otherwise upload job N's — a wrong, but perfectly
    // successful-looking, application.
    const jobCv = job.cvFileBase64 && job.cvFileName
        ? { base64: job.cvFileBase64, fileName: job.cvFileName }
        : null;
    const merged = await mergedProfile(job.profile);
    // The profile rides IN the run (run:<id>:profile), not just the global
    // slot — a batch job must fill from the snapshot it was enqueued with.
    const { sessionId, fragment } = prepareApplySession(job.jobUrl, jobCv, { profile: merged });
    const storage = {
        jobfitProfile: merged,
        pendingAutoApply: true,
        autoApplyJobUrl: job.jobUrl,
        batchMode: true,
        ...fragment,
    };
    (async () => {
        // ── Don't submit twice ──
        // A retried job (tab closed mid-flow, worker recycled, network died) may
        // already have a submitted application on the other side. Ask Workday
        // before opening anything. Only 'submitted' short-circuits: 'unknown'
        // deliberately proceeds to the UI agent, which never presses Submit
        // itself — guessing "probably a draft" is what creates duplicates.
        // Gated on 'ready' — a tenant we've authenticated at before is the only
        // place a prior application can exist. A brand-new tenant has nothing to
        // reconcile, so this costs one GET per job only where it can pay off.
        if (tenantRef?.atsVendor === 'workday' && gate.state === 'ready') {
            try {
                const prior = await reconcileSubmission(job.jobUrl);
                if (prior.state === 'submitted') {
                    job.status = 'done';
                    job.result = { success: true, outcome: 'submitted', detail: 'Đã nộp trước đó' };
                    console.log(`[Copo] Batch Apply: job ${currentJobIndex + 1} already submitted — skipping`);
                    persistState();
                    broadcastProgress();
                    setTimeout(() => processNextJob(), TAB_DELAY_MS);
                    return;
                }
            } catch (e) {
                console.warn('[Copo] reconcile failed, continuing to the agent:', e?.message || e);
            }
        }

        // Gate on host access first — an unknown host needs an optional-permission
        // grant before we can drive it; skip the job cleanly if it's not granted.
        const access = await ensureHostAccess(job.jobUrl);
        if (!access.ok) {
            job.status = 'error';
            job.result = { success: false, detail: 'Cần cấp quyền truy cập trang này (mở popup Copo để cho phép).' };
            persistState();
            broadcastProgress();
            setTimeout(() => processNextJob(), TAB_DELAY_MS);
            return;
        }
        // Per-job flat fee (covers all this job's agent-plan + map-form calls).
        const charge = await extSpend('auto_apply');
        if (charge.insufficient || charge.auth) {
            job.status = 'error';
            job.result = {
                success: false,
                detail: charge.insufficient
                    ? 'Không đủ credit để ứng tuyển job này.'
                    : 'Phiên đăng nhập hết hạn — mở copoai.net (đang đăng nhập) để token tự làm mới.',
            };
            // Out of credits applies to every remaining job → stop the batch
            // instead of churning failures; expired auth is the same. Routed
            // through abortBatch so the watchdog, apply session, session CV and
            // pending flags are torn down too — this path used to leave all four.
            abortBatch(charge.insufficient ? 'out of credits' : 'auth expired');
            return;
        }
        chrome.storage.local.set(storage, () => {
            // Open the job URL in a new tab
            chrome.tabs.create({ url: job.jobUrl, active: true }, (tab) => {
                currentTabId = tab.id;
                jobStartedAt = Date.now();
                // Reset the liveness clock: the PREVIOUS job's heartbeat must not
                // read as this job's page being alive.
                lastHeartbeatAt = 0;
                adoptApplySession(sessionId, tab.id);  // follow redirects/new-tabs; onCompleted injects unknown hosts
                persistState();
                broadcastProgress();

                // Watchdog: skip the job if the page goes silent. The agent's
                // heartbeats keep re-arming this while it's actively working
                // (capture the index so a stale timer can't skip a later job).
                armJobSafetyTimer(currentJobIndex);
            });
        });
    })();
}

// ─── Broadcast progress to all content scripts (web app) ───
function broadcastProgress() {
    updateBadge();
    const progress = {
        type: 'JOBFIT_APPLY_PROGRESS',
        isProcessing,
        queue: applyQueue.map(j => ({
            jobUrl: j.jobUrl,
            jobTitle: j.jobTitle,
            company: j.company,
            status: j.status,
            result: j.result,
            // Lets the web app group blocked jobs under the right company row.
            tenantKey: j.tenantKey,
            blockedReason: j.blockedReason,
        })),
        currentIndex: currentJobIndex,
        total: applyQueue.length,
        completed: applyQueue.filter(
            j => j.status === 'done' || j.status === 'error' || j.status === 'blocked').length,
        successful: applyQueue.filter(j => j.status === 'done').length,
        // Waiting on the USER — counted separately from both success and failure
        // so the web app can present three honest buckets.
        blocked: applyQueue.filter(j => j.status === 'blocked').length,
        // 'done' splits into two very different outcomes: 'submitted' (a success
        // signal appeared after the agent acted) vs 'filled' (form filled, the
        // tab is open awaiting the user's review + manual submit). The web app
        // must not present 'filled' as a sent application.
        submitted: applyQueue.filter(j => j.status === 'done' && j.result?.outcome === 'submitted').length,
        filled: applyQueue.filter(j => j.status === 'done' && j.result?.outcome !== 'submitted').length,
    };

    // Send to all tabs that have content scripts
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, progress).catch(() => { });
        }
    });
}

// When we open a Copo-app tab for a cold Mode-1 result, remember when — so a
// burst of tailors (multiple jobs, no tab open) opens ONE tab, not one each.
// Resets if the worker is recycled, by which point the tab exists and is taken
// by the firstAppTab branch instead.
let mode1ColdTabOpenAt = 0;

// Push an arbitrary message to every tab; content-webapp.js forwards the
// Copo-app ones to the page. Used to deliver the Mode-1 tailored CV.
function pushToWebApp(message) {
    chrome.tabs.query({}, (tabs) => {
        let appTabs = 0;
        let firstAppTab = null;
        for (const tab of tabs) {
            if (tab.id == null) continue;
            if (/copoai\.net|cv-validation\.vercel\.app|localhost:3000/.test(tab.url || '')) {
                appTabs++;
                if (firstAppTab == null) firstAppTab = tab;
            }
            chrome.tabs.sendMessage(tab.id, message).catch(() => { });
        }
        if (message?.type === 'JOBFIT_MODE1_RESULT') {
            console.log(`[Copo Mode1/bg] pushed ${message.type} → ${appTabs} Copo-app tab(s) open`);
            if (firstAppTab) {
                // The user tailored on a job board, so the Copo-app tab is in
                // the background. Bring it to the front so the auto-opened CV
                // editor is actually visible. tabs.update selects the tab in its
                // window; windows.update is needed when it's in another window.
                chrome.tabs.update(firstAppTab.id, { active: true }).catch(() => { });
                if (firstAppTab.windowId != null) {
                    chrome.windows.update(firstAppTab.windowId, { focused: true }).catch(() => { });
                }
                console.log(`[Copo Mode1/bg] focused Copo-app tab ${firstAppTab.id} (win ${firstAppTab.windowId})`);
            } else {
                // No Copo-app tab open. Stash the result and open ONE tab; the
                // new tab claims it from storage via the JOBFIT_WEBAPP_READY
                // handshake (MV3 workers are ephemeral and a fresh tab hasn't
                // subscribed yet, so we can't just sendMessage). Tailoring several
                // jobs while no tab is open accumulates into a LIST so none is
                // lost, and the in-memory guard keeps the whole burst to one tab
                // (later results land in the now-open tab via the firstAppTab
                // branch above).
                chrome.storage.local.get('pendingMode1Results', (d) => {
                    const list = (d.pendingMode1Results || []).concat({ message, at: Date.now() });
                    chrome.storage.local.set({ pendingMode1Results: list.slice(-10) });
                });
                if (Date.now() - mode1ColdTabOpenAt > 15000) {
                    mode1ColdTabOpenAt = Date.now();
                    chrome.storage.local.get('jobfitAppUrl', (d) => {
                        const appUrl = d.jobfitAppUrl || 'https://copoai.net';
                        chrome.tabs.create({ url: appUrl, active: true });
                        console.log(`[Copo Mode1/bg] no app tab — stashed tailored CV + opened ${appUrl}`);
                    });
                } else {
                    console.log('[Copo Mode1/bg] no app tab, but one is already opening — stashed for that tab');
                }
            }
        }
    });
}

// ─── Handle tab closed — if current processing tab is closed, skip to next ───
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId && isProcessing && currentJobIndex < applyQueue.length) {
        if (applyQueue[currentJobIndex]?.status === 'processing') {
            console.log('[Copo] Batch Apply: tab closed, marking as error and continuing');
            applyQueue[currentJobIndex].status = 'error';
            applyQueue[currentJobIndex].result = { success: false, detail: 'Tab was closed' };
            persistState();
            broadcastProgress();
            setTimeout(() => processNextJob(), 1000);
        }
    }
});

// ─── Badge: show active status ───
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // topcv.vn disabled — only fetch jobs from embedded sites. Keep VNW.
        // const isSupported = tab.url.includes('vietnamworks.com') || tab.url.includes('topcv.vn');
        const isSupported = tab.url.includes('vietnamworks.com');
        if (isSupported) {
            chrome.action.setBadgeText({ text: '⚡', tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#7C3AED', tabId });
        }
    }
});

// ─── Show batch count on badge ───
function updateBadge() {
    if (isProcessing) {
        const done = applyQueue.filter(j => j.status === 'done' || j.status === 'error').length;
        chrome.action.setBadgeText({ text: `${done}/${applyQueue.length}` });
        chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ─── EXT_CRAWL implementation ───
// Opens a background tab, waits for Cloudflare's JS challenge (if any)
// to auto-resolve in the user's real browser, scrapes content, closes tab.
// ═══════════════════════════════════════════════════════════════════════

const EXT_CRAWL_TAB_LOAD_TIMEOUT = 30000;  // max time waiting for tabs.onUpdated complete
const EXT_CRAWL_CHALLENGE_TIMEOUT = 25000; // max time for challenge to clear after load
const EXT_CRAWL_POLL_INTERVAL = 1500;

function _waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab load timed out'));
        }, timeoutMs);
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Runs inside the target page. Returns content + whether the page still
// looks like an anti-bot challenge so the background script can keep polling.
function _extractPageContent() {
    const title = document.title || '';
    const bodyText = (document.body && document.body.innerText) || '';
    const looksLikeChallenge =
        /just a moment|attention required|checking your browser|verifying you are human/i.test(title)
        || /attention required! \| cloudflare|cf-browser-verification|cf-error-details|ray id:/i
            .test(bodyText.slice(0, 2000));

    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const text = bodyText.slice(0, 50000);

    // Build a compact text-with-links representation so the AI extractor on
    // the frontend can find job URLs even though the first 20KB of raw HTML
    // would be mostly <head>/scripts/CSS noise.
    // Mirrors the backend's /api/crawl-url ?keepLinks=true logic.
    let textWithLinks = '';
    let textWithLinksLinkCount = 0;
    let textWithLinksBuildError = '';
    try {
        textWithLinks = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(
                /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
                (_, href, innerText) => {
                    const cleanInner = innerText.replace(/<[^>]+>/g, '').trim();
                    return `[LINK:${href}] ${cleanInner} [/LINK]`;
                }
            )
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
            // VNW search pages bury job cards under a heavy filter sidebar
            // + ads — the first 25k chars often run out before the cards. Use
            // 80k to give the AI room to see all visible postings.
            // (topcv path disabled — only fetch from embedded sites.)
            .slice(0, 80000);
        textWithLinksLinkCount = (textWithLinks.match(/\[LINK:/g) || []).length;
    } catch (e) {
        textWithLinksBuildError = e?.message || String(e);
    }

    let jsonLd = null;
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const el of scripts) {
        try {
            const parsed = JSON.parse(el.textContent || 'null');
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (item && item['@type'] === 'JobPosting') {
                    jsonLd = item;
                    break;
                }
            }
            if (jsonLd) break;
        } catch (_) { /* ignore */ }
    }

    return {
        html, text, textWithLinks, jsonLd, title, looksLikeChallenge,
        // Debug fields — surfaced in EXT_CRAWL polling logs so we can tell
        // whether textWithLinks actually contains usable [LINK:] markers
        // before we ship it to the AI extractor downstream.
        textWithLinksLinkCount,
        textWithLinksBuildError,
    };
}

async function extCrawl(url) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        console.log(`[Copo] EXT_CRAWL: opened background tab ${tabId} for ${url}`);

        // Wait for initial load (Cloudflare challenge page may load first)
        try {
            await _waitForTabComplete(tabId, EXT_CRAWL_TAB_LOAD_TIMEOUT);
        } catch (e) {
            console.warn(`[Copo] EXT_CRAWL: initial load timeout — continuing to poll`);
        }

        // Poll until the page no longer looks like a challenge, OR timeout.
        // Real Chrome auto-solves Cloudflare's JS challenge in ~5s.
        const deadline = Date.now() + EXT_CRAWL_CHALLENGE_TIMEOUT;
        let last = null;
        let pollIdx = 0;
        // Search-result pages render job cards via JS after initial load. If
        // we return on poll #0 the DOM is "complete" but <a> tags aren't there
        // yet — text is full of header/footer, no usable job URLs. Force the
        // loop to keep polling until job links actually appear in the DOM.
        // topcv.vn search pattern disabled — only fetch from embedded sites. Keep VNW.
        // const isSearchPage = /topcv\.vn\/(?:tim-viec-lam-|tim-kiem|search)|vietnamworks\.com\/(?:tim-viec-lam|jobs)/i.test(url);
        const isSearchPage = /vietnamworks\.com\/(?:tim-viec-lam|jobs)/i.test(url);
        while (Date.now() < deadline) {
            try {
                const [{ result }] = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: _extractPageContent,
                });
                last = result;

                // ── DEBUG: dump what we actually got so we can tell whether
                //    a "successful" 25k-char return is real content or a soft
                //    anti-bot page that our looksLikeChallenge regex missed.
                //
                // The job-link regexes are anchored to `href=` so we only
                // accept the page once real <a> tags with job URLs exist —
                // matching loose text would let us return when /viec-lam/...
                // appears only inside data-attrs or inline JSON.
                // topcv link detection disabled — only fetch from embedded sites. Keep VNW.
                // const hasTopCVJobLinks =
                //     /href=["'][^"']*\/viec-lam\/[^"'\s]+\.html/.test(result?.html || '');
                const hasTopCVJobLinks = false;
                const hasVNWJobLinks =
                    /href=["'][^"']*-jv(?:["'?#\/])/.test(result?.html || '');
                const hasJobLinks = hasTopCVJobLinks || hasVNWJobLinks;
                // Sample a few [LINK:] markers so we can eyeball whether the
                // textWithLinks payload is what we expect to ship downstream.
                const linkSamples = (result?.textWithLinks || '')
                    .match(/\[LINK:[^\]]+\][^[]{0,80}/g)
                    ?.slice(0, 3) || [];
                console.log(`[Copo] EXT_CRAWL DEBUG poll #${pollIdx}`, {
                    url,
                    title: result?.title,
                    textLen: result?.text?.length || 0,
                    htmlLen: result?.html?.length || 0,
                    textWithLinksLen: result?.textWithLinks?.length || 0,
                    textWithLinksLinkCount: result?.textWithLinksLinkCount || 0,
                    textWithLinksBuildError: result?.textWithLinksBuildError || '',
                    looksLikeChallenge: result?.looksLikeChallenge,
                    hasTopCVJobLinks,
                    hasVNWJobLinks,
                    isSearchPage,
                    firstChars: (result?.text || '').slice(0, 300),
                    linkSamples,
                });
                pollIdx++;

                const contentReady = result && !result.looksLikeChallenge && (result.text?.length || 0) >= 200;
                // Search pages MUST have job links in the DOM before we return —
                // otherwise the AI extractor downstream gets a card-less page.
                const searchReady = !isSearchPage || hasJobLinks;
                if (contentReady && searchReady) {
                    console.log(`[Copo] EXT_CRAWL: extracted ${result.text.length} chars from ${url}`);
                    return {
                        success: true,
                        text: result.text,
                        textWithLinks: result.textWithLinks,
                        html: result.html,
                        jsonLd: result.jsonLd,
                        method: 'extension',
                    };
                }
            } catch (e) {
                console.warn(`[Copo] EXT_CRAWL: executeScript error:`, e.message);
            }
            await new Promise(r => setTimeout(r, EXT_CRAWL_POLL_INTERVAL));
        }

        // Timed out. If we ever got content but it was a challenge, return blocked.
        const blocked = !!(last && last.looksLikeChallenge);
        console.log(`[Copo] EXT_CRAWL DEBUG timeout`, {
            url,
            blocked,
            finalTitle: last?.title,
            finalTextLen: last?.text?.length || 0,
            finalFirstChars: (last?.text || '').slice(0, 300),
        });
        return {
            success: false,
            blocked,
            error: blocked
                ? 'Anti-bot challenge did not auto-resolve. The site may require manual interaction.'
                : 'Extension crawl produced no usable content.',
        };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    } finally {
        if (tabId != null) {
            chrome.tabs.remove(tabId).catch(() => { });
        }
    }
}

// ─── Install event ───
chrome.runtime.onInstalled.addListener(() => {
    console.log('[Copo] Extension installed!');
    // Clear any stale queue.
    //
    // `atsRuntime` belongs in this list and was missing from it, which is worse
    // than it sounds: it holds the per-tenant attempt budget, so a batch
    // abandoned mid-run (extension reloaded, tab closed) left its spent budget in
    // storage while the queue beside it was cleared. The next apply at that
    // company then refused before touching the page — "Đã thử đăng nhập tối đa
    // cho công ty này" for attempts made in a batch that no longer existed — and
    // reloading the extension, the obvious fix, did not help because reloading is
    // exactly what got here.
    chrome.storage.local.remove([
        'applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt',
        'pendingAutoApply', 'autoApplyJobUrl', 'batchMode',
        'atsRuntime', 'applySession', 'lastHeartbeatAt',
    ]);
    atsCoord.endBatch();

    // MV3 content scripts only inject into pages that load AFTER install. A user
    // who already has a CV in the web app and installs the extension with the
    // app tab open would otherwise see "Extension chưa nhận data" (the relay
    // isn't present, so the app's profile push times out) and be forced to F5.
    // Inject the relay into those already-open app tabs now; once live it
    // re-announces JOBFIT_EXTENSION_READY, and the app retries its push → data
    // flows without a manual refresh. Restricted to origins we hold host
    // permission for (localhost isn't in host_permissions, so skip it).
    // Narrow the query to our own app origins (host_permissions) so we never
    // read URLs of unrelated tabs — keeps the injection least-privilege.
    chrome.tabs.query({
        url: ['https://copoai.net/*', 'https://cv-validation.vercel.app/*'],
    }, (tabs) => {
        for (const tab of tabs) {
            if (tab.id == null) continue;
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-webapp.js'],
            }).then(() => {
                console.log(`[Copo] Injected relay into open app tab ${tab.id}`);
            }).catch((e) => {
                // Discarded tab, chrome:// interstitial, or a duplicate-injection
                // race — the in-page guard makes a double-inject a no-op anyway.
                console.warn(`[Copo] onInstalled inject skipped for tab ${tab.id}:`, e?.message);
            });
        }
    });
});
