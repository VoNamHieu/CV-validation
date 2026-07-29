// Answer Policy — where an answer comes from when the profile has none.
//
// The action policy decides whether an action is ALLOWED. This decides what the
// answer IS. Keeping them apart matters: the previous version conflated them, so
// "we have no data for this question" was enforced as "this control may not be
// touched", and an application stalled on a required disclosure instead of
// reaching the review page where the user was going to check it anyway.
//
// Every answer here is deterministic and declared. Nothing is invented about the
// candidate: where a question asks for a fact we do not hold, the rule is either
// the legally-neutral option the form itself offers ("I don't wish to answer") or
// no answer at all. The distinction the user sees at review is `source`, which is
// why the resolver returns it alongside the value rather than just a string.
//
// Order of resolution:
//   1. the profile / a user-configured answer   → PROFILE
//   2. a product default for this KIND of question → AGENT_DEFAULT
//   3. a semantic fallback among the offered options → AGENT_DEFAULT
//   4. nothing — the caller leaves the field and the review lists it

/** Where an answer came from. Mirrors the review's provenance vocabulary. */
export const ANSWER_SOURCE = {
    PROFILE: 'PROFILE',
    AGENT_DEFAULT: 'AGENT_DEFAULT',
};

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Question kinds we can answer without asking. Each rule matches on the question
 * text and names candidate answers in priority order; the resolver picks the
 * first one the form actually offers, so a rule can never introduce an option
 * that is not on the page.
 */
export const ANSWER_RULES = [
    {
        kind: 'demographic',
        // EEO self-identification: race, gender, disability, veteran status.
        // Every one of these forms offers a decline option BY LAW in the US, and
        // declining is the only answer that states nothing about the person.
        match: /self[- ]identif|disability|veteran|race|ethnicity|gender|sexual orientation|dân tộc|giới tính/i,
        candidates: [
            "i don't wish to answer", 'i do not wish to answer', 'i prefer not to answer',
            'prefer not to say', 'prefer not to disclose', 'decline to self identify',
            'decline to self-identify', 'do not wish to disclose', 'not applicable',
            'không muốn trả lời', 'không tiết lộ',
        ],
    },
    {
        kind: 'current_employee',
        match: /current(ly)? (an )?employee|do you (currently )?work (for|at)|nhân viên hiện tại/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'previous_employment',
        // Measured wording on Mondelez: "Have you previously worked for this
        // organization?" — a REQUIRED radio that the old pattern missed, so
        // the step could not advance without the user.
        match: /previously (been )?(employed|worked)|former employee|worked (here|for (this|us)) before|đã từng làm việc/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'conflict_of_interest',
        match: /conflict of interest|relative|family member (who )?works|xung đột lợi ích/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'work_authorization',
        // The candidate's own right to work where the job is. Answered from the
        // profile when we hold it; otherwise NOT guessed — a wrong answer here is
        // a material misstatement, and the review surfaces it as outstanding.
        match: /legally authoriz|legally entitled|right to work|work permit|authorized to work|được phép làm việc/i,
        profileKeys: ['workAuthorized'],
        candidates: [],
    },
    {
        kind: 'sponsorship',
        // Mirror image of the above and equally material. Left to the user unless
        // the profile says.
        match: /sponsor|visa support|require sponsorship|bảo lãnh/i,
        profileKeys: ['requiresSponsorship'],
        candidates: [],
    },
    {
        kind: 'acknowledgement',
        // "I have read and understand…" — mandatory to advance, and the batch's
        // consent delegation is what covers it.
        match: /acknowledg|i have read|i understand|confirm(ed)? that i have read|tôi đã đọc/i,
        candidates: ['yes', 'i agree', 'i acknowledge', 'đồng ý', 'có'],
        requiresDelegation: true,
    },
    {
        // Knowable only to the candidate. Unlike a degree — which the institution,
        // subject and years together determine — no evidence on the page or in the
        // CV implies a grade, and a plausible-looking number is a fabricated
        // academic record. Listed here so the rule is visible rather than implied
        // by absence.
        kind: 'grade',
        match: /\bgpa\b|grade (average|point)|overall result|điểm trung bình|xếp loại/i,
        profileKeys: ['gpa'],
        candidates: [],
    },
    {
        kind: 'source',
        match: /how did you hear|how did you find|source|bạn biết đến/i,
        candidates: [
            'company website', 'company careers website', 'employer website',
            'careers website', 'company webpage', 'website', 'webpage', 'online',
        ],
    },
];

/** The rule that governs a question, or null. */
export function ruleFor(questionText) {
    const q = norm(questionText);
    if (!q) return null;
    return ANSWER_RULES.find(r => r.match.test(q)) || null;
}

/**
 * Resolve an answer for one question.
 *
 * @param {object}   field    `{ label, questionText }` — whatever names the question
 * @param {string[]} options  the options the form actually offers (empty for free text)
 * @param {object}   profile  the synced candidate profile
 * @param {object}   opts     `{ consentDelegated }`
 * @returns {{value: string, source: string, kind: string}|null}
 *   null means "we have no defensible answer" — the caller leaves the field
 *   alone and it shows up in the review's outstanding list.
 */
export function resolveAnswer(field, options = [], profile = {}, opts = {}) {
    const question = field?.questionText || field?.label || '';
    const rule = ruleFor(question);
    const offered = options.map(o => ({ raw: o, n: norm(o) })).filter(o => o.n);

    // 1. The user's own data always wins, whatever the rule would have chosen.
    for (const key of rule?.profileKeys || []) {
        const v = profile?.[key];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        const asText = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
        const hit = offered.find(o => o.n === norm(asText))
            || offered.find(o => o.n.includes(norm(asText)));
        return {
            value: hit ? hit.raw : asText,
            source: ANSWER_SOURCE.PROFILE,
            kind: rule.kind,
        };
    }

    if (!rule) return null;

    // An acknowledgement is only ours to give when the user delegated it.
    if (rule.requiresDelegation && opts.consentDelegated !== true) return null;

    // 2/3. The first candidate the form actually offers. Exact match first so a
    // list containing both "No" and "Not applicable" cannot resolve "no" to the
    // wrong entry by substring.
    for (const cand of rule.candidates) {
        const hit = offered.find(o => o.n === cand) || offered.find(o => o.n.includes(cand));
        if (hit) return { value: hit.raw, source: ANSWER_SOURCE.AGENT_DEFAULT, kind: rule.kind };
    }

    // A free-text field with a rule but no options: only answer when the rule has
    // a single unambiguous candidate (Yes/No questions rendered as text are rare).
    if (offered.length === 0 && rule.candidates.length) {
        return { value: rule.candidates[0], source: ANSWER_SOURCE.AGENT_DEFAULT, kind: rule.kind };
    }

    // 4. Nothing defensible. Better an empty field the review names than an
    //    invented fact on a submitted application.
    return null;
}
