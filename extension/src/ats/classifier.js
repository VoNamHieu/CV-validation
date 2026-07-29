// The ONE place a raw ATS signal becomes a normalized auth outcome.
//
// Everything downstream — the tenant's durable state, whether its remaining jobs
// are skipped, whether the user is asked for a password — hangs off this
// verdict, so no content script is allowed to interpret an error on its own.
//
// Signal priority, best first:
//   1. structured code from an API response      (source: 'authgwy' | 'cxs')
//   2. HTTP status + known response shape
//   3. semantic DOM (data-automation-id, aria)   (source: 'dom')
//   4. localized text match                       — LAST resort: Workday error
//      copy is translated and re-worded between versions, so matching prose is
//      the least stable thing we can key on.
//
// The cardinal rule: a login failure is NOT evidence of a wrong password.
// Unverified accounts, CAPTCHAs, lockouts, forced resets and DOM drift all
// produce "login didn't work". Only a specific invalid-credentials signal —
// after we know the account exists — may return `invalid_credentials`, because
// that verdict blocks the tenant and asks the user to type a password.

/** @typedef {'success'|'account_exists'|'invalid_credentials'|'verification_required'
 *   |'password_reset_required'|'consent_required'|'challenge_required'
 *   |'temporarily_locked'|'rate_limited'|'unsupported'|'transient_error'
 *   |'unknown_error'} AtsAuthOutcome */

export const RETRYABLE = new Set(['transient_error', 'rate_limited']);

/** Build a normalized result. The shape the backend accepts verbatim. */
export function authResult(operation, outcome, source, extra = {}) {
    return {
        operation,
        outcome,
        source,
        sourceCode: extra.sourceCode || null,
        retryable: extra.retryable ?? RETRYABLE.has(outcome),
        retryAfterSeconds: extra.retryAfterSeconds ?? null,
        consentAccepted: extra.consentAccepted || null,
        detail: extra.detail || null,
    };
}

// ── DOM signals ────────────────────────────────────────────────────────────
// Ordered most-specific first. Each entry maps a matched error banner to an
// outcome; `code` is the sanitized identifier stored in the attempt log (never
// the raw text, which can carry the user's email).
const DOM_PATTERNS = [
    {
        code: 'account_exists',
        outcome: 'account_exists',
        re: /already (exists|in use|registered|have an account)|đã (tồn tại|được đăng ký)|account with this email/i,
    },
    {
        code: 'verify_email',
        outcome: 'verification_required',
        re: /verify your email|verification (email|link) (has been )?sent|check your (email|inbox) to (verify|activate)|xác minh email|xác nhận email/i,
    },
    {
        code: 'password_reset',
        outcome: 'password_reset_required',
        re: /password (has )?expired|must (change|reset) your password|reset your password to continue/i,
    },
    {
        code: 'locked',
        outcome: 'temporarily_locked',
        re: /account (is )?(locked|disabled|temporarily unavailable)|too many (failed )?(attempts|sign-in)|tài khoản .*(khoá|khóa)/i,
    },
    {
        code: 'rate_limited',
        outcome: 'rate_limited',
        re: /too many requests|try again (in|later)|rate limit/i,
    },
    {
        code: 'invalid_credentials',
        outcome: 'invalid_credentials',
        // Deliberately narrow: must name the credentials. A bare "Sign in
        // failed" is NOT enough to tell the user their password is wrong.
        re: /(incorrect|invalid|wrong) (email|username|password|credentials)|email( address)? (or|and) password (you entered )?(is|are|do(es)? not)|sai (mật khẩu|tên đăng nhập)/i,
    },
    {
        code: 'password_policy',
        outcome: 'unknown_error',
        re: /password must (be|contain)|does not meet .*(requirements|policy)/i,
    },
];

const CHALLENGE_FRAME = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]';
const CHALLENGE_HOST = '.g-recaptcha, #challenge-form';

/** Names that contain "captcha" while asserting the OPPOSITE. */
const NOT_A_CHALLENGE = /no.?captcha|captcha.?free|without.?captcha/i;

