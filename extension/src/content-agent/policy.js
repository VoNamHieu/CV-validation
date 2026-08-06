// The agent's deterministic safety layer — the ONE place an action is allowed
// or refused.
//
// Everything else in the agent is allowed to be flexible: the planner may choose
// any order, any selector, any recovery. What it may never do is perform an
// action the user cannot undo. Those live here, in code, because the planner's
// side of that contract ("NEVER click Submit yourself") is a sentence in a prompt
// — probabilistic by construction, and reachable by any hostile page that talks
// the model into ignoring it. A prompt states the policy; this file enforces it.
//
// Two halves on purpose:
//   · classify* / evaluate*  — pure functions over a plain descriptor. No DOM, so
//     the whole vocabulary is unit-testable in node (tests/policy.test.js).
//   · describeElement / check* — the thin DOM adapter the agent actually calls.
//
// The choke point is dom.js `overlayClick`, which refuses an action this module
// denies. Its context argument DEFAULTS to the strictest caller ('planner'), so
// a future call site that forgets to declare itself gets the safe treatment
// rather than a silent bypass.

import { isApplicationFormPage, isThirdPartyApply } from './detect.js';
import { trace } from './trace.js';

// ── Vocabulary ─────────────────────────────────────────────────────────────
// Narrow on purpose. A false negative here transmits an application the user
// never approved; a false positive only costs the planner one action, and it is
// told why so it can pick a different control. Where the two collide, the
// unambiguous phrasings win: "apply" alone is NOT here, because on a job page
// that is the gateway the agent is supposed to click.

/**
 * UNAMBIGUOUSLY sends the application — refused wherever it appears, in any flow
 * position. Only wording that cannot also mean "open the application" belongs
 * here; anything that can is in APPLY_RE and resolved by context instead.
 */
const SUBMIT_RE = new RegExp([
    'submit',
    'send (my )?application',
    'finish (and|&) submit',
    'gửi đơn', 'gui don',
    'hoàn tất ứng tuyển', 'hoan tat ung tuyen',
].join('|'), 'i');

/**
 * AMBIGUOUS by design: on a job ad these words open the application, on a generic
 * ATS with no recipe the same words are frequently the final button. They are
 * kept out of SUBMIT_RE so the gateway click at step 0 still works, and resolved
 * by flow context instead (see evaluateClick step 4).
 */
const APPLY_RE = new RegExp([
    '\\bapply\\b', '\\bapply now\\b',
    'ứng tuyển', 'ung tuyen',
    // These read as "submit" on a filled form and as "open the application" on a
    // job ad, and Vietnamese boards use them for BOTH. Treating them as
    // unambiguous submits meant the agent could never click into an application
    // on the boards this product exists to serve.
    'nộp đơn', 'nop don',
    'nộp hồ sơ', 'nop ho so',
    'gửi hồ sơ', 'gui ho so',
].join('|'), 'i');

/** Legal acknowledgement. Mirrors the pair login.js used to own privately — the
 *  marketing exclusion is checked FIRST and wins, so "receive marketing updates
 *  — I consent" can never be read as a required terms box. */
export const CONSENT_RE =
    /agree|consent|terms|privacy|i have read|acknowledge|đồng ý|dong y|điều khoản|dieu khoan/i;

export const MARKETING_RE =
    /marketing|newsletter|promotion|advertis|subscribe|updates about|job alerts|third[- ]part|nhận tin|nhan tin|khuyến mãi|khuyen mai|quảng cáo|quang cao|thông báo việc làm|thong bao viec lam/i;

/**
 * Demographic self-identification, which ATS collect for EEO reporting.
 *
 * These still classify separately even though consent is now ticked either way,
 * because the classification feeds the ANSWER side too: what a demographic field
 * should say is "prefer not to say", which is a real answer only the person can
 * choose, and no phrasing exempts them from that.
 */
