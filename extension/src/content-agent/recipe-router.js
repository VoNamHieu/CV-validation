/**
 * Tenant router for the fill machinery — snapshot-first, per the user's rule
 * (2026-08-07): a tenant that WINS gets its version recorded and locked;
 * cleaning things into the generic comes after, never at the winner's risk.
 *
 * mdlz pages run the frozen copy (recipe-mdlz-v1.js, byte-identical to the
 * code mdlz won with). Every other tenant runs the live generic (recipe.js),
 * which is where all future fixes land. A generic improvement reaches a
 * locked tenant only by an explicit re-snapshot the user asks for.
 *
 * The tenant is decided per page load — a content script lives and dies with
 * one document, so the choice cannot flip mid-run. Module state (field
 * status, written-value memory) lives inside whichever implementation is
 * chosen and never crosses the boundary.
 */

import * as generic from './recipe.js';
import * as mdlzV1 from './recipe-mdlz-v1.js';
import { rememberCv, runMdlzV2 } from './mdlz-v2/index.js';
import { pageOwner } from './mdlz-v2/pages.js';
import { DEVELOPER_FATAL, isPageBlockingTask } from './mdlz-v2/config.js';

const LOCKED = [
    {
        key: 'mdlz-v1',
        test: () => /(^|\.)myworkdaysite\.com$/i.test(location.hostname)
            && /\/mdlz\//i.test(location.pathname),
        impl: mdlzV1,
    },
];

function pick() {
    try {
        for (const t of LOCKED) if (t.test()) return t.impl;
    } catch { /* non-browser (tests import recipe.js directly) */ }
    return generic;
}
const impl = pick();
/** Which locked snapshot is driving this page, if any. Span tracking keys on
 *  it: the timing instrumentation is for the tenant being tuned, and other
 *  tenants' traces stay exactly as they were. */
export const LOCKED_TENANT = LOCKED.find(t => t.impl === impl)?.key || null;
try {
    if (impl !== generic) console.log(`%c[Copo] tenant-locked recipe active: ${LOCKED_TENANT}`, 'color:#7c3aed;font-weight:700');
} catch { /* noop */ }

/**
 * The one place v2 is offered the page.
 *
 * It is offered, not given: `runMdlzV2` returns took:false for every step it
 * does not own, for a résumé v1 has yet to upload, and for any section it cannot
 * finish — and then v1 runs exactly as it always has. The flag now DEFAULTS ON
 * for mdlz (2026-08-10) and v2 owns the WHOLE deterministic flow, so on this
 * tenant v1's fill path no longer runs at all: what remains of v1 here is the
 * recipe config — its gateways — read as data, plus the one escape hatch,
 * `chrome.storage.local.set({ copoMdlzV2: false })`.
 *
 * The try/catch is the point of the wrapper: a fault in v2 must cost this pass
 * and nothing else. A page that v2 breaks would be a page v1 never got to try.
 */
/**
 * What happens after v2 has had its say — as a decision, so it can be checked.
 *
 * The rule that makes the migration safe is a NEGATIVE one, and negatives are
 * the easy thing to get wrong by accident: on a page v2 owns, v1 never runs.
 * Not when v2 declined the page, and not when v2 CRASHED on it — handing over a
 * half-written widget puts two owners on it, each verifying against state the
 * other left behind, which is the exact disorder the split exists to end.
 */
/**
 * Everything on this page that stops it being finished, from BOTH places v2
 * records them.
 *
 * The bug this exists for: a page's semantic gaps rode on `v2.gaps` while a
 * field that failed its own transaction sat in `v2.ledger.tasks`, and the
 * caller read only the first — so Country coming back OPTION_NOT_FOUND was
 * invisible to the loop that had to decide whether the step could advance.
 * One list, both sources, one shape.
 */
