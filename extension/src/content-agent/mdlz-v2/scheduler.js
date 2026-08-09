/**
 * One task at a time, on a page that is clear before each one starts.
 *
 * Two things go wrong on this form when work overlaps, and both are measured.
 *
 * ACROSS PASSES: two "My Experience" summaries 83ms apart reported opposite
 * verdicts for the same fields — one had the proficiency list as
 * option-not-found (42 shown), the other had it filled. Neither field was
 * broken. Each pass clears stray popups by design, and the other pass's open
 * list looks exactly like a stray, so they were closing each other's widgets and
 * then reporting on the wreck.
 *
 * WITHIN A PASS: a grow loop that read its work list once and never recomputed
 * it, with concurrent fills putting the same language into different rows, is
 * how a form acquired three "Vietnamese" rows and a red "Duplicate language
 * entries are not allowed."
 *
 * The response is not a smarter merge; it is a scheduler that never has two
 * things in flight. Serial is also what makes a leak ATTRIBUTABLE: if the page
 * has an orphan list after task N, task N left it, and no argument about
 * interleaving is available.
 *
 * The second job here is to stop spending semantic effort on interaction
 * failures. Degree burned 9–11 seconds of model time per pass on a field whose
 * popup was merely covered by Skills' — the value was never in doubt. So an
 * INTERACTION_ONLY outcome buys a cheap retry from a separate budget and never
 * reaches a model; a semantic outcome is terminal here and is escalated intact.
 */

import { INTERACTION_ONLY, LOCK_STALE_MS, PAGE_LOCK, RESULT } from './config.js';
import { pageFingerprint, waitPageReady } from './page-observer.js';
import { census, ensureClear, isClear } from './popup-manager.js';
import { trace } from '../trace.js';

const napper = (sleep) => sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
const win = () => (typeof window !== 'undefined' ? window : globalThis);

/**
 * Read a task's answer as an outcome.
 *
 * A task may return a RESULT, or an object carrying one, or the plain
 * `{ ok }` shape the rest of the extension speaks. What it may NOT do is have
 * its crash guessed at: a throw is COMMIT_FAILED — terminal — because retrying
 * an unknown exception is the retry that runs a half-committed widget twice.
 */
export function outcomeOf(value) {
    if (typeof value === 'string' && RESULT[value]) return { result: value };
    if (value && typeof value === 'object') {
        if (typeof value.result === 'string' && RESULT[value.result]) return { result: value.result, detail: value };
        if (value.ok === true) return { result: RESULT.COMMITTED, detail: value };
        if (value.ok === false) return { result: RESULT.COMMIT_FAILED, detail: value };
    }
    return { result: RESULT.SATISFIED, detail: value };
}

/** Claim the page. Returns null when someone else already holds it. */
function claim() {
    const w = win();
    const held = w[PAGE_LOCK];
    if (held && Date.now() - held.at < LOCK_STALE_MS) return null;
    if (held) trace('mdlz.sched.lockStale', { heldForMs: Date.now() - held.at });
    const token = { at: Date.now(), by: 'mdlz-v2' };
    w[PAGE_LOCK] = token;                       // claimed synchronously — no await above
    return token;
}

function release(token) {
    const w = win();
    // Only ever release OUR claim: a stale takeover means someone else owns the
    // page now, and clearing it blindly hands it to a third pass.
    if (w[PAGE_LOCK] === token) w[PAGE_LOCK] = null;
}

/**
 * Run `tasks` in order, alone.
 *
 * Between tasks the page must be SETTLED and CLEAR, in that order — settled
 * first because a sweep of a half-hydrated page clears widgets that are about to
 * be replaced anyway, and clear second because that is the state in which the
 * next task's click can be said to own what it opens.
 *
 * The run HALTS if the page cannot be cleared. Continuing would mean opening a
 * widget under someone else's list, which is the exact condition every false
 * "did not open" in v1 came from — and a scheduler that pushes on through it is
 * just a faster way to produce wrong verdicts.
 */
