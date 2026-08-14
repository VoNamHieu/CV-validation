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
        kind: 'ethnicity',
        // BEFORE the demographic rule (first match wins): ethnicity is the one
        // demographic a VN candidate answers as an administrative fact, and
        // their profile carries it ("Kinh"). Only a silent profile falls back
        // to the decline phrasings — which a VN tenant's country-specific
        // ethnic-group list usually doesn't offer anyway.
        match: /race\s*\/?\s*ethnicity|\bethnicit|dân tộc/i,
        profileKeys: ['ethnicity'],
        // Fallback declines: the same breadth as the demographic rule below —
        // this rule matching FIRST must never decline less well than the rule
        // it shadows ("I don't wish to answer" needs the contraction rung).
        candidates: [
            'not specified', 'not declared', 'prefer not to say', 'decline to answer',
            "don't wish", 'do not wish', 'decline to self-identify',
            'not applicable', 'không muốn trả lời',
        ],
    },
    {
        kind: 'demographic',
        // EEO self-identification: race, gender, disability, veteran status.
        // Every one of these forms offers a decline option BY LAW in the US, and
        // declining is the only answer that states nothing about the person.
        match: /self[- ]identif|disability|veteran|race|ethnicity|gender|sexual orientation|dân tộc|giới tính/i,
        // Tenants word the decline option however they like. Mondelez offers
        // Female / Male / "Not Specified" / Other on a REQUIRED Gender field —
        // none of the US-styled phrasings below matched it, so the step could not
        // advance at all. Keep the explicit refusals first (they say "I choose not
        // to answer"), then the neutral placeholders (which say nothing either).
        candidates: [
            "i don't wish to answer", 'i do not wish to answer', 'i prefer not to answer',
            'prefer not to say', 'prefer not to disclose', 'decline to self identify',
            'decline to self-identify', 'do not wish to disclose', 'not applicable',
            'không muốn trả lời', 'không tiết lộ',
            'not specified', 'not declared', 'undeclared', 'unspecified',
            'undisclosed', 'not disclosed', 'choose not to disclose',
            'no answer', 'không xác định', 'không muốn nêu',
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
        // "Are you related to a PwC partner, principal, or employee?" — measured
        // on PwC and NOT matched by the older wording, so a REQUIRED question
        // with an obvious answer went to the model, which (rightly) refuses to
        // state a family fact it was given no evidence for. `related to` and
        // `relative` are separate words; matching one never matched the other.
        match: /conflict of interest|relative|related to (a |an )?[a-z&. ]{0,24}(employee|partner|principal|staff|colleague)|family member (who )?works|relationship (to|with) (a |an )?(pwc |current )?(employee|partner|staff)|người thân|họ hàng|xung đột lợi ích/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'travel',
        // "Are you willing and able to travel per the job description
        // requirements?" User decision 2026-08-05: default Yes. Applying to a
        // job states willingness to do the job as described, and the answer
        // sits in the review list like every agent default.
        match: /willing.{0,30}travel|able to travel|travel (requirement|per the job)|business travel|(sẵn sàng|có thể).{0,20}(đi )?công tác/i,
        candidates: ['yes', 'có'],
    },
    {
        kind: 'relocation',
        // "Would you be willing to relocate if the company required?" — measured
        // on Maersk (R192834), a REQUIRED prompt that stalled App Questions. Same
        // logic as travel (user decision 2026-08-05): applying to a job states a
        // willingness to do it as described, and the answer sits in the review
        // list as an agent default for the candidate to change before submitting.
        match: /willing.{0,30}relocat|able to relocat|open to relocat|relocat(e|ion)[^?]{0,40}(if|when|required|for (the )?(role|job|position|company))|(sẵn sàng|đồng ý).{0,20}(chuyển|di dời)/i,
        candidates: ['yes', 'có'],
    },
    {
        kind: 'prior_application',
        // "Have you applied to A.P. Moller Maersk Group before?" — measured on
        // Maersk (R192834), REQUIRED, and left the App Questions step stuck. Same
        // shape as previous_employment: a fact we do not hold defaults to "No" —
        // the common case — and the candidate corrects it at review if they have
        // applied before. NOT the "previously WORKED" question (that is its own
        // rule); this is about a prior APPLICATION.
        match: /have you[^?]{0,40}applied[^?]{0,40}(before|previously|in the past|to (us|this))|previously applied|prior application|submitted an application (to|with)[^?]{0,30}before|đã (từng )?(ứng tuyển|nộp đơn)/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'age_confirmation',
        // "Are you 16 of age or above?" — a universal minimum-age screen. The
        // candidate is applying to a professional job, so Yes / "I confirm" is the
        // true answer (and the CV's own DOB backs it). Pattern, not per-job.
        match: /\b(16|18|sixteen|eighteen)\b[^?]{0,25}(years?|of age|or (older|above|over))|are you[^?]{0,20}(over |at least |aged )?(16|18)\b|đủ (16|18) tuổi|(16|18)\+/i,
        candidates: ['i confirm', 'yes', 'confirm', 'có', 'i am'],
    },
    {
        kind: 'physical_demands',
        // "Working in the warehouse can be physically demanding… please confirm
        // this is ok?" — measured on Maersk (R192834). Same family as travel: to
        // apply to a role IS to state you can do it as described; the confirmation
        // sits in the review list for the candidate to reconsider before submit.
        match: /physical(ly)? (demanding|able|fit)|stand(ing)? (for )?long|heavy lift|lift(ing)? (heavy|up)|manual (labour|labor|handling)|(confirm|okay|are you able)[^?]{0,60}(physical|warehouse|standing|demanding)/i,
        candidates: ['i confirm', 'yes', 'confirm', 'có', 'i am able'],
    },
    {
        kind: 'shift_preference',
        // "What shift do you prefer?" — a preference the applicant states. The
        // application-positive, least-limiting answer is "Any shift" / flexible;
        // it sits in the review list and the candidate narrows it if they must.
        match: /shift[^?]{0,25}(prefer|available|would you|do you|can you work)|preferred shift|shift preference|which shift|ca (làm việc|nào)/i,
        candidates: ['any shift', 'any', 'flexible', 'no preference', 'all shifts', 'bất kỳ'],
    },
    {
        kind: 'certifications',
        // "Do you hold the professional certifications and/or clearance as
        // outlined in the job description?" This IS answerable from the CV, and
        // the reason it wasn't is that the CV's certifications were never sent
        // to the model (only education + languages were). Now: no certificate
        // anywhere in the CV → the honest answer is No / Not applicable, said
        // here without a model call. When the CV DOES list certificates,
        // whether they are the ones this job names is a judgement, so this
        // yields (returns null) and the inference makes it with the list in hand.
        // Question-shaped ONLY. A bare /certification/ also matches Workday's
        // "Certifications" SECTION, whose dropdown lists certificate names —
        // and "No" is a substring of "Notary Public". This must fire on the
        // screening question and nothing else.
        match: /(do you (hold|have|possess)|are you)[^?]{0,80}(certification|certificate|licen[cs]ure|clearance)|certification[^?]{0,40}(as outlined|required (by|for)|for this (role|position))|bạn có[^?]{0,40}chứng chỉ/i,
        // No CV at all is not evidence of absence — only a CV we have READ and
        // which lists nothing answers "No".
        fromCv: (cv) => (!cv ? null : (cv.certifications || []).length ? null : ['no', 'not applicable', 'không']),
        candidates: [],
    },
    {
        kind: 'company_ties',
        // Stock, shares, board seats, financial ties to the HIRING company.
        // User decision 2026-08-02: "No" unless the CV states such a tie —
        // this product's candidates left MNC employers and as a rule keep no
        // positions in them; the answer sits in the review list like every
        // agent default. (\bshares\b plural only: "share your…" is a verb.)
        match: /\bstocks?\b|\bshares\b|sharehold|equity (in|of)|securities|board (member|of directors)|financial interest|affiliat(ed|ion) with|cổ phần|cổ phiếu|cổ đông/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'restrictive_covenant',
        // "Do you have an agreement with your current or previous employer (e.g.
        // non-compete…)?" Formerly recognised but never answered. User decision
        // 2026-08-02: default "No" when the CV carries no such agreement — the
        // candidate corrects it at review if they actually signed one.
        match: /non[- ]?compete|non[- ]?solicit|restrictive covenant|agreement or requirement with your (current|previous) employer|cam kết không cạnh tranh/i,
        candidates: ['no', 'không'],
    },
    {
        kind: 'work_authorization',
        // Profile wins when present. Otherwise the home-market default (user
        // decision 2026-08-02): a VN candidate on a VN-located job IS
        // authorized. REVISIT for abroad jobs — there "yes" would be a
        // material misstatement.
        match: /legally authoriz|legally entitled|right to work|work permit|authorized to work|được phép làm việc/i,
        profileKeys: ['workAuthorized'],
        candidates: ['yes', 'có'],
    },
    {
        kind: 'sponsorship',
        // Mirror image of the above: profile wins; home-market default "No"
        // (same 2026-08-02 decision + the same abroad-jobs caveat).
        match: /sponsor|visa support|require sponsorship|bảo lãnh/i,
        profileKeys: ['requiresSponsorship'],
        candidates: ['no', 'không'],
    },
    {
        kind: 'acknowledgement',
        // "I have read and understand…" — mandatory to advance, so it is answered.
        // The boundary is submission: the user reads the review and presses Submit
        // themselves, and gating this instead only stopped the application one step
        // short of that review.
        match: /acknowledg|i have read|i understand|confirm(ed)? that i have read|tôi đã đọc/i,
        candidates: ['yes', 'i agree', 'i acknowledge', 'đồng ý', 'có'],
    },
    {
        // APPLICATION-scoped communication/processing consents — user decision
        // 2026-08-04, measured on Visa: "may reach out via SMS regarding my
        // application" and "may use automated tools such as AI to support
        // review of your application" both Opt-In, for flow smoothness. This
        // is NOT marketing consent: the match requires the application scope
        // in the wording, and a newsletter/promo opt-in stays untouched.
        kind: 'application_consent',
        match: /(sms|text message|automated tools|use of ai|\bai\b).{0,80}(application|review of your|ứng tuyển|hồ sơ)/i,
        candidates: ['opt-in', 'opt in', 'yes', 'i agree', 'đồng ý'],
    },
    {
        // "I consent to receive communication, including electronic
        // communication, from PwC in relation to my application." Same family as
        // the rule above and stalled the PwC run. Scope is what keeps this
        // honest: the wording must tie the consent to THIS recruitment, and the
        // deny list keeps marketing/newsletter opt-ins out — nobody signs a
        // candidate up for promotional mail to advance a form.
        kind: 'recruitment_communication_consent',
        match: /consent to (receive|be contacted).{0,80}(communication|contact|email|sms)|receive communication.{0,60}(recruit|application|job|position|vacanc)/i,
        deny: /marketing|newsletter|promotion|advertis|third[- ]part(y|ies)|quảng cáo|tiếp thị/i,
        candidates: ['yes', 'i agree', 'i consent', 'opt-in', 'opt in', 'đồng ý', 'có'],
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
            'careers website', 'career site', 'careers page', 'career page', 'company webpage', 'website', 'webpage',
            // Final rung by user decision (2026-08-03, hit on P&G whose catalogue
            // has no company-website entry): "Other" is a truthful neutral claim.
            // '=' anchors the match — substring would resolve "other" to
            // "Another job board" via the letters inside "another".
            '=other', '=khác',
        ],
    },
];