/**
 * True when the page is showing a CAPTCHA / bot challenge.
 *
 * Detection is by EVIDENCE, not by name, because a name can say the opposite of
 * what a substring match reads. Measured on Mondelez's Workday create-account
 * page: the submit button sits inside
 * `<div data-automation-id="noCaptchaWrapper">` — Workday's marker for the
 * variant that has NO captcha — and `[data-automation-id*="captcha" i]` matched
 * it, so the agent aborted every signup with `challenge_required` at the exact
 * element it needed to click, and the run ended "Cần bạn xử lý trực tiếp trên
 * trang này" on a page with no challenge at all.
 *
 * So a captcha-ish automation id now counts only when it actually contains a
 * challenge frame, and negated names never count. The block itself is right and
 * stays: the agent must not attempt a bot challenge.
 */
export function detectChallenge(doc = document) {
    const vis = (el) => !!(el && el.offsetParent !== null);
    if ([...doc.querySelectorAll(CHALLENGE_FRAME)].some(vis)) return true;
    if ([...doc.querySelectorAll(CHALLENGE_HOST)].some(vis)) return true;
    return [...doc.querySelectorAll('[data-automation-id*="captcha" i]')].some((el) => {
        if (NOT_A_CHALLENGE.test(el.getAttribute('data-automation-id') || '')) return false;
        if (!vis(el)) return false;
        // A vendor-named wrapper proves nothing on its own; a challenge inside it does.
        return !!el.querySelector(`${CHALLENGE_FRAME}, ${CHALLENGE_HOST}`);
    });
}

/**
 * Read the visible error banners on a Workday auth page.
 * Returns { outcome, code } or null when nothing recognizable is shown.
 */
export function classifyDomError(doc = document) {
    // Semantic containers first — Workday tags its auth errors, so we can scope
    // the text match instead of scanning (and mis-matching) the whole page.
    const nodes = [
        ...doc.querySelectorAll(
            '[data-automation-id="errorMessage"], [data-automation-id*="errorMessage"], '
            + '[role="alert"], .css-error, [data-automation-id="alertMessage"]',
        ),
    ].filter((el) => el.offsetParent !== null);

    const text = nodes.map((n) => n.textContent || '').join(' ').trim();
    if (!text) return null;
    for (const pattern of DOM_PATTERNS) {
        if (pattern.re.test(text)) return { outcome: pattern.outcome, code: pattern.code };
    }
    // A banner we can't place: real, but we must not guess which kind. The
    // caller reports unknown_error, which leaves the tenant's state untouched
    // rather than falsely accusing the password.
    //
    // The banner's WORDS are deliberately not returned. This value is sent to the
    // backend with the auth result, and auth banners routinely echo the account's
    // email address. Callers that want the text for a local log read the DOM
    // themselves (see login.js `_visibleErrorText`) — it stays in the browser.
    return { outcome: 'unknown_error', code: 'unrecognized_error' };
}

/**
 * Classify a structured API response (Stage 7 wires authgwy in here; the CXS
 * calls already flow through it). Keeping this next to the DOM classifier means
 * the two speak one vocabulary and the API path can be switched on without the
 * orchestrator changing at all.
 */
export function classifyApiResponse({ status, json, text }, { source = 'authgwy' } = {}) {
    const code = json?.errorCode || json?.error?.code || json?.errors?.[0]?.code || null;
    const body = json ? JSON.stringify(json) : String(text || '');

    if (status === 429) {
        return { outcome: 'rate_limited', code: code || 'http_429', source };
    }
    if (status >= 500) {
        return { outcome: 'transient_error', code: code || `http_${status}`, source };
    }
    if (status === 200 || status === 201 || status === 204) {
        return { outcome: 'success', code: code || null, source };
    }
    for (const pattern of DOM_PATTERNS) {
        if (pattern.re.test(body)) return { outcome: pattern.outcome, code: pattern.code, source };
    }
    if (status === 401 || status === 403) {
        // Unauthenticated is NOT proof of a bad password at this layer — it's
        // also what an unverified account and a challenge look like. Stay vague.
        return { outcome: 'unknown_error', code: code || `http_${status}`, source };
    }
    return { outcome: 'unknown_error', code: code || `http_${status}`, source };
}
