/**
 * C3 — moving off a page, as one transaction that cannot half-happen.
 *
 * Advancing is the only action on this flow that is not undoable from inside
 * the flow. Everything else can be re-read, re-verified, corrected on the next
 * pass; a page you have left is gone, and on the LAST page it is an application
 * somebody submitted. So it is the one action written as a transaction:
 *
 *     verify the page is complete
 *  →  close every popup
 *  →  click ONCE
 *  →  lock
 *  →  wait for the old page instance to disappear
 *  →  wait for the new page to be ready
 *  →  unlock
 *
 * The four things it must never do, and why each is a measurement rather than a
 * worry:
 *
 *   NEVER TWICE. Two callers reach this — the loop and a debug step — and they
 *   have collided before: two passes 83ms apart on the same widgets. A double
 *   advance skips a whole page, and the skipped page is never seen again.
 *
 *   NEVER DURING HYDRATION. Workday renders My Experience at 4 fields and then
 *   at 38. Advancing off the first render leaves the second one unfilled.
 *
 *   NEVER BY URL. The URL changes exactly once in this entire flow
 *   (/apply → /apply/autofillWithResume) and then never again, so "did the page
 *   change" cannot be asked of it. The page's own node is the instance: when it
 *   is gone, we left.
 *
 *   NEVER SUBMIT. Workday's review page reuses pageFooterNextButton for Submit.
 *   An advance that does not know which page it is on WILL send the application.
 */

import { RESULT, SEL, STEP } from './config.js';
import { observeStep } from './page-observer.js';
import { READY, observePageState, readiness, releasePage } from './pages.js';
import { ensureClear } from './popup-manager.js';
import { trace } from '../trace.js';

export const NAV = {
    ADVANCED: 'ADVANCED',
    BUSY: 'BUSY',
    INCOMPLETE: 'INCOMPLETE',
    BLOCKED_BY_POPUP: 'BLOCKED_BY_POPUP',
    NOT_SETTLED: 'NOT_SETTLED',
    NO_BUTTON: 'NO_BUTTON',
    REFUSED_FINAL: 'REFUSED_FINAL',
    TIMEOUT: 'TIMEOUT',
};

const napper = (sleep) => sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
const win = () => (typeof window !== 'undefined' ? window : globalThis);

/**
 * The lock lives on `window`, like every other claim here.
 *
 * A module-scoped one guards only the copy of the content script that declares
 * it, and a document can hold two.
 */
const NAV_LOCK = '__copoNavLock';
const NAV_STALE_MS = 60000;

function takeLock() {
    const held = win()[NAV_LOCK];
    if (held && Date.now() - held.at < NAV_STALE_MS) return null;
    const token = { at: Date.now() };
    win()[NAV_LOCK] = token;                 // claimed synchronously — no await above
    return token;
}

function dropLock(token) {
    if (win()[NAV_LOCK] === token) win()[NAV_LOCK] = null;
}

/**
 * The node that IS this page instance.
 *
 * Every page of this flow renders a wrapper carrying its own automation id, and
 * that node is replaced when the wizard moves. Holding it is how "we left" gets
 * answered without asking the URL, which does not move.
 */
export function pageInstance() {
    const ids = ['applyFlowReviewPage', 'applyFlowMyExpPage', 'applyFlowPrimaryQuestionsPage',
        'applyFlowVoluntaryDisclosuresPage', 'applyFlowAutoFillPage'];
    for (const id of ids) {
        const node = document.querySelector(`[data-automation-id="${id}"]`);
        if (node) return { node, id };
    }
    // A page without a wrapper id of its own (My Information): fall back to the
    // step name plus its field count, which changes when the page does.
    return { node: null, id: `${observeStep()}:${document.querySelectorAll('[data-automation-id^="formField-"]').length}` };
}

const gone = (before) => {
    if (before.node) {
        try { return !document.contains(before.node); } catch { return true; }
    }
    return pageInstance().id !== before.id;
};