/** The rule that governs a question, or null. */
export function ruleFor(questionText) {
    const q = norm(questionText);
    if (!q) return null;
    return ANSWER_RULES.find(r => r.match.test(q) && !(r.deny && r.deny.test(q))) || null;
}

/**
 * Resolve an answer for one question.
 *
 * @param {object}   field    `{ label, questionText }` — whatever names the question
 * @param {string[]} options  the options the form actually offers (empty for free text)
 * @param {object}   profile  the synced candidate profile
 * @param {object}   cv       the structured CV, for rules that read it (certifications)
 * @returns {{value: string, source: string, kind: string}|null}
 *   null means "we have no defensible answer" — the caller leaves the field
 *   alone and it shows up in the review's outstanding list.
 */
export function resolveAnswer(field, options = [], profile = {}, cv = null) {
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

    // 1b. A rule that reads the CV. It either names candidates (the CV settles
    // the question) or yields — deliberately, so the model decides with the CV
    // evidence rather than this file guessing at relevance.
    let candidates = rule.candidates;
    if (rule.fromCv) {
        const fromCv = rule.fromCv(cv);
        if (!fromCv) return null;
        candidates = fromCv;
    }

    // 2/3. The first candidate the form actually offers. Exact match first so a
    // list containing both "No" and "Not applicable" cannot resolve "no" to the
    // wrong entry by substring. A candidate written '=other' is ANCHORED: exact
    // or prefix only — "other" lives inside "another", and a substring hit on
    // "Another job board" is a wrong claim, not a fallback.
    for (const raw of candidates) {
        const anchored = raw.startsWith('=');
        const cand = anchored ? raw.slice(1) : raw;
        const hit = offered.find(o => o.n === cand)
            || offered.find(o => (anchored ? o.n.startsWith(cand) : o.n.includes(cand)));
        if (hit) return { value: hit.raw, source: ANSWER_SOURCE.AGENT_DEFAULT, kind: rule.kind };
    }

    // A free-text field with a rule but no options: only answer when the rule has
    // a single unambiguous candidate (Yes/No questions rendered as text are rare).
    if (offered.length === 0 && candidates.length) {
        return { value: candidates[0].replace(/^=/, ''), source: ANSWER_SOURCE.AGENT_DEFAULT, kind: rule.kind };
    }

    // 4. Nothing defensible. Better an empty field the review names than an
    //    invented fact on a submitted application.
    return null;
}