const PERSONAL_DATA_RE =
    /self[- ]identif|disability status|veteran status|protected veteran|race\/ethnicity|\bethnicity\b|gender identity|sexual orientation|dân tộc|dan toc|tôn giáo|ton giao/i;

// Asserting a fact about oneself. The verbs are matched on their own rather than
// as "i certify": real labels put words in between ("I agree and certify that…",
// "I hereby declare…"). `\bcertify\b` does not match "certificate", so
// document-upload copy is unaffected.
const ATTESTATION_RE =
    /\b(certify|certifies|declare|attest|affirm)\b|under penalty|to the best of my knowledge|i confirm that i\b|cam đoan|cam doan|cam kết|cam ket|tôi xác nhận rằng|toi xac nhan rang/i;

/**
 * Names a DOCUMENT being accepted. This is what separates "I certify I have read
 * the Terms and Conditions" — ordinary terms acceptance, merely phrased with a
 * certifying verb — from "I certify I have no criminal record", which is a
 * statement about the person. Without the distinction the first one classified as
 * a non-delegable declaration and blocked Workday's signup outright.
 */
const DOCUMENT_RE =
    /\bterms\b|\bprivacy\b|\bpolic(y|ies)\b|\bconditions\b|\bagreement\b|điều khoản|dieu khoan|chính sách|chinh sach/i;

/** Destroys work: removes an entry, withdraws or resets the application. The
 *  agent has no reliable way to tell a stale ATS-parsed entry from one the user
 *  wrote, so it never deletes either. */
const DESTRUCTIVE_RE =
    /\bdelete\b|\bremove\b|\bwithdraw\b|\bclear all\b|start over|reset( application)?|xoá|xóa|gỡ bỏ|go bo|rút hồ sơ|rut ho so|huỷ đơn|hủy đơn/i;

/** Opens an account. The sanctioned path is login.js under the background's
 *  per-tenant budget; a planner-initiated signup is outside that accounting. */
const CREATE_ACCOUNT_RE =
    /create (an )?account|sign ?up|register|đăng ký|dang ky|tạo tài khoản|tao tai khoan/i;

/** Field targets that must never receive profile data, matched against selector,
 *  name, id, label and nearby text. The server route filters the same families
 *  (agent-plan/route.ts SENSITIVE_TARGET); the recipe path never reaches the
 *  server at all, so the client needs its own copy rather than inheriting one. */
const SENSITIVE_FIELD_RE =
    /password|passwd|mật khẩu|mat khau|\botp\b|verification.?code|mã xác (minh|thực)|cvv|cvc|card.?number|số thẻ|so the|bank.?account|tài khoản ngân hàng|tai khoan ngan hang|cccd|cmnd|national.?id|\bssn\b|social.?security/i;

// ── Denial codes ───────────────────────────────────────────────────────────
// Stable identifiers so a refusal can be logged, counted and asserted on without
// matching prose. They also travel to the planner as the reason an action failed.
export const DENY = {
    SUBMIT: 'submit_application',
    FINAL_STEP: 'final_review_step',
    APPLICATION_CONSENT: 'application_consent',
    MARKETING_CONSENT: 'marketing_consent',
    DESTRUCTIVE: 'destructive_action',
    CREATE_ACCOUNT: 'unsanctioned_account_creation',
    THIRD_PARTY: 'third_party_apply',
    SENSITIVE_FIELD: 'sensitive_field',
};

/** Human wording per denial, for the log line and the planner's history. */
const DENY_DETAIL = {
    [DENY.SUBMIT]: 'chỉ người dùng được bấm nộp hồ sơ',
    [DENY.FINAL_STEP]: 'đang ở bước review cuối — người dùng tự nộp',
    [DENY.APPLICATION_CONSENT]: 'điều khoản của đơn ứng tuyển do người dùng tự tích',
    [DENY.MARKETING_CONSENT]: 'không đăng ký nhận tin quảng cáo thay người dùng',
    [DENY.DESTRUCTIVE]: 'không xoá/rút dữ liệu đã có trên form',
    [DENY.CREATE_ACCOUNT]: 'tạo tài khoản chỉ chạy qua luồng đăng nhập có kiểm soát',
    [DENY.THIRD_PARTY]: 'không ứng tuyển qua bên thứ ba',
    [DENY.SENSITIVE_FIELD]: 'không điền trường nhạy cảm',
};

