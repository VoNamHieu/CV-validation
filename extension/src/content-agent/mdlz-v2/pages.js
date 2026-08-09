/**
 * C0 — which page this is, whether it can be touched, and who owns it.
 *
 * The core underneath every page controller. Not a generic Workday layer: it
 * serves the six states measured on THIS tenant, and it exists so that the
 * things which must be true everywhere are true in one place instead of six.
 *
 * Three questions, and nothing else lives here:
 *
 *   WHICH PAGE. By the page's own id first, because that id is rendered before
 *   any field is. A recogniser that needs a field cannot see an empty draft, and
 *   an unseen page is a page something else gets to act on.
 *
 *   IS IT SETTLED, AND IS IT EMPTY. Two different questions that one boolean
 *   was answering badly. A bare draft is READY — there is simply nothing on it
 *   yet — and the controller that treats "empty" as "not ready" waits out a page
 *   that was never going to change, then hands it to whoever is less careful.
 *
 *   WHO OWNS IT. One owner per page instance. While v2 owns a page, nothing
 *   else may click on it: not v1, not the generic recipe, not the planner. That
 *   is enforced at the click choke point rather than by asking each of them
 *   nicely — a rule that depends on every caller remembering it is not a rule.
 */

import { STEP } from './config.js';
import { observeStep, pageFingerprint, vis } from './page-observer.js';
import { trace } from '../trace.js';

/** The six, plus the one that means "not one of them". */
export const PAGE = STEP;

/**
 * Pages v2 owns today.
 *
 * The migration is per page: a page in this set is v2's, whole, and a page
 * outside it stays v1's, whole. Nothing is ever shared. Adding a name here is
 * the entire act of porting a page — everything else about ownership follows
 * from it mechanically.
 */
export const V2_OWNED_STEPS = new Set([
    PAGE.AUTOFILL,
    PAGE.MY_INFORMATION,
    PAGE.MY_EXPERIENCE,
    PAGE.APPLICATION_QUESTIONS,
    PAGE.VOLUNTARY_DISCLOSURES,
    // Review is owned precisely BECAUSE nothing may act on it: owning the page
    // is what makes the click choke point refuse v1, the generic recipe and the
    // planner as well. The page whose one button submits is the last page to
    // leave to whoever remembered.
    PAGE.REVIEW,
]);

export const owns = (page) => V2_OWNED_STEPS.has(page);

// ── readiness ────────────────────────────────────────────────────────────

export const READY = {
    HYDRATING: 'HYDRATING',
    EMPTY_READY: 'EMPTY_READY',
    POPULATED_READY: 'POPULATED_READY',
};

const loadingVisible = () => {
    try {
        return [...document.querySelectorAll('[data-automation-id*="loading" i], [aria-busy="true"]')].some(vis);
    } catch { return false; }
};

const fieldCount = () => {
    try { return document.querySelectorAll('[data-automation-id^="formField-"]').length; } catch { return 0; }
};

/**
 * Settled, and settled into WHAT.
 *
 * Settled is two identical fingerprints across a quiet interval with no loading
 * marker — the same test as before, because a heading appearing is not a page
 * arriving (measured: My Experience first rendered 4 fields and later 38, and a
 * pass that trusted the heading operated on a snapshot about to be replaced).
 *
 * What is new is the answer when it settles empty. A page with no fields is not
 * broken and not slow; it is a fresh draft, and it is the state in which "Add
 * Another" is the only thing there is to do.
 */
export async function readiness({ sleep, quietMs = 600, budgetMs = 12000 } = {}) {
    const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() < deadline) {
        const loading = loadingVisible();
        const fp = pageFingerprint();
        if (!loading && last === fp) {
            const fields = fieldCount();
            return {
                state: fields > 0 ? READY.POPULATED_READY : READY.EMPTY_READY,
                page: observeStep(),
                fields,
                fingerprint: fp,
            };
        }
        last = loading ? null : fp;
        await nap(quietMs);
    }
    return {
        state: READY.HYDRATING,
        page: observeStep(),
        fields: fieldCount(),
        fingerprint: pageFingerprint(),
        reason: 'the page never settled',
    };
}

