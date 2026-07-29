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
const MAX = 120;          // a long run, still one screenful when printed
const VALUE_CAP = 200;    // keep a DOM dump from swallowing the buffer

/** Read the buffer that survived the last navigation. */
function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save(rows) {
    try { sessionStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX))); } catch { /* full or blocked */ }
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
        if (/pass|pwd|secret|token|credential/i.test(k)) { out[k] = v ? `«${String(v).length} chars»` : v; continue; }
        if (v === null || v === undefined) { out[k] = v; continue; }
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        out[k] = maskEmails(text).slice(0, VALUE_CAP);
    }
    return out;
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
        url: location.pathname.slice(-52),
        ...scrub(data),
    };
    const rows = load();
    rows.push(row);
    save(rows);
    console.log(`[Copo Trace] ${row.t} ${step}`, data === undefined ? '' : scrub(data));
    return row;
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
    console.warn('[Copo Trace] copy the line below to share this run:\n'
        + JSON.stringify({ reason, steps: rows }));
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
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
