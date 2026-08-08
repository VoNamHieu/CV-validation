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
 * finish — and then v1 runs exactly as it always has. Behind a storage flag that
 * is off by default, so shipping this changes nothing until it is turned on.
 *
 * The try/catch is the point of the wrapper: a fault in v2 must cost this pass
 * and nothing else. A page that v2 breaks would be a page v1 never got to try.
 */
export const applyRecipeFields = async (recipe, profile, cvData, cv) => {
    try {
        rememberCv(cv);                       // so copoMdlzPreflight() can be asked for on demand
        const v2 = await runMdlzV2({ recipe, profile, cvData, cv });
        if (v2?.took) return v2.report;
        if (v2?.reason && v2.reason !== 'flag off') {
            console.log(`[Copo mdlz-v2] handing back to v1: ${v2.reason}`);
        }
    } catch (e) {
        console.warn('[Copo mdlz-v2] stood down after an error — v1 takes the pass:', e?.message || e);
    }
    return impl.applyRecipeFields(recipe, profile, cvData, cv);
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