const allow = () => ({ allowed: true });
const deny = (code, extra) => ({
    allowed: false,
    code,
    reason: DENY_DETAIL[code] || code,
    ...extra,
});

// ── Pure classifiers ───────────────────────────────────────────────────────

/**
 * A descriptor is everything the policy needs to judge a control, flattened out
 * of the DOM so the rules can be tested without one.
 *
 * @typedef {object} ElementDescriptor
 * @property {string} [text]        visible label of the control
 * @property {string} [value]       for input[type=submit]/[type=button]
 * @property {string} [type]        input type
 * @property {string} [name]
 * @property {string} [id]
 * @property {string} [selector]    the selector the caller used to reach it
 * @property {string} [automationId] data-automation-id (Workday) / data-test (SR)
 * @property {string} [label]       associated <label> text
 * @property {string} [nearbyText]  surrounding copy, for unlabelled controls
 * @property {string} [href]
 * @property {boolean} [isThirdParty] pre-computed third-party-apply verdict
 */

// Three deliberately different views of a control. Which one a rule reads is a
// judgement about evidence, not a detail: matching too much text is how a rule
// starts refusing legitimate fields, and matching too little is how it misses
// the one it exists to catch.

/** The control's OWN naming. `value` counts only where it IS the label (an
 *  `<input type="submit" value="Nộp hồ sơ">`); for a text box the value is the
 *  user's content, and reading it would let a cover letter that happens to
 *  mention "password" veto its own field. */
