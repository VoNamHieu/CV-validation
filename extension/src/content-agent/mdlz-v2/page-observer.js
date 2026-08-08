/**
 * What page are we on, and is it ready to be touched?
 *
 * Read-only. Nothing here clicks, fills or waits on a fixed timer — it answers
 * two questions and leaves acting to the controller.
 *
 * The readiness question is not decoration. Measured on a re-entry into My
 * Experience: the heading was present while Degree still read "Select One" and
 * the language rows had not hydrated, so a pass that trusted the heading
 * operated on a snapshot that was about to be replaced. And on a clean draft,
 * My Experience first rendered 4 fields and only later the full 38.
 */

import { SEL, STEP, STEP_SIGNALS } from './config.js';

const vis = (el) => !!(el && el.offsetParent !== null);
const seen = (sel) => [...document.querySelectorAll(sel)].some(vis);

/** Which step is on screen, decided by CONTENT (see STEP_SIGNALS for why). */
export function observeStep() {
    for (const rule of STEP_SIGNALS) {
        if (rule.any.some(seen)) return rule.step;
    }
    return STEP.UNKNOWN;
}

/** A cheap fingerprint of the page's shape — changes when the step really moves. */
export function pageFingerprint() {
    try {
        const step = observeStep();
        const req = document.querySelectorAll('[data-automation-id^="formField-"]').length;
        const btn = (document.querySelector(SEL.nextButton)?.textContent || '').trim().slice(0, 24);
        const rows = document.querySelectorAll(SEL.row.jobTitle).length;
        return `${step}|${req}|${rows}|${btn}`;
    } catch {
        return `unknown|${Date.now()}`;
    }
}

/**
 * Ready = the shape has stopped moving.
 *
 * Two consecutive identical fingerprints separated by a quiet interval, with no
 * visible Loading marker. This replaces "the heading appeared, go" — which is
 * what let v1 add a Work Experience row into a page that was still hydrating.
 */
export async function waitPageReady({ quietMs = 600, budgetMs = 12000, sleep } = {}) {
    const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() < deadline) {
        const loading = [...document.querySelectorAll('[data-automation-id*="loading" i], [aria-busy="true"]')].some(vis);
        const fp = pageFingerprint();
        if (!loading && last === fp) {
            return { ready: true, step: observeStep(), fingerprint: fp };
        }
        last = loading ? null : fp;
        await nap(quietMs);
    }
    return { ready: false, step: observeStep(), fingerprint: pageFingerprint(), reason: 'page never settled' };
}

/**
 * Every listbox currently open on the page, and which trigger owns it.
 *
 * The measurement this exists for: clicking Degree found 39 options on the
 * page, of which 20 belonged to Skills — whose popup had never been closed.
 * The false "Degree did not open" that followed, and the calendar that
 * "did not open" before it, were both that popup sitting in the way.
 */
export function openPopups() {
    const out = [];
    const triggers = [...document.querySelectorAll('[aria-expanded="true"]')].filter(vis);
    for (const t of triggers) {
        const id = t.getAttribute('aria-controls') || t.getAttribute('aria-owns');
        const list = id ? document.getElementById(id) : null;
        const options = list
            ? [...list.querySelectorAll(SEL.option)].filter(vis).length
            : 0;
        out.push({
            trigger: t,
            listbox: list,
            options,
            ownerField: t.closest('[data-automation-id^="formField-"]')?.getAttribute('data-automation-id') || null,
        });
    }
    return out;
}

/** Options visible on the page that no open trigger claims — pure leftovers. */
export function orphanOptionCount() {
    const claimed = new Set();
    for (const p of openPopups()) {
        if (p.listbox) [...p.listbox.querySelectorAll(SEL.option)].forEach((o) => claimed.add(o));
    }
    return [...document.querySelectorAll(SEL.option)]
        .filter(vis)
        .filter((o) => !claimed.has(o))
        .filter((o) => o.getAttribute('data-automation-id') !== 'selectedItem')
        .filter((o) => !o.closest(SEL.selectedItemList))
        .length;
}
