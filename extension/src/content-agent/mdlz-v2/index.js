/**
 * MDLZ v2 — entry point. Milestone 0: it observes, it never acts.
 *
 * The flag is OFF unless storage says otherwise, and even when ON this
 * milestone only reports what it sees. That is deliberate: the way v1 got into
 * trouble was shipping behavior faster than it could be measured, and the
 * first thing v2 has to prove is that it reads the page correctly — before it
 * is allowed to touch one.
 *
 * Ownership rule, from the moment v2 does act: on a given page instance either
 * v1 or v2 owns the DOM, never both. Two owners writing the same widget, each
 * verifying against state the other had just changed, is the disorder v2
 * exists to end.
 */

import { FLAG_KEY, RESULT, isMdlzPage } from './config.js';
import { observeStep, openPopups, orphanOptionCount, pageFingerprint, waitPageReady } from './page-observer.js';
import { trace } from '../trace.js';

/** Is v2 allowed to run here? Storage flag AND an mdlz page. */
export async function mdlzV2Enabled() {
    if (!isMdlzPage()) return false;
    try {
        const d = await new Promise((r) => chrome.storage.local.get(FLAG_KEY, r));
        return d?.[FLAG_KEY] === true;
    } catch {
        return false;
    }
}

/**
 * One observation pass. Returns what v2 believes about this page — and, for
 * Milestone 0, that is all it does.
 *
 * The popup figures are the ones that matter first: `orphanOptions` above zero
 * means a previous field left its list open, which measured on the live form
 * as a Degree that "would not open" and a calendar that "did not open" while
 * twenty Skills options sat over them.
 */
export async function observeOnly({ sleep } = {}) {
    const ready = await waitPageReady({ sleep });
    const popups = openPopups();
    const report = {
        step: ready.step,
        ready: ready.ready,
        fingerprint: pageFingerprint(),
        openPopups: popups.length,
        popupOwners: popups.map((p) => p.ownerField || '(portal)').join(',') || '(none)',
        orphanOptions: orphanOptionCount(),
    };
    trace('mdlz.page.observe', report);
    return report;
}

/**
 * The controller v1 will eventually hand the page to. Not yet: this returns
 * "not taking it" so the existing path continues untouched, and the flag being
 * on costs one observation per pass.
 */
export async function runMdlzV2(ctx = {}) {
    if (!(await mdlzV2Enabled())) return { took: false, reason: 'flag off' };
    await observeOnly(ctx);
    return { took: false, reason: 'milestone-0: observation only', result: RESULT.SKIPPED_OPTIONAL };
}