function labelText(d) {
    const type = (d.type || '').toLowerCase();
    const valueIsLabel = type === 'submit' || type === 'button' || type === 'reset';
    return [d.text, valueIsLabel ? d.value : '', d.label, d.ariaLabel, d.placeholder]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Label plus the copy around it — needed only where a control is routinely
 *  unlabelled and the meaning lives in the paragraph beside it, i.e. consent. */
function proseText(d) {
    return [labelText(d), (d.nearbyText || '').toLowerCase()]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Machine identifiers. Strong evidence of what a field IS, and immune to page
 *  copy — but they carry HTML idiom, so they are not read for every rule. */
function identifiers(d) {
    return [d.selector, d.name, d.id, d.automationId]
        .filter(Boolean).join(' ').toLowerCase();
}

/**
 * Visible wording only. Identifiers are deliberately NOT consulted: `name="submit"`
 * and `type="submit"` are ordinary HTML for the Next button of any plain
 * multi-step form, so matching them would refuse every step advance on ATS we
 * have no recipe for. The exact-control case is covered by `ctx.submitSelector`,
 * and the review page by `ctx.atFinalStep` — both are precise, and neither
 * depends on guessing from an attribute.
 */
export function looksLikeSubmit(d) {
    return SUBMIT_RE.test(labelText(d));
}

/** Reads as "apply" — which means "open the application" before a form exists and
 *  "send it" afterwards. Only `evaluateClick` can tell which, using flow context. */
export function looksLikeApplyVerb(d) {
    return APPLY_RE.test(labelText(d));
}

/** Own label only — a "Delete" link elsewhere in the same card must not veto an
 *  unrelated control. */
export function looksDestructive(d) {
    return DESTRUCTIVE_RE.test(labelText(d));
}

/**
 * What kind of checkbox is this?
 *   'marketing'   — an opt-in we never tick, required or not
 *   'terms'       — the mandatory acknowledgement gating a form
 *   'declaration' — a statement ABOUT the user (a certification, or demographic
 *                   self-identification). Only they can make it, delegated or not.
 *   'other'       — an ordinary form question ("willing to relocate")
 * Order is the priority: marketing beats a box that claims to be both, and a
 * declaration beats "I agree" phrasing wrapped around a personal attestation.
 */
export function classifyConsent(d) {
    // Prefer the control's OWN wording, and read the surrounding copy only when it
    // has none. Consulting both unconditionally lets an unrelated paragraph in the
    // same fieldset re-label a box that speaks for itself — on Workday's Voluntary
    // Disclosures page the demographic questions and the terms acknowledgement
    // share a container, so the terms box would inherit "disability status" and be
    // refused, blocking the only route to the review step.
    const h = labelText(d) || proseText(d);
    if (MARKETING_RE.test(h)) return 'marketing';
    if (PERSONAL_DATA_RE.test(h)) return 'declaration';
    if (ATTESTATION_RE.test(h) && !DOCUMENT_RE.test(h)) return 'declaration';
    if (CONSENT_RE.test(h)) return 'terms';
    return 'other';
}

/**
 * Identity signals only — type, own label, identifiers. Neighbouring copy is
 * excluded on purpose: "Forgot password?" sits next to the EMAIL box on nearly
 * every login wall, and reading it would make the agent refuse to type an email
 * address.
 */
export function isSensitiveField(d) {
    if ((d.type || '').toLowerCase() === 'password') return true;
    return SENSITIVE_FIELD_RE.test(labelText(d)) || SENSITIVE_FIELD_RE.test(identifiers(d));
}

// ── Decisions ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} PolicyContext
 * @property {'planner'|'recipe'|'login'|'gateway'|'agent'} [source]
 *   Who is asking. Defaults to 'planner' — the least-trusted caller — so a call
 *   site that omits it is treated strictly rather than waved through.
 * @property {boolean} [atFinalStep]  the ATS's review step is on screen
 * @property {string}  [submitSelector] recipe's known submit control
 * @property {'signup'|'signin'|'application'} [formKind]
 *   Which form the control belongs to. Lets the account-creation refusal stand
 *   down inside the sanctioned login flow.
 */

/**
 * May we activate this control?
 *
 * The boundary this enforces is the FINAL SUBMISSION, not the sensitivity of the
 * question being answered. The agent is meant to complete the whole application —
 * every field, every Next, every Continue, right up to the review page — and stop
 * there so the user checks the lot in one place. So the checks below are about
 * what an action DOES (sends, destroys, escapes to a third party), never about
 * what a question asks.
 *
 * There are deliberately NO exemptions ahead of the final-step check: a widget
 * option, a recipe advance and a planner click are all equally capable of being
 * the control that sends the application once the review page is on screen.
 */
export function evaluateClick(d, ctx = {}) {
    const source = ctx.source || 'planner';

    // 1. The review step ends the agent's authority, full stop. Workday's
    //    "Submit" reuses pageFooterNextButton, so on the final page ANY advance
    //    sends the application — no vocabulary can tell them apart, and nothing
    //    (not even a dropdown option) has business being clicked here.
    if (ctx.atFinalStep) return deny(DENY.FINAL_STEP);

    // 2. The ATS's own submit control, named by the recipe. Exact and language-
    //    independent, so it holds where text matching would not.
    if (ctx.submitSelector && d.selector && selectorsMatch(d.selector, ctx.submitSelector)) {
        return deny(DENY.SUBMIT);
    }

    // 3. Handing the flow to Indeed/LinkedIn — a foreign login, not this employer.
    //    Checked BEFORE the apply vocabulary because "Apply with Indeed" matches
    //    both, and the third-party reason is the specific and useful one.
    if (d.isThirdParty || isThirdPartyApplyDescriptor(d)) return deny(DENY.THIRD_PARTY);

    // 4. Wording that means "send the application" — always refused.
    if (SUBMIT_RE.test(labelText(d))) return deny(DENY.SUBMIT);

    // 4. Wording that is AMBIGUOUS between opening an application and sending
    //    one: bare "Apply" / "Apply now" / "Ứng tuyển". On a job ad it is the
    //    gateway; on a generic ATS with no recipe it is frequently the final
    //    button. Text cannot separate them — only position in the flow can, so
    //    it is allowed only while we have established no form is on screen yet
    //    (checkClick re-verifies that against the live DOM rather than trusting
    //    the caller's claim).
    if (!ctx.openingApplication && APPLY_RE.test(labelText(d))) {
        return deny(DENY.SUBMIT, { ambiguous: true });
    }

    // 6. Destroying existing data.
    //
    // EXCEPT deselecting one committed chip in a field the recipe is
    // correcting: the "Remove" in that ✕ is the widget's own word for
    // "unpick this option", not a destructive act on the application. Measured
    // on PwC — the résumé parser committed the WRONG UNIVERSITY (Illinois at
    // Chicago for a CV that says Urbana-Champaign), the eviction that exists
    // to fix exactly that was denied here, and a false credential rode to the
    // review page twice. Narrow on purpose: recipe-sourced, activation
    // 'widget-option', and a single selected chip — a Delete BUTTON on a
    // section row (which removes a whole work-experience entry) matches none
    // of those and stays denied.
    const chipEviction = source === 'recipe' && ctx.activation === 'widget-option'
        && (d.automationId === 'selectedItem' || /selectedItem/i.test(d.selector || ''));
    if (looksDestructive(d) && !chipEviction) return deny(DENY.DESTRUCTIVE);

    // 7. Account creation outside the controlled login flow. login.js runs under
    //    the background's per-tenant budget (1 signup + 1 login); a planner that
    //    opens an account on its own is outside that accounting entirely.
    if (source !== 'login' && CREATE_ACCOUNT_RE.test(labelText(d))) {
        return deny(DENY.CREATE_ACCOUNT);
    }

    // Everything else — Next, Continue, Save and Continue, a dropdown option, a
    // radio, a disclosure checkbox — is the agent doing the job it exists for.
    return allow();
}

/**
 * May we tick this checkbox?
 *
 * The boundary is SUBMISSION, so consent is ticked. Every earlier gate here —
 * terms-only, then delegation — was a gate on a box that is mandatory to
 * advance, which means it was really a gate on finishing at all: measured on
 * Mondelez, `acceptTermsAndAgreements` is required on Voluntary Disclosures and
 * is the last thing between a filled application and the review page. Refusing
 * it does not leave the user a decision to make, it leaves them a half-filled
 * form one step short of the page where they were going to make it.
 *
 * The user still decides. They read the review, and nothing reaches the employer
 * until they press Submit — which the agent never does.
 *
 * The one exception is a marketing opt-in. It is refused not because it is
 * riskier but because it is never required to advance, so ticking it buys
 * nothing and signs the user up for mail they did not ask for. That is also what
 * the batch-start modal promises in as many words: "Copo không bao giờ đăng ký
 * nhận email quảng cáo thay bạn."
 *
 * Whatever is ticked is recorded (login.js returns the labels as
 * `consentAccepted`, stored with the auth attempt) — consent with no evidence of
 * what was accepted is not something anyone can audit afterwards.
 */
export function evaluateConsent(d) {
    if (classifyConsent(d) === 'marketing') return deny(DENY.MARKETING_CONSENT);
    return allow();
}

/**
 * May the agent ANSWER this checkbox?
 *
 * Almost always yes — and that is the point. An earlier version of this file
 * refused personal declarations and undelegated terms, which sounds careful and
 * is not: a required box the agent will not tick makes the step unadvanceable, so
 * the application never reaches the review page where the user was going to check
 * everything anyway. Refusing to answer is not a safer answer, it is an abandoned
 * application plus a half-filled form.
 *
 * So Voluntary Disclosures, demographic self-identification, "I certify…", Yes/No
 * questions and mandatory acknowledgements are all answerable. What the answer
 * SHOULD be is a different question, owned by the recipe/planner mapping and
 * surfaced to the user by provenance — not something an action policy can judge.
 *
 * The single exception is a marketing opt-in, which is refused under any
 * circumstance: it is never required to advance, and the batch-start modal
 * promises in as many words "Copo không bao giờ đăng ký nhận email quảng cáo
 * thay bạn."
 */
export function evaluateCheckboxFill(d) {
    if (classifyConsent(d) === 'marketing') return deny(DENY.MARKETING_CONSENT);
    return allow();
}

/** May we write `value` into this field? */
export function evaluateFill(d, ctx = {}) {
    // login.js is the only caller allowed near a password box, and only with the
    // credential the background just handed it for this one tenant.
    if (isSensitiveField(d) && ctx.source !== 'login') {
        return deny(DENY.SENSITIVE_FIELD);
    }
    if ((d.type || '').toLowerCase() === 'checkbox') return evaluateCheckboxFill(d);
    return allow();
}

/** Two selectors that reach the same control. Cheap normalization rather than
 *  DOM resolution: the recipe writes `[data-automation-id="x"]` and the planner
 *  may quote it differently. */
function selectorsMatch(a, b) {
    const norm = (s) => String(s || '').replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();
    return norm(a) === norm(b);
}

/** Descriptor-level third-party check, for callers that have no element. */
function isThirdPartyApplyDescriptor(d) {
    const t = labelText(d);
    const href = (d.href || '').toLowerCase();
    const PROVIDER = /indeed|linkedin|glassdoor|ziprecruiter/;
    if (PROVIDER.test(t) && /(apply|sign\s*in|log\s*in|continue|đăng nhập|ứng tuyển|nộp đơn|nộp hồ sơ|tiếp tục)/.test(t)) return true;
    return /indeed\.com|linkedin\.com\/(oauth|uas|checkpoint)|glassdoor\.com|ziprecruiter\.com/.test(href);
}

// ── DOM adapter ────────────────────────────────────────────────────────────

/** Resolve the text an `aria-labelledby` / `aria-describedby` points at. Workday
 *  labels its consent checkboxes this way rather than with a <label for>, so
 *  without this the box arrives unlabelled, so a marketing opt-in reads as an
 *  ordinary consent and gets ticked — the one thing this file will not do. */
function ariaReferencedText(el) {
    const ids = [
        el.getAttribute?.('aria-labelledby') || '',
        el.getAttribute?.('aria-describedby') || '',
    ].join(' ').trim();
    if (!ids) return '';
    const parts = [];
    for (const id of ids.split(/\s+/).slice(0, 4)) {
        try {
            const node = document.getElementById(id);
            if (node?.textContent) parts.push(node.textContent);
        } catch { /* malformed id */ }
    }
    return parts.join(' ');
}

/** Flatten a live element into the descriptor the rules above consume. */
export function describeElement(el, selector) {
    if (!el) return { selector };
    const get = (a) => { try { return el.getAttribute?.(a) || ''; } catch { return ''; } };
    const type = (el.type || '').toLowerCase();
    // The accessible name IS the control's own wording — aria-labelledby is how
    // Workday names its consent checkboxes, so it belongs with <label>, not with
    // the surrounding copy.
    let label = '';
    try {
        label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent)
            || el.closest?.('label')?.textContent
            || ariaReferencedText(el)
            || '';
    } catch { /* selector engines dislike odd ids */ }

    // Fallback only, for a box with no wording of its own, and read only by the
    // consent classifier — never by the sensitive-field rule, where "Forgot
    // password?" sits next to the email input on nearly every login wall.
    let nearbyText = '';
    if (!label && (type === 'checkbox' || type === 'radio')) {
        try {
            nearbyText = (el.closest?.('[data-automation-id^="formField-"], .form-group, fieldset')?.textContent
                || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        } catch { /* best effort */ }
    }

    return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        // The value is only ever a LABEL on a button-like input; elsewhere it is
        // the user's own content and must not be judged as if it described the field.
        value: (type === 'submit' || type === 'button' || type === 'reset')
            ? String(el.value || '').slice(0, 120) : '',
        type,
        name: el.name || '',
        id: el.id || '',
        selector: selector || '',
        automationId: get('data-automation-id') || get('data-test'),
        ariaLabel: get('aria-label'),
        placeholder: el.placeholder || '',
        label: label.replace(/\s+/g, ' ').trim().slice(0, 160),
        nearbyText,
        href: get('href'),
        isThirdParty: (() => { try { return isThirdPartyApply(el); } catch { return false; } })(),
    };
}

/**
 * Describe + judge an activation.
 *
 * `openingApplication` is re-derived here against the LIVE DOM rather than taken
 * on trust: it is the one claim that unlocks a button reading "Apply" / "Nộp hồ
 * sơ", so a caller that is wrong about it (a form rendered since it decided, a
 * gateway re-run after the form appeared) would be handing over the exact control
 * this policy exists to protect. A caller may only ever narrow it, never widen it.
 */
export function checkClick(el, ctx = {}, selector) {
    // Flow position decides, not the caller.
    //
    // This used to require the caller to CLAIM `openingApplication`, which meant
    // only step 0 and the recipe gateway ever got it — so when the planner
    // proposed the same "Apply" button on the same job-description page, the
    // identical click was refused. The agent stopped on a page with no form and
    // no fields, which is the opposite of protecting anything.
    //
    // A caller may still force it OFF (it knows something we don't), but it
    // cannot force it ON: the page is the authority on whether a form exists.
    const opening = ctx.openingApplication === false ? false : !_applicationFormPresent();
    return evaluateClick(describeElement(el, selector), { ...ctx, openingApplication: opening });
}

/**
 * Is there an application form on screen right now?
 *
 * Deliberately broader than `isApplicationFormPage()` alone: a résumé upload is
 * proof of a form even when there are too few text inputs to trip the count, and
 * that is exactly the shape of a short "quick apply" modal whose button says
 * nothing more specific than "Ứng tuyển".
 */
function _applicationFormPresent() {
    try {
        if (isApplicationFormPage()) return true;
        // A VISIBLE résumé upload. The visibility test matters: a file input is
        // routinely present but hidden behind a styled button, and an earlier
        // version of this check read `file.type === 'file'` as corroboration —
        // which is true of every file input that exists, so any page carrying one
        // counted as a form and the apply verb was refused on it.
        const file = document.querySelector('input[type="file"]');
        return !!(file && file.offsetParent !== null);
    } catch { return true; }   // can't tell → assume a form, i.e. refuse
}

/** Convenience: describe + judge a fill in one call. */
export function checkFill(el, ctx = {}, selector) {
    return evaluateFill(describeElement(el, selector), ctx);
}

/**
 * One-line refusal log, so a denied action is visible instead of looking like
 * the agent silently doing nothing.
 *
 * It also goes into the run trace. A refusal and a click that simply had no
 * effect are indistinguishable from outside — the page does not move either way
 * — and a console warning does not survive the navigation that follows, so a run
 * that stalled on a denied "Continue" produced a dump with no sign of the
 * refusal in it. This is the single most useful line the trace can carry, which
 * is why it is emitted from the policy itself rather than from each caller.
 */
export function logDenial(verdict, el, ctx = {}) {
    const label = el
        ? ((el.textContent || el.value || el.name || '').toString().replace(/\s+/g, ' ').trim().slice(0, 40))
        : '';
    console.warn(
        `[Copo Policy] ✋ ${verdict.code} (${ctx.source || 'planner'}) — ${verdict.reason}`, label,
    );
    trace('policy.deny', {
        code: verdict.code,
        source: ctx.source || 'planner',
        label,
        automationId: el?.getAttribute?.('data-automation-id') || null,
        // atFinalStep denies EVERYTHING, so when it is the reason the useful
        // question is whether the review page is really on screen.
        atFinalStep: ctx.atFinalStep ?? null,
        ambiguous: verdict.ambiguous ?? undefined,
    });
}
