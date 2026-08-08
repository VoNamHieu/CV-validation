/**
 * A running record of what the agent did, printed as one block when it stops.
 *
 * The apply agent fails across page loads. Each navigation destroys the content
 * script and its console output scrolls away with the old document, so by the
 * time a run ends as 'blocked' the evidence for WHY is spread over three dead
 * contexts and the user is left holding a result object that says nothing more
 * than "blocked". Three rounds of fixes went in on code reading alone because of
 * that.
 *
 * So: every decision point appends a line here AND logs it live, the buffer
 * survives navigation in sessionStorage, and a failure dumps the whole thing as
 * a single copyable table. What is wanted from a failed run is one paste, not a
 * scroll through a console that no longer exists.
 */

const KEY = 'copoAgentTrace';
const RUN_KEY = 'copoTraceRun';
const MAX = 120;          // a long run, still one screenful when printed
const VALUE_CAP = 200;    // keep a DOM dump from swallowing the buffer

/**
 * Every browser touch below is guarded.
 *
 * policy.js calls trace() and is deliberately unit-testable in plain node — no
 * DOM, no storage — so a tracer that assumes a browser would make the safety
 * layer untestable to gain a log line. Outside a browser this degrades to a
 * console call and nothing else.
 */
const hasStore = () => {
    try { return typeof sessionStorage !== 'undefined' && !!sessionStorage; } catch { return false; }
};

/** Read the buffer that survived the last navigation. */
function load() {
    if (!hasStore()) return [];
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save(rows) {
    if (!hasStore()) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX))); } catch { /* full or blocked */ }
}

function here() {
    try { return typeof location !== 'undefined' ? location.pathname.slice(-52) : ''; } catch { return ''; }
}

/** Emails: keep enough to recognise the account, not enough to be an address. */
const maskEmails = (s) => s.replace(/\b([\w.+-])[\w.+-]*@([\w-]+)\.[\w.-]+\b/g, '$1***@$2.***');

/**
 * Anything that could be a password never reaches the log, and addresses are
 * masked.
 *
 * This buffer is written to be PASTED — into a chat, an issue, a message to
 * whoever is debugging. Auth error banners quote the account's email back
 * ("No account for …"), so a trace that reproduces them verbatim turns a
 * debugging aid into a way to hand someone's address to a third party.
 */
function scrub(data) {
    if (!data || typeof data !== 'object') return data;
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined) { out[k] = v; continue; }
        // Only STRINGS are masked. Matching on the key alone turned
        // `passwordFields: 2` into «1 chars» and `pass: 1` (the attempt number)
        // into the same — the first real trace came back with its two most
        // useful counts redacted, which is a log that hides the thing it was
        // added to show. A number cannot be a password.
        if (typeof v === 'string' && /pass|pwd|secret|token|credential/i.test(k)) {
            out[k] = `«${v.length} chars»`;
            continue;
        }
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        out[k] = maskEmails(text).slice(0, VALUE_CAP);
    }
    return out;
}

/**
 * Which run these steps belong to. Survives navigation with the buffer, so a
 * dump pasted from a machine that ran two jobs in one evening says WHICH job
 * it is — the 2026-08-07 diagnosis started by untangling two interleaved runs
 * that carried no identity at all.
 */
export function setTraceRun(runId) {
    if (!hasStore() || !runId) return;
    try { sessionStorage.setItem(RUN_KEY, String(runId)); } catch { /* full or blocked */ }
}

function traceRun() {
    if (!hasStore()) return null;
    try { return sessionStorage.getItem(RUN_KEY) || null; } catch { return null; }
}

/**
 * Record one step.
 *
 * `step` is a short stable tag ('auth.grant', 'auth.fill') so a run can be
 * filtered or diffed against another; `data` is whatever made the decision.
 */
export function trace(step, data) {
    const row = {
        t: new Date().toISOString().slice(11, 23),
        step,
        url: here(),
        ...scrub(data),
    };
    const rows = load();
    rows.push(row);
    save(rows);
    console.log(`[Copo Trace] ${row.t} ${step}`, data === undefined ? '' : scrub(data));
    return row;
}

/**
 * Record a step only the first time this exact situation occurs.
 *
 * The loop re-checks the same conditions every iteration, so the honest
 * per-iteration trace repeated "no login wall here" and "no upload target here"
 * a dozen times with identical bodies — and the buffer is meant to be PASTED,
 * where length is the binding constraint. The first real My Information trace
 * was cut off by the chat client before reaching the line that explained it,
 * killed by its own noise.
 *
 * `key` is the signature of the situation, not of the step: repeat it and the
 * row is dropped, change it and the row is kept. Per page load, so a navigation
 * legitimately reports the same condition again.
 */