export const isReady = (r) => r?.state === READY.EMPTY_READY || r?.state === READY.POPULATED_READY;

// ── ownership ────────────────────────────────────────────────────────────

/**
 * The claim lives on `window`, and says which PAGE it covers.
 *
 * Not in module scope, for the reason v1 already measured: a document can hold
 * two copies of the content script (declarative injection plus a programmatic
 * re-inject after a redirect), and a module-scoped claim guards only the copy
 * that declares it. The page name is part of the claim so a stale one cannot
 * silence the next page — a claim for My Experience means nothing once the
 * wizard has moved on.
 */
export const CLAIM = '__copoPageOwner';
const CLAIM_STALE_MS = 120000;

const win = () => (typeof window !== 'undefined' ? window : globalThis);

/** Take the page for v2. Returns the claim, or null when it is not v2's to take. */
export function claimPage(page) {
    if (!owns(page)) { releasePage(); return null; }
    const claim = { owner: 'mdlz-v2', page, at: Date.now() };
    win()[CLAIM] = claim;
    return claim;
}

export function releasePage() {
    try { win()[CLAIM] = null; } catch { /* nothing to release */ }
}

/**
 * The page we last observed, so a change can clear what was learned on the old
 * one. A refusal ("this catalogue does not hold Vietnam") is true of a page, not
 * of the flow.
 */
let _lastPage = null;

/**
 * Who owns the page ON SCREEN right now.
 *
 * A claim that names a different page than the one rendered is not a claim any
 * more — the wizard advanced and nobody released it. Same for one older than
 * any real pass. Both read as unowned rather than as v2's, because a stale claim
 * that silences v1 would leave a page with NO owner at all, which is worse than
 * the collision it was meant to prevent.
 */
export function pageOwner(pageNow = null) {
    const held = win()[CLAIM];
    if (!held) return null;
    if (Date.now() - held.at > CLAIM_STALE_MS) return null;
    const page = pageNow || observeStep();
    if (held.page !== page) return null;
    return held.owner;
}

/**
 * The question the click choke point asks: may THIS caller act here?
 *
 * Everything that is not v2 is refused while v2 holds the page. v2's own
 * executors do not come through here — they drive the widgets directly — so
 * this cannot lock v2 out of its own page.
 *
 * There is no longer an exception for the page footer Next button. There was
 * one while v2 could fill a page but not leave it; C3 gave it the navigation
 * transaction, so the last reason for anybody else to click here is gone. A
 * page v2 owns that does not advance is a page v2 says is not finished — and
 * pressing Next on it would only produce the validation wall that v1 would then
 * have to read as ours.
 */
export function mayActivate(source) {
    const owner = pageOwner();
    if (!owner) return true;
    return source === 'mdlz-v2';
}

/** One line, for a trace that has to explain why a click did not happen. */
export function ownershipNote() {
    const held = win()[CLAIM];
    return held ? `${held.owner} owns ${held.page}` : 'unowned';
}

/**
 * What v2 believes about this page, before it decides anything.
 *
 * Deliberately cheap and side-effect free apart from the claim: page, readiness,
 * and whether this is one of ours. Every controller starts here.
 */
export async function observePageState(ctx = {}) {
    const r = await readiness(ctx);
    if (_lastPage && _lastPage !== r.page) {
        _lastPage = r.page;
        try { (await import('./executors.js')).forgetRefusals(); } catch { /* noop */ }
    } else { _lastPage = r.page; }
    const ours = owns(r.page);
    if (ours) claimPage(r.page); else releasePage();
    const state = { ...r, owner: ours ? 'mdlz-v2' : 'v1' };
    trace('mdlz.page', {
        page: state.page, state: state.state, fields: state.fields, owner: state.owner,
    });
    return state;
}
