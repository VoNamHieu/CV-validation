// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { APPLY_BUTTON_TEXTS, DENY_HOST_SUFFIXES, JOB_CONTEXT_KEYWORDS, JOB_PAGE_DETECT_POLL_MS, JOB_PAGE_DETECT_TIMEOUT_MS, JOB_URL_KEYWORDS } from './constants.js';

// "Apply with Indeed / LinkedIn / Google" style shortcuts hand the application
// off to a THIRD-PARTY provider (a foreign login / different form) instead of the
// employer's own form. Clicking one derails auto-apply into a redirect/login loop
// (the exact "reload + click lung tung" symptom). Detect them so BOTH the apply
// hunt and the action list skip them.
export function isThirdPartyApply(el) {
    if (!el) return false;
    const t = (el.textContent || '').toLowerCase();
    const href = ((el.getAttribute && el.getAttribute('href')) || '').toLowerCase();
    // Third-party = a KNOWN external provider (Indeed/LinkedIn/…) named next to an
    // apply / sign-in verb, or a link straight to that provider. It is NOT enough
    // to say "apply with …": "Apply with CV / resume / profile / your CV / email"
    // is the EMPLOYER's own form and must be clicked — those name no provider.
    const PROVIDER = /indeed|linkedin|glassdoor|ziprecruiter/;
    if (PROVIDER.test(t) && /(apply|sign\s*in|log\s*in|continue|đăng nhập)/.test(t)) return true;
    if (/indeed\.com|linkedin\.com\/(oauth|uas|checkpoint)|glassdoor\.com|ziprecruiter\.com/.test(href)) return true;
    return false;
}

// Are we already ON an application form? (Several visible fillable fields, or an
// apply-mode URL with at least one.) If so the agent must fill DIRECTLY and NOT
// hunt for an "Apply" button — on a form page that hunt matches a third-party
// shortcut and loops. Search forms rarely have 3+ fillable fields, so this
// doesn't false-positive on a listing page's "search jobs" box.
export function isApplicationFormPage() {
    const u = location.href.toLowerCase();
    const urlApply = /[?&]apply=|\/apply(\/|$|\?|#)|\/application|applicationform|jobapplication/.test(u);
    const fields = [...document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
        'input[type="number"], input:not([type]), textarea, select, input[type="file"]'
    )].filter(el => el.offsetParent !== null);
    return fields.length >= 3 || (urlApply && fields.length >= 1);
}

export function findApplyButton() {
    const applyTexts = [
        'ứng tuyển', 'apply', 'nộp đơn', 'apply now',
        'ứng tuyển ngay', 'nộp hồ sơ', 'apply for this job',
        'quick apply', 'easy apply',
    ];

    const byClass = document.querySelector(
        '[class*="apply" i]:not(nav *), [class*="btn-apply" i], ' +
        'a[href*="apply"], button[data-action*="apply"]'
    );
    if (byClass && byClass.offsetParent && !isThirdPartyApply(byClass)) return byClass;

    const allClickables = document.querySelectorAll('button, a, [role="button"]');
    for (const el of allClickables) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (applyTexts.some(t => text.includes(t)) && el.offsetParent && !isThirdPartyApply(el)) {
            return el;
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Agentic Loop
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a compact summary of page state for history tracking.
 */
export function summarizeState(state) {
    return {
        url: state.url,
        fieldCount: state.formFields.length,
        unfilled: state.unfilledRequired.length,
        errors: state.errors.length,
        blockers: (state.blockers || []).map(b => b.type),
        step: state.stepIndicator,
        buttons: state.buttons.map(b => b.text).slice(0, 5),
    };
}

/**
 * Quick URL heuristic. Cheap, runs first.
 */
export function urlLooksLikeJobPage() {
    const haystack = (window.location.hostname + window.location.pathname + window.location.search).toLowerCase();
    return JOB_URL_KEYWORDS.some(kw => haystack.includes(kw));
}

/**
 * Check the current DOM for an apply-style button (visible).
 */
export function hasVisibleApplyButton() {
    const clickables = document.querySelectorAll('button, a[role="button"], [role="button"], a, input[type="submit"]');
    for (const el of clickables) {
        if (!el.offsetParent) continue;
        const text = (el.textContent || el.value || '').trim().toLowerCase();
        if (!text || text.length > 60) continue;
        if (APPLY_BUTTON_TEXTS.some(t => text.includes(t))) return true;
    }
    return false;
}

/**
 * Check whether the page exposes a real form likely to be an application.
 * Looks for a container with multiple text/select inputs OR a file input
 * (CV upload) — single search bars on news sites don't qualify.
 */
export function hasApplicationForm() {
    if (document.querySelector('input[type="file"]')) return true;

    const forms = document.querySelectorAll('form');
    for (const f of forms) {
        const inputs = f.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea'
        );
        if (inputs.length >= 3) return true;
    }
    // Also count formless inputs (modern frameworks often skip <form>)
    const looseInputs = document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], textarea, select'
    );
    return looseInputs.length >= 4;
}

/**
 * True if the current host is a known non-job site (social, search, media).
 */
export function isDeniedHost() {
    const host = window.location.hostname.toLowerCase();
    return DENY_HOST_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

/**
 * Cheap check that the page's own copy (title + top headings) talks about a
 * job/application — used to qualify a form-only match. Scanning just the title
 * and h1/h2 keeps false positives low versus reading the whole body.
 */
export function pageMentionsJobContext() {
    const parts = [document.title || ''];
    document.querySelectorAll('h1, h2').forEach(h => parts.push(h.textContent || ''));
    const text = parts.join(' ').toLowerCase();
    return JOB_CONTEXT_KEYWORDS.some(k => text.includes(k));
}

/**
 * Decide whether to surface the agent on this page.
 *
 * A form alone is a weak signal — login, signup, search, and contact forms are
 * everywhere — so it only counts when the page text also reads like a job/apply
 * page. URL keywords and a real "Apply" button stay strong enough on their own.
 * Known non-job hosts are rejected outright.
 */
export function isLikelyJobPage() {
    if (isDeniedHost()) return false;
    if (urlLooksLikeJobPage()) return true;
    if (hasVisibleApplyButton()) return true;
    if (hasApplicationForm() && pageMentionsJobContext()) return true;
    return false;
}

/**
 * Wait up to `timeoutMs` for the page to look like a job page (handles SPAs
 * that render forms after initial paint). Resolves with boolean.
 */
export function waitForJobPageSignal(timeoutMs = JOB_PAGE_DETECT_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (isLikelyJobPage()) return resolve(true);

        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(timer);
            resolve(val);
        };

        const observer = new MutationObserver(() => {
            if (isLikelyJobPage()) finish(true);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Fallback poll for cases where mutations fire too fast / too rarely
        const poll = setInterval(() => {
            if (isLikelyJobPage()) finish(true);
        }, JOB_PAGE_DETECT_POLL_MS);

        const timer = setTimeout(() => finish(false), timeoutMs);
    });
}

// ═══════════════════════════════════════════════════════════════════
// Floating button
// ═══════════════════════════════════════════════════════════════════