export function blockersFrom(v2) {
    const out = [];
    for (const g of v2?.gaps || []) {
        out.push({
            label: g.label || g.field || g.key || g.id || '?',
            why: g.why || g.reason || 'needs the candidate',
            source: 'gap',
        });
    }
    for (const t of v2?.ledger?.tasks || []) {
        const r = t.result || t.status;
        // ONE canonical question — the same predicate pageComplete/quiet and the
        // outer loop's escalation budget use, so no two layers can disagree about
        // whether this task blocks the page. An OPTIONAL field's forgivable miss
        // (Skills the catalogue cannot answer) is NOT a blocker — the page
        // completes over it, so it must not bump the escalation streak either. A
        // CONTRACT_ERROR always is, and it is the DEVELOPER'S: tag it so the
        // handoff names the internal contract, never the candidate's data.
        if (!isPageBlockingTask({ result: r, optional: t.optional })) continue;
        out.push({
            label: t.id || t.field || '?',
            why: t.reason ? `${r}: ${t.reason}` : r,
            source: 'task',
            developer: DEVELOPER_FATAL.has(r),
        });
    }
    return out;
}

export function routeAfterV2(v2, error = null) {
    const owned = !!v2?.pageIsV2Owned;
    if (v2?.took && !error) {
        // The verdict travels WHOLE. Handing on `v2.report` alone dropped the
        // gaps and the ledger on the floor — three shapes between controller
        // and loop, each losing a piece.
        return {
            useV1: false,
            result: { ...v2.report, gaps: v2.gaps || [], ledger: v2.ledger || null, blockers: blockersFrom(v2) },
        };
    }
    if (error) {
        if (owned) {
            return {
                useV1: false,
                result: { matched: false, filled: 0, error: `mdlz-v2: ${error.message || error}`, v2: true },
            };
        }
        return { useV1: true };
    }
    // Declined ON A PAGE IT OWNS means "not yet" — not ready, not answerable —
    // and never "free for somebody else".
    if (owned) return { useV1: false, result: { matched: false, filled: 0, v2: true, deferred: true } };
    return { useV1: true };
}

export const applyRecipeFields = async (recipe, profile, cvData, cv) => {
    let decision = { useV1: true };
    try {
        rememberCv(cv);                       // so copoMdlzPreflight() can be asked for on demand
        const v2 = await runMdlzV2({ recipe, profile, cvData, cv });
        decision = routeAfterV2(v2);
        if (!v2?.took && v2?.reason && v2.reason !== 'flag off') {
            console.log(`[Copo mdlz-v2] ${v2.pageIsV2Owned ? 'owns this page but stood down' : 'handing back to v1'}`
                + `: ${v2.reason}`);
        }
    } catch (e) {
        // The claim on `window` outlives the crash that took the return value
        // with it — and it is the same record the click choke point reads.
        decision = routeAfterV2({ pageIsV2Owned: pageOwner() === 'mdlz-v2' }, e);
        if (decision.useV1) console.warn('[Copo mdlz-v2] stood down after an error — v1 takes the pass:', e?.message || e);
        else console.error('[Copo mdlz-v2] failed on a page it owns — v1 will NOT take over:', e?.message || e);
    }
    return decision.useV1 ? impl.applyRecipeFields(recipe, profile, cvData, cv) : decision.result;
};

export const atFinalStep = impl.atFinalStep;
export const clickRecipeGateway = impl.clickRecipeGateway;
export const FIELD_FAIL_BUDGET = impl.FIELD_FAIL_BUDGET;
export const fillResolvedDate = impl.fillResolvedDate;
export const inferFillDynamicField = impl.inferFillDynamicField;
export const loadRecipes = impl.loadRecipes;
export const recipeBlockingFields = impl.recipeBlockingFields;
export const recipeForUrl = impl.recipeForUrl;
export const recipeOwnedWrappers = impl.recipeOwnedWrappers;
export const recipeReleased = impl.recipeReleased;
export const resetFieldStatus = impl.resetFieldStatus;
export const recipeFieldStatus = impl.recipeFieldStatus;