/** The button, and whether it is one we are allowed to press. */
function advanceButton() {
    const btn = document.querySelector(SEL.nextButton);
    if (!btn) return { btn: null };
    const label = (btn.textContent || '').trim();
    // Belt and braces over the page check: Workday reuses this control for
    // Submit, and a label that says so is a label we stop at whatever page we
    // think we are on.
    const submits = /submit|nộp|send application/i.test(label);
    return { btn, label, submits };
}

/**
 * Leave this page, or say why we did not.
 *
 * `verifyComplete` belongs to the page controller — only it knows what "done"
 * means for its own page — and it is asked BEFORE the click, because a click
 * that lands on an incomplete page produces a wall of validation errors that
 * the next pass then has to read as ours.
 */
export async function advance({
    sleep, verifyComplete = null, budgetMs = 20000, sweepMs = 2400, settleMs = 12000,
} = {}) {
    const nap = napper(sleep);
    const from = observeStep();

    // 1. Never off the last page. Its Next button IS Submit.
    if (from === STEP.REVIEW) {
        trace('mdlz.nav.refused', { from, why: 'review page — its Next is Submit' });
        return { result: NAV.REFUSED_FINAL, from };
    }

    // 2. Never mid-render.
    const ready = await readiness({ sleep, budgetMs: settleMs });
    if (ready.state === READY.HYDRATING) {
        trace('mdlz.nav.refused', { from, why: 'page still hydrating' });
        return { result: NAV.NOT_SETTLED, from };
    }

    // 3. Never while the page is incomplete — the controller decides what that
    //    means, and a page that says nothing is treated as not ready to leave.
    if (verifyComplete) {
        const verdict = await verifyComplete();
        if (!verdict?.complete) {
            trace('mdlz.nav.incomplete', { from, why: verdict?.reason || 'the page is not finished' });
            return { result: NAV.INCOMPLETE, from, reason: verdict?.reason, detail: verdict };
        }
    }

    const token = takeLock();
    if (!token) {
        // Someone is already leaving. A second click here skips a page.
        trace('mdlz.nav.busy', { from });
        return { result: NAV.BUSY, from };
    }

    try {
        // 4. Nothing open over the button. A list left up hit-tests the click as
        //    itself, and the page simply does not move.
        const clear = await ensureClear({ sleep, why: `advance:${from}`, budgetMs: sweepMs });
        if (!clear.ok) {
            trace('mdlz.nav.blocked', { from, orphans: clear.sweep.after.orphans });
            return { result: NAV.BLOCKED_BY_POPUP, from };
        }

        const { btn, label, submits } = advanceButton();
        if (!btn) return { result: NAV.NO_BUTTON, from };
        if (submits) {
            trace('mdlz.nav.refused', { from, why: `the button says "${label}"` });
            return { result: NAV.REFUSED_FINAL, from, label };
        }

        const before = pageInstance();
        // Below the fold, a click hit-tests as whatever covers that point.
        try { btn.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }

        // 5. ONCE. Not in a retry loop, not "again if nothing happened" — a
        //    second press that lands is a page nobody ever saw.
        btn.click();
        trace('mdlz.nav.click', { from, label });

        // 6. The old instance has to go before anything else is believed.
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline && !gone(before)) await nap(150);
        if (!gone(before)) {
            // It did not move. Usually that means validation: the page answered
            // with errors rather than a navigation.
            const errors = [...document.querySelectorAll(SEL.fieldError)]
                .filter((e) => e.offsetParent !== null).map((e) => (e.textContent || '').trim());
            trace('mdlz.nav.timeout', { from, errors: errors.slice(0, 3).join(' | ') || '(none)' });
            return { result: NAV.TIMEOUT, from, errors };
        }

        // 7. And the new page has to be a page before it is handed to anybody.
        releasePage();                       // the claim named the page we just left
        const arrived = await observePageState({ sleep });
        trace('mdlz.nav.advanced', { from, to: arrived.page, state: arrived.state });
        return { result: NAV.ADVANCED, from, to: arrived.page, ready: arrived };
    } finally {
        dropLock(token);
    }
}

/** For a caller that wants the outcome in the scheduler's vocabulary. */
export const navToResult = (nav) => (nav === NAV.ADVANCED ? RESULT.COMMITTED : RESULT.USER_REQUIRED);
