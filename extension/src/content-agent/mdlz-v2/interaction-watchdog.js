// The multi-pass interaction watchdog: resolve a widget that will not INTERACT
// for several passes RUNNING, so an exhausted OPEN_TIMEOUT / WAITING_HYDRATION /
// BLOCKED_BY_POPUP is not a loop straight to the runtime cap.
//
// "RUNNING" is the whole contract, and it is easy to get wrong two ways:
//   1. a task that DID NOT appear in a pass is no evidence it is still stuck —
//      the page did not even plan it — so its streak is broken and its count
//      dropped, or a field that failed twice, vanished for a pass, then failed
//      once more would be wrongly skipped on that single failure;
//   2. the count lives on `window` (two content-script copies share it) and must
//      NOT survive leaving the page — else a return to My Experience, or a fresh
//      application in the same tab, resumes a stale streak and skips on the first
//      failure. observePageState clears it on a page-NAME change, beside
//      forgetRefusals.

import { INTERACTION_ONLY, RESULT } from './config.js';

const win = () => (typeof window !== 'undefined' ? window : globalThis);
const INTERACTION_STUCK = '__copoV2InteractionStuck';

/** Passes running a widget must refuse to interact before it is resolved —
 *  optional skipped, required escalated. Matched to the outer defer budget so
 *  the two act on the same pass. */
export const INTERACTION_STUCK_PASSES = 3;

/**
 * Fold one pass's ledger into the per-(page, task) stuck counts, and resolve
 * anything that has now been stuck `stuckPasses` passes running: an OPTIONAL
 * field becomes SKIPPED_OPTIONAL (the page completes over it); a REQUIRED one is
 * LEFT as its interaction result for the outer loop to escalate. Mutates
 * `ledger.tasks` and `store` in place; returns the ids newly skipped.
 *
 * `store` is injected (not read from window) so the whole thing is a pure
 * function the tests drive directly — production passes `interactionStore()`.
 */
export function interactionWatchdog(ledger, pageKey, store, stuckPasses = INTERACTION_STUCK_PASSES) {
    const skipped = [];
    const seen = new Set();
    for (const t of ledger?.tasks || []) {
        const key = `${pageKey}::${t.id}`;
        seen.add(key);
        if (INTERACTION_ONLY.has(t.result)) {
            store[key] = (store[key] || 0) + 1;
            if (store[key] >= stuckPasses && t.optional) {
                t.result = RESULT.SKIPPED_OPTIONAL;
                t.stuckInteraction = true;
                skipped.push(t.id);
            }
        } else {
            delete store[key];   // settled / progressed → the streak ended
        }
    }
    // A task ABSENT from this pass is not stuck this pass — the streak is broken.
    // Drop it, scoped to THIS page's keys so another page's counts are untouched.
    const prefix = `${pageKey}::`;
    for (const key of Object.keys(store)) {
        if (key.startsWith(prefix) && !seen.has(key)) delete store[key];
    }
    return skipped;
}

/** The shared store, on window so two content-script copies agree. */
export const interactionStore = () => (win()[INTERACTION_STUCK] || (win()[INTERACTION_STUCK] = {}));

/** A navigation is a clean break: the next page's stuck-counts start at zero.
 *  Called from observePageState on a page-NAME change (beside forgetRefusals) so
 *  leave-and-return and a new application in the same tab both reset. */
export const forgetInteractionStuck = () => { try { win()[INTERACTION_STUCK] = {}; } catch { /* noop */ } };

// ── Anchor-blind adds ────────────────────────────────────────────────────
//
// The OTHER way a section refuses to converge, measured on PwC's Education
// (2026-08-15): the Add COMMITS — a panel of fresh formField-* appears — but the
// planner's anchor recognises nothing in it, so the next pass reads zero rows
// and plans the add again. That is not an interaction failure (the click
// worked), so the watchdog above never sees it; unguarded it is a runaway (39
// rows) or, with the add verified honestly, an add-per-pass livelock. One blind
// add is all the evidence there is: clicking again adds another panel nobody
// will ever fill. The controller drops the section's add on the next pass and
// carries it as a non-blocking gap instead ([[feedback_agent_must_escalate_not_repeat]]).
const ANCHOR_BLIND = '__copoV2AnchorBlindAdds';

/** Sections whose committed Add produced no recognisable row, per section name.
 *  On window for the same two-copies reason as the stuck store. */
export const anchorBlindStore = () => (win()[ANCHOR_BLIND] || (win()[ANCHOR_BLIND] = {}));

/** Cleared beside forgetInteractionStuck on a page-NAME change: a fresh page's
 *  sections deserve a fresh chance to be recognised. */
export const forgetAnchorBlind = () => { try { win()[ANCHOR_BLIND] = {}; } catch { /* noop */ } };
