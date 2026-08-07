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

// ── Pause-when-hidden ──
// Stretched budgets were not enough: run smsik0vk4pw1h46 (PwC, 2026-08-07)
// spent 62 MINUTES in a hidden tab — one list walk took 25 of them under
// intensive throttling — and still learned nothing, because a hidden tab's
// evidence cannot be trusted at any budget. A hidden tab now WAITS instead
// of working: the gate below is awaited at the loop top and inside every
// long widget loop, so the run resumes the moment the tab is looked at.

let _mode = 'manual';   // 'batch' | 'single' | 'manual' — set at trigger time
export function setRunMode(m) { _mode = m; }
export function runMode() { return _mode; }

let _pausedMs = 0;      // total time spent paused — excluded from the run cap
export function pausedMs() { return _pausedMs; }
export function addPausedMs(ms) { _pausedMs += ms; }

let _gate = null;       // index.js installs the actual wait (UI + refocus ask)
export function setPauseGate(fn) { _gate = fn; }
/** Await this at the top of any long loop. No-op when visible or unset. */
export async function pauseGate() {
    if (_gate) await _gate();
}