const seenOnce = new Set();
export function traceOnce(key, step, data) {
    if (seenOnce.has(key)) return null;
    seenOnce.add(key);
    return trace(step, data);
}

/**
 * Print everything, including the steps that happened before the last
 * navigation — which is usually where the cause is.
 */
export function traceDump(reason) {
    const rows = load();
    if (!rows.length) { console.warn(`[Copo Trace] ${reason} — no steps recorded`); return rows; }
    console.warn(`[Copo Trace] ▼ ${rows.length} steps leading to: ${reason}`);
    try { console.table(rows); } catch { console.warn(rows); }
    // console.table cannot be copied out of every devtools build; the JSON can.
    const run = traceRun();
    console.warn('[Copo Trace] copy the line below to share this run:\n'
        + JSON.stringify(run ? { run, reason, steps: rows } : { reason, steps: rows }));
    return rows;
}

/**
 * Drop the buffer.
 *
 * Called after a result is reported, not on page load — the agent is re-injected
 * on every navigation, and clearing there would throw away exactly the steps a
 * failure needs to be explained by.
 */
export function traceClear() {
    if (!hasStore()) return;
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════
//  SPANS — where the time actually goes
// ═══════════════════════════════════════════════════════════════════════
//
// The event log above says what the agent DID; it cannot say what a run
// COST. A field can be touched by the recipe, a row helper, the validation
// recovery and the planner in one iteration, each pass re-walking widgets
// that are already done, and the only visible symptom is "it works but it
// is slow and the order looks random".
//
// So spans record, per field and per iteration: who touched it, how many
// times, for how long, through which fallback path, and whether the
// iteration produced any progress at all. Aggregates (small, bounded) live
// beside the rolling event buffer and survive navigation, so a report can
// be printed at the end of a run that crossed four page loads.
//
// Detail is kept only when it earns its place — slow, failed, or a path
// nobody has seen before — because the buffer is meant to be PASTED.

const SPAN_KEY = 'copoAgentSpans';
const SLOW_MS = 2000;          // a field/dropdown slower than this keeps its detail
const MAX_ITERS = 200;
const MAX_DROPS = 40;

let spansOn = false;
/** Only the locked-tenant path turns this on (see recipe-router). */
export function setSpanTracking(on) { spansOn = !!on; }
export function spanTrackingOn() { return spansOn; }

const emptySpans = () => ({ fields: {}, iters: [], buckets: { sleepMs: 0, llmMs: 0 }, drops: [], startedAt: Date.now() });

function loadSpans() {
    if (!hasStore()) return emptySpans();
    try { return JSON.parse(sessionStorage.getItem(SPAN_KEY) || 'null') || emptySpans(); } catch { return emptySpans(); }
}
function saveSpans(s) {
    if (!hasStore()) return;
    try { sessionStorage.setItem(SPAN_KEY, JSON.stringify(s)); } catch { /* full */ }
}

/** Time spent waiting vs thinking — the two buckets that explain a slow run. */
export function spanBucket(name, ms) {
    if (!spansOn || !(ms > 0)) return;
    const s = loadSpans();
    s.buckets[name] = (s.buckets[name] || 0) + Math.round(ms);
    saveSpans(s);
}

/**
 * One field, handled once, by one owner. `owner` is the LAYER (recipe, rows,
 * needs, planner, recovery) — the same field showing several owners in one
 * run is exactly the duplicated work this exists to surface.
 */
export function spanField(label, { step, owner, handler, iteration, ms, result, path } = {}) {
    if (!spansOn || !label) return;
    const s = loadSpans();
    const k = String(label).slice(0, 48);
    const f = s.fields[k] || (s.fields[k] = { attempts: 0, totalMs: 0, maxMs: 0, owners: {}, results: {}, paths: [], steps: [] });
    f.attempts++;
    f.totalMs += Math.round(ms || 0);
    f.maxMs = Math.max(f.maxMs, Math.round(ms || 0));
    if (owner) f.owners[owner] = (f.owners[owner] || 0) + 1;
    if (result) f.results[result] = (f.results[result] || 0) + 1;
    if (handler) f.handler = handler;
    if (step && !f.steps.includes(step)) f.steps.push(step);
    if (iteration != null) f.lastIteration = iteration;
    // A path is kept once — repeats of the same ladder say nothing new.
    if (path && !f.paths.includes(path) && f.paths.length < 4) f.paths.push(path);
    saveSpans(s);
}

/** One dropdown open→commit cycle. Kept only when slow or unsuccessful. */
export function spanDropdown(field, { ms, result, path, rows } = {}) {
    if (!spansOn) return;
    const notable = (ms || 0) >= SLOW_MS || (result && result !== 'ok');
    if (!notable) return;
    const s = loadSpans();
    s.drops.push({ field: String(field || '?').slice(0, 40), ms: Math.round(ms || 0), result, path: String(path || '').slice(0, 90), rows });
    if (s.drops.length > MAX_DROPS) s.drops = s.drops.slice(-MAX_DROPS);
    saveSpans(s);
}

/** One loop iteration: its phases, and whether anything actually moved. */
export function spanIteration({ n, step, ms, progress, phases } = {}) {
    if (!spansOn) return;
    const s = loadSpans();
    s.iters.push({ n, step: String(step || '?').slice(0, 28), ms: Math.round(ms || 0), progress: !!progress, phases });
    if (s.iters.length > MAX_ITERS) s.iters = s.iters.slice(-MAX_ITERS);
    saveSpans(s);
}

/**
 * The six questions a slow run has to answer, printed as one block.
 * Returns the aggregate so a caller can ship it with the result.
 */
export function traceReport() {
    if (!spansOn) return null;
    const s = loadSpans();
    const fields = Object.entries(s.fields);
    if (!fields.length && !s.iters.length) return null;
    const byTime = [...fields].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 5)
        .map(([k, v]) => `${k} ${(v.totalMs / 1000).toFixed(1)}s ×${v.attempts}${v.paths.length ? ` [${v.paths[v.paths.length - 1]}]` : ''}`);
    const byTouch = [...fields].filter(([, v]) => v.attempts > 1).sort((a, b) => b[1].attempts - a[1].attempts).slice(0, 5)
        .map(([k, v]) => `${k} ×${v.attempts} (${Object.entries(v.owners).map(([o, n]) => `${o}:${n}`).join(' ')})`);
    const multiOwner = fields.filter(([, v]) => Object.keys(v.owners).length > 1)
        .map(([k, v]) => `${k} ← ${Object.keys(v.owners).join(' + ')}`);
    const idle = s.iters.filter(i => !i.progress);
    const totalMs = Date.now() - (s.startedAt || Date.now());
    const phaseTotals = {};
    for (const it of s.iters) for (const [p, ms] of Object.entries(it.phases || {})) phaseTotals[p] = (phaseTotals[p] || 0) + ms;
    const secs = (ms) => `${((ms || 0) / 1000).toFixed(1)}s`;
    const report = {
        runMs: totalMs,
        slowestFields: byTime,
        mostTouched: byTouch,
        multiOwner,
        iterations: { total: s.iters.length, noProgress: idle.length, idleAt: idle.map(i => i.n).slice(0, 20) },
        time: { total: secs(totalMs), waiting: secs(s.buckets.sleepMs), llm: secs(s.buckets.llmMs), phases: Object.fromEntries(Object.entries(phaseTotals).map(([k, v]) => [k, secs(v)])) },
        dropdownFallbacks: s.drops.map(d => `${d.field} ${secs(d.ms)} ${d.result}${d.path ? ` [${d.path}]` : ''}`),
    };
    try {
        console.warn('%c[Copo Report] where the time went', 'color:#7c3aed;font-weight:700');
        console.warn(`  total ${report.time.total} · waiting ${report.time.waiting} · LLM ${report.time.llm}`);
        console.warn(`  phases: ${Object.entries(report.time.phases).map(([k, v]) => `${k} ${v}`).join(' · ') || '(none)'}`);
        console.warn(`  iterations: ${report.iterations.total}, no progress in ${report.iterations.noProgress}${report.iterations.idleAt.length ? ` (#${report.iterations.idleAt.join(',')})` : ''}`);
        console.warn('  slowest fields:', report.slowestFields.length ? report.slowestFields : '(none)');
        console.warn('  handled more than once:', report.mostTouched.length ? report.mostTouched : '(none)');
        console.warn('  touched by several layers:', report.multiOwner.length ? report.multiOwner : '(none)');
        if (report.dropdownFallbacks.length) console.warn('  dropdown fallbacks:', report.dropdownFallbacks);
        console.warn('[Copo Report] copy the line below:\n' + JSON.stringify(report));
    } catch { /* noop */ }
    return report;
}

/** A finished job starts the next one from an empty ledger. */
export function traceSpansClear() {
    if (!hasStore()) return;
    try { sessionStorage.removeItem(SPAN_KEY); } catch { /* noop */ }
}