export async function runSequential(tasks, {
    sleep,
    readyMs = 12000,
    quietMs = 600,
    sweepMs = 2400,
    interactionAttempts = 2,
} = {}) {
    const nap = napper(sleep);
    const list = (tasks || []).filter(Boolean);
    const token = claim();
    if (!token) {
        trace('mdlz.sched.busy', { tasks: list.length });
        return { ok: false, busy: true, reason: 'another pass owns this page', tasks: [], sweeps: 0, leaks: 0 };
    }

    const ledger = { ok: true, busy: false, halted: null, tasks: [], sweeps: 0, leaks: 0, clean: false };
    let settledAt = null;                       // the fingerprint we last waited out

    try {
        for (const task of list) {
            const id = task.id || task.label || `task#${ledger.tasks.length + 1}`;
            // `optional` rides along because only the PLAN knows whether the
            // employer asked for this field, and only the LEDGER is read when
            // deciding whether the page is finished.
            const row = { id, optional: !!task.optional, result: null, attempts: 0, interaction: 0, leaked: 0, ms: 0, notes: [] };
            const t0 = Date.now();

            for (;;) {
                row.attempts += 1;

                // Settle — but only when the page has actually moved since the
                // last time we waited it out. A blanket 2×600ms before every
                // field is over a second per field on a step with 38 of them,
                // paid for nothing when nothing re-rendered.
                const fp = pageFingerprint();
                if (fp !== settledAt) {
                    const ready = await waitPageReady({ sleep, quietMs, budgetMs: readyMs });
                    if (!ready.ready) {
                        row.notes.push('page never settled');
                        if (row.interaction < interactionAttempts) { row.interaction += 1; await nap(quietMs); continue; }
                        row.result = RESULT.WAITING_HYDRATION;
                        break;
                    }
                    settledAt = ready.fingerprint;
                }

                const clear = await ensureClear({ sleep, why: `before:${id}`, budgetMs: sweepMs });
                ledger.sweeps += 1;
                if (!clear.ok) {
                    row.notes.push(`blocked by ${clear.sweep.after.orphans} orphan option(s)`);
                    if (row.interaction < interactionAttempts) { row.interaction += 1; await nap(quietMs); continue; }
                    row.result = RESULT.BLOCKED_BY_POPUP;
                    ledger.halted = `page could not be cleared before ${id}`;
                    break;
                }

                let outcome;
                try {
                    outcome = outcomeOf(await task.run({ sleep, id }));
                } catch (e) {
                    outcome = { result: RESULT.COMMIT_FAILED, detail: { reason: e?.message || String(e) } };
                    row.notes.push(`threw: ${e?.message || e}`);
                }

                // Measure the leak BEFORE cleaning it up, or the number that
                // says whether a task closes after itself never exists.
                const after = census();
                if (!isClear(after)) {
                    row.leaked = after.orphans;
                    ledger.leaks += 1;
                    trace('mdlz.sched.leak', { task: id, orphans: after.orphans, lists: after.lists, owners: after.owners.join(',') });
                    const cleanup = await ensureClear({ sleep, why: `after:${id}`, budgetMs: sweepMs });
                    ledger.sweeps += 1;
                    if (!cleanup.ok) ledger.halted = `page could not be cleared after ${id}`;
                }

                row.result = outcome.result;
                row.detail = outcome.detail;
                if (INTERACTION_ONLY.has(outcome.result) && row.interaction < interactionAttempts && !ledger.halted) {
                    // Cheap budget, and it never reaches a model: the value was
                    // never the problem, the page was.
                    row.interaction += 1;
                    row.notes.push(`interaction retry after ${outcome.result}`);
                    await nap(quietMs);
                    continue;
                }
                break;
            }

            row.ms = Date.now() - t0;
            ledger.tasks.push(row);
            trace('mdlz.sched.task', {
                task: id, result: row.result, attempts: row.attempts,
                interaction: row.interaction, leaked: row.leaked, ms: row.ms,
            });
            if (ledger.halted) break;
        }
    } finally {
        release(token);
    }

    ledger.clean = isClear();
    ledger.ok = !ledger.halted;
    trace('mdlz.sched.done', {
        tasks: ledger.tasks.length, sweeps: ledger.sweeps, leaks: ledger.leaks,
        clean: ledger.clean, halted: ledger.halted || '(none)',
    });
    return ledger;
}
