// AUTO-APPLY RECIPES (extension side). Part of the Copo apply agent.
//
// A per-ATS "recipe" gives the agent exact, verified field selectors so it fills
// the standardized parts of an international apply form DETERMINISTICALLY instead
// of the LLM guessing selectors. The source of truth is the web app
// (/api/apply-recipes, generated from frontend/src/lib/applyRecipes.ts); the
// bundled FALLBACK_RECIPES below is a safety net used when that fetch fails or
// hasn't happened yet — so the agent still works offline / before a deploy.
//
// Scope on purpose: the recipe fills the standardized fields — TEXT inputs AND
// Workday's custom dropdowns (button→listbox) — deterministically. Validation
// recovery and step navigation stay with the LLM planner, which re-observes each
// pass; the recipe re-runs every iteration and is idempotent, so partial progress
// accumulates and already-filled fields are skipped.

import { overlayClick, setFileOnInput, setNativeValue, simulateTyping, sleep, waitForElement } from './dom.js';

// Keep in sync with frontend/src/lib/applyRecipes.ts (WORKDAY). Fields verified
// against real 3M Workday captures (My Information, 2026-07-15 / -22). The
// custom-select handler is grounded in the captured widget markup (button[value]
// + promptOption) but PENDING a live-fill verification.
const FALLBACK_RECIPES = [
    {
        ats: 'workday',
        label: 'Workday',
        version: 3,
        verified: true,
        hostPattern: '\\.myworkdayjobs\\.com|\\.myworkdaysite\\.com',
        login: {
            emailSelector: '[data-automation-id="email"]',
            passwordSelector: '[data-automation-id="password"]',
            signInSelector: '[data-automation-id="signInSubmitButton"]',
            createAccountSelector: '[data-automation-id="createAccountLink"]',
        },
        // Non-form gateway the agent clicks to reach the form. The "Start Your
        // Application" modal renders its options as <a role="button"> (not
        // <button>), which the generic scan misses — so drive it by exact selector.
        // ONLY "Autofill with Resume": the flow always syncs a CV PDF first, and
        // letting Workday parse the résumé pre-fills the tricky required dropdowns
        // (Country/source). "Apply Manually" is intentionally omitted — it skips
        // that pre-fill and leaves every required field to fill by hand.
        gateways: [
            { label: 'Autofill with Resume', detect: '[data-automation-id="autofillWithResume"]', needsCV: true },
        ],
        steps: [
            {
                name: 'My Information',
                detect: '[data-automation-id="formField-legalName--firstName"]',
                fields: [
                    { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true },
                    { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true },
                    { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', type: 'text' },
                    { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', type: 'text' },
                    // Required text input; a résumé never carries it, so autofill leaves
                    // it blank and the step's Next validation blocks. Default to the VN
                    // generic postal code.
                    { label: 'Postal Code', selector: '[data-automation-id="formField-postalCode"] input', value: '100000', type: 'text', required: true },
                    { label: 'Phone number', selector: '[data-automation-id="formField-phoneNumber"] input', profileKey: 'phone', type: 'text', required: true },
                    // Custom Workday dropdowns (button→listbox). Country FIRST — picking it
                    // re-renders the region/postal fields — then Province. `value`/pickAny
                    // satisfy the two required-but-arbitrary dropdowns deterministically so
                    // the step stops depending on the LLM landing them.
                    { label: 'Country', selector: '[data-automation-id="formField-country"] button', profileKey: 'nationality', default: 'Vietnam', type: 'custom-select', required: true },
                    { label: 'Province or City', selector: '[data-automation-id="formField-countryRegion"] button', profileKey: 'addressProvince', type: 'custom-select' },
                    { label: 'How did you hear', selector: '[data-automation-id="formField-source"] button', value: 'Website', pickAny: true, type: 'custom-select', required: true },
                    { label: 'Phone type', selector: '[data-automation-id="formField-phoneType"] button', value: 'Mobile', type: 'custom-select' },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
        ],
        fileUploadSelector: '[data-automation-id="file-upload-input-ref"]',
        submitSelector: '[data-automation-id="pageFooterSubmitButton"]',
        // The final Review step (its "Submit" reuses pageFooterNextButton). When
        // this is on screen the agent STOPS and hands off — it never submits.
        finalStepSelector: '[data-automation-id="applyFlowReviewPage"]',
        thirdPartySkip: ['indeed', 'linkedin'],
    },
];

let _recipes = null; // in-memory cache for this page's lifetime

/**
 * Load the recipe list: background-fetched (cached in storage) if available,
 * otherwise the bundled fallback. Cached in-module so we only ask once per page.
 */
export async function loadRecipes() {
    if (_recipes) return _recipes;
    try {
        const resp = await chrome.runtime.sendMessage({ type: 'GET_APPLY_RECIPES' });
        if (resp?.success && Array.isArray(resp.data?.recipes) && resp.data.recipes.length) {
            _recipes = resp.data.recipes;
            console.log(`[Copo Recipe] loaded ${_recipes.length} recipe(s) from web app${resp.stale ? ' (stale cache)' : ''}`);
            return _recipes;
        }
    } catch (e) {
        console.warn('[Copo Recipe] fetch failed, using bundled fallback:', e?.message);
    }
    _recipes = FALLBACK_RECIPES;
    console.log(`[Copo Recipe] using bundled fallback (${_recipes.length} recipe(s))`);
    return _recipes;
}

/**
 * Click through a non-form gateway (the "Start Your Application" modal, an
 * interstitial "Continue" screen…) that the agent must pass to reach the form.
 * Clicks at most one per call and records it in `clickedCounts` so a gateway that
 * doesn't dismiss can't loop forever (capped at 2). Returns { clicked, label }.
 */
export function clickRecipeGateway(recipe, hasCV, clickedCounts) {
    for (const g of recipe?.gateways || []) {
        if (g.needsCV && !hasCV) continue;
        if ((clickedCounts.get(g.label) || 0) >= 2) continue; // don't loop on a stuck gateway
        let el;
        try { el = document.querySelector(g.detect); } catch { el = null; }
        if (!el || el.offsetParent === null) continue;
        const target = g.click ? document.querySelector(g.click) : el;
        if (!target || target.offsetParent === null) continue;
        overlayClick(target);   // Workday's modal buttons sit under a click_filter overlay
        clickedCounts.set(g.label, (clickedCounts.get(g.label) || 0) + 1);
        console.log(`[Copo Recipe] gateway: clicked "${g.label}"`);
        return { clicked: true, label: g.label };
    }
    return { clicked: false };
}

/** True if the ATS's final review/submit step is on screen — the agent must
 * stop here and let the user submit (never auto-submit an application). */
export function atFinalStep(recipe) {
    if (!recipe?.finalStepSelector) return false;
    try { return !!document.querySelector(recipe.finalStepSelector); } catch { return false; }
}

/** The recipe whose hostPattern matches `url`'s host, or null. */
export function recipeForUrl(recipes, url) {
    if (!Array.isArray(recipes) || !recipes.length) return null;
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { host = String(url || '').toLowerCase(); }
    return recipes.find(r => {
        try { return new RegExp(r.hostPattern, 'i').test(host); } catch { return false; }
    }) || null;
}

/**
 * Deterministically fill the recipe fields for whichever step is on screen.
 *
 * - Idempotent: skips inputs that already hold a value, so it can run every
 *   iteration and naturally goes quiet once the step is filled (returns 0).
 * - Fills TEXT inputs AND Workday's custom dropdowns (button→listbox) — the
 *   required-but-arbitrary ones (Country, "How did you hear", Postal Code) were
 *   the source of the flaky My-Information step when left to the LLM.
 * - NEVER touches a password field and NEVER clicks the final submit; it does
 *   not advance the wizard (the planner owns navigation).
 * - Opportunistically uploads the CV if the step exposes the recipe's file input.
 *
 * @returns {{matched:boolean, filled:number, step?:string}}
 */
export async function applyRecipeFields(recipe, profile, cvData) {
    if (!recipe || !profile) return { matched: false, filled: 0 };

    let filled = 0;

    // Opportunistic CV upload — BEFORE the step check, so it runs on ANY page that
    // renders the recipe's file input, even one with no text-field step. Workday's
    // "Autofill with Resume" page (applyFlowAutoFillPage) has the file input
    // (file-upload-input-ref) but no text step; uploading here lets Workday parse
    // the résumé and pre-fill the later sections. Idempotent: skips an input that
    // already holds a file, so it's safe to re-run every iteration.
    if (cvData?.base64 && cvData?.fileName && recipe.fileUploadSelector) {
        const fileEl = document.querySelector(recipe.fileUploadSelector);
        if (fileEl && fileEl.type === 'file' && !(fileEl.files && fileEl.files.length)) {
            try { if (setFileOnInput(fileEl, cvData.base64, cvData.fileName)) filled++; } catch { /* best effort */ }
        }
    }

    const step = (recipe.steps || []).find(s => s.detect && document.querySelector(s.detect));
    if (!step) return { matched: filled > 0, filled };  // e.g. the autofill upload page: uploaded, no text step

    // Fields are filled in array order (Country BEFORE Province — picking Country
    // re-renders the region field). Custom-selects re-query fresh each pass, so a
    // field that isn't rendered yet is simply retried next iteration.
    for (const f of step.fields || []) {
        const val = recipeFieldValue(f, profile);
        if ((val == null || String(val).trim() === '') && !f.pickAny) continue;
        try {
            if (f.type === 'custom-select') {
                if (await fillCustomSelect(f, val)) {
                    filled++;
                    console.log(`[Copo Recipe] selected ${f.label} = ${val || '(any)'}`);
                }
            } else {
                const el = document.querySelector(f.selector);
                if (!el || el.offsetParent === null) continue;
                if (el.type === 'password') continue;                 // never
                if (String(el.value ?? '').trim() !== '') continue;   // already filled → idempotent
                setNativeValue(el, String(val));
                await sleep(120);
                if (String(el.value ?? '').trim() !== '') {
                    filled++;
                    console.log(`[Copo Recipe] filled ${f.label} (${f.selector})`);
                }
            }
        } catch { /* best effort — LLM will retry */ }
        await sleep(120);
    }

    return { matched: true, filled, step: step.name };
}

/** Resolve a field's value: an explicit fixed `value`, else the synced profile
 *  key, else the recipe `default`. (Postal/how-did-you-hear use fixed values;
 *  Country uses profile.nationality with a "Vietnam" default.) */
function recipeFieldValue(f, profile) {
    if (f.value != null && f.value !== '') return f.value;
    const p = profile[f.profileKey];
    if (p != null && String(p).trim() !== '') return p;
    return f.default ?? '';
}

/**
 * Fill one Workday custom dropdown (button→listbox) deterministically.
 * Idempotent: Workday stores the chosen option's id in the button's `value`
 * attribute, so a non-empty value (incl. an "Autofill with Resume" pre-fill) is
 * skipped. Opens the listbox, type-filters when the field has a search input,
 * then clicks the option matching `value` (exact → contains → first when
 * `f.pickAny`). Leaves the popup CLOSED on a miss so it can't block the next field.
 */
async function fillCustomSelect(f, value) {
    const btn = document.querySelector(f.selector);
    if (!btn || btn.offsetParent === null) return false;
    if ((btn.getAttribute('value') || '').trim()) return false;   // already selected → idempotent
    overlayClick(btn);
    if (!(await waitForElement('[data-automation-id="promptOption"]', 4000))) return false;
    await sleep(150);
    const want = String(value || '').trim().toLowerCase();
    // Long lists (Country) render a type-to-filter input beside the button.
    const filter = btn.parentElement?.querySelector('input[type="text"]');
    if (filter && want) { await simulateTyping(filter, String(value)); await sleep(450); }
    const opts = [...document.querySelectorAll('[data-automation-id="promptOption"]')]
        .filter(o => o.offsetParent !== null);
    const txt = (o) => (o.textContent || '').trim().toLowerCase();
    const opt = (want && opts.find(o => txt(o) === want))
        || (want && opts.find(o => txt(o).includes(want)))
        || (f.pickAny ? opts[0] : null);
    if (!opt) {
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // close, don't block
        return false;
    }
    overlayClick(opt);
    await sleep(250);
    return true;
}
