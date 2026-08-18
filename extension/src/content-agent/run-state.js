/**
 * Cross-cutting state of THIS run, shared by the loop (index.js) and the long
 * field work (recipe.js). Its own module so the two can read it without
 * importing each other.
 *
 * Two concerns live here, both born from the 2026-08-07 double-run traces:
 *
 * · stop — the background abandons a job (watchdog, user closed the tab, batch
 *   moved on) but the page's agent used to keep driving a now-hidden tab for
 *   another 11 minutes, burning LLM calls, its results refused as 'stale tab'.
 *   The background now SAYS so (AGENT_STOP), and every long loop checks here.
 *
 * · hiddenMult — a hidden tab still runs, but Chrome clamps its timers to ≥1s
 *   and delays the page's own rendering, so Workday commits a click ~1s+ after
 *   the agent's fixed verify window has already expired. Measured on PwC
 *   "How Did You Hear": the same click on the same row read as no-effect four
 *   times hidden and drilled in the one pass where the render landed in time.
 *   Verify BUDGETS therefore stretch when the document is hidden — the work
 *   isn't slower, the evidence just arrives later.
 */

let _stop = null;   // { why } once the background has abandoned this run

export function requestStop(why) {
    if (!_stop) _stop = { why: why || 'stopped' };
}

export function stopRequested() {
    return _stop;
}

/** Multiplier for verify/settle budgets. 1 when visible; stretched when the
 *  tab is hidden so late-but-real evidence isn't misread as no-effect. */
export function hiddenMult() {
    try {
        return typeof document !== 'undefined' && document.hidden ? 4 : 1;
    } catch {
        return 1;   // non-browser (policy unit tests) → no stretching
    }
}

// ── NO pause-on-hidden ──
// A pause-while-hidden behavior shipped here on 2026-08-07 and was rejected
// by the user the same day, in plain words: the agent EXISTS to work while
// they are elsewhere. Hidden tabs work — their clock borrows the background
// worker's (see sleep() in dom.js), the driven page opens in its own small
// window so it is rarely occluded, and hiddenMult above covers the rendering
// that genuinely lags. pauseGate remains as an inert seam (call sites in the
// long widget loops cost nothing) in case an OPT-IN pause is ever wanted;
// nothing installs a gate.

let _mode = 'manual';   // 'batch' | 'single' | 'manual' — set at trigger time
export function setRunMode(m) { _mode = m; }
export function runMode() { return _mode; }

let _gate = null;       // never set in production — see above
export function setPauseGate(fn) { _gate = fn; }
/** Inert unless a gate is explicitly installed. */
export async function pauseGate() {
    if (_gate) await _gate();
}
