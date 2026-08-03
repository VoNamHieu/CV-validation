// What this page NEEDS, where each answer comes from, and whether what is
// already on the form agrees with the candidate's own data.
//
// Until now that judgement was spread across four places that could not see each
// other: the recipe bound selectors to values, answers.js matched question text
// to rules, the planner prompt handled the rest, and nothing at all checked what
// the ATS had already filled in. So a field the recipe did not name and no rule
// matched went straight to the LLM, and a field the ATS parsed WRONG was skipped
// entirely — the recipe treats any non-empty value as done.
//
// The pipeline here is one pass over the observed fields:
//
//     list what is needed
//        → resolve deterministically (semantic key → canonical data)
//        → what is still unresolved is a GAP (the LLM's job, or the user's)
//        → what is already filled is VERIFIED against the canonical data
//
// Deliberately pure: descriptors in, decisions out, no DOM and no network. The
// judgement is the part worth testing, and it needs neither.

import { resolveAnswer } from './answers.js';

/** Where an answer came from, most trustworthy first. */
export const SOURCE = {
    PROFILE: 'PROFILE',           // the candidate's own data
    CV: 'CV',                     // the structured CV
    AGENT_DEFAULT: 'AGENT_DEFAULT', // a product default (postal code, "No" to previous-employee)
    INFERRED: 'INFERRED',         // derived by the planner from evidence
};

/** Outcome of comparing what is on the form against what the candidate says. */
export const VERDICT = {
    MATCH: 'MATCH',                 // identical once normalised
    NORMALIZED: 'NORMALIZED_MATCH', // same fact, different formatting
    MISMATCH: 'MISMATCH',           // the form disagrees with the candidate
    UNVERIFIABLE: 'UNVERIFIABLE',   // we hold nothing to compare against
};

/**
 * Semantic keys — the concepts an application form asks about, independent of
 * which ATS is asking or what it calls the field.
 *
 * `path` reads the structured CV; `profileKey` reads the flat profile. A key with
 * NEITHER is one no stored data can answer (see `userOnly`), which is exactly the
 * set worth reporting back to the app so it can ask once and stop asking.
 */
export const FIELD_PATTERNS = [
    { key: 'firstName', match: /first name|given name|tên(?! đệm)/i, profileKey: 'firstName' },
    { key: 'lastName', match: /last name|family name|surname|họ/i, profileKey: 'lastName' },
    { key: 'fullName', match: /full name|họ (và |và tên|tên)/i, profileKey: 'fullName' },
    { key: 'email', match: /e-?mail/i, profileKey: 'email' },
    // The phone NUMBER only. /phone/ also matched "Phone Extension" (the whole
    // mobile number got typed into it), "Phone Device Type" and "Country Phone
    // Code" (both flagged as mismatches against the number on every run) —
    // none of them holds a number.
    { key: 'phone', match: /phone(?!\s*extension)|mobile|điện thoại|số đt/i, deny: /extension|\bext\.?\b|máy lẻ|device\s*type|country\s*phone\s*code|loại (điện thoại|máy)/i, profileKey: 'phone' },
    { key: 'addressStreet', match: /address line ?1|street|địa chỉ/i, profileKey: 'addressStreet' },
    { key: 'addressDistrict', match: /district|town|city\b|quận|huyện|thành phố/i, profileKey: 'addressDistrict' },
    { key: 'addressProvince', match: /province|region|state|tỉnh/i, profileKey: 'addressProvince' },
    { key: 'postalCode', match: /postal|zip|mã bưu/i, profileKey: 'postalCode' },
    { key: 'gpa', match: /\bgpa\b|grade (average|point)|overall result|điểm trung bình/i, path: 'education[0].gpa', userOnly: true },
    { key: 'school', match: /school|university|college|institution|trường/i, path: 'education[0].institution' },
    { key: 'fieldOfStudy', match: /field of study|major|subject|chuyên ngành|ngành học/i, path: 'education[0].degree' },
    { key: 'degree', match: /\bdegree\b|qualification|bằng cấp|trình độ/i, profileKey: 'highestDegree' },
    { key: 'language', match: /\blanguage\b|ngôn ngữ/i, path: 'languages[0].language' },
    // `overall` is how Workday labels language proficiency － but "Overall Result
    // (GPA)" starts the same way, and patterns are first-match, so the grade
    // field was being read as a fluency level. Excluded explicitly rather than
    // relying on the order of two unrelated entries staying correct.
    { key: 'languageLevel', match: /proficiency|fluency|trình độ ngôn ngữ|overall(?!\s*result)/i, path: 'languages[0].level' },
    { key: 'currentTitle', match: /job title|current (job )?title|position|chức danh/i, profileKey: 'currentTitle' },
    { key: 'currentCompany', match: /employer|company name|công ty/i, path: 'experience[0].company' },
    // Two different asks, and conflating them is what put a CV summary in a
    // hiring-team message box: a "cover letter" field takes the long document,
    // a "message" box takes the short note. Ordered specific-first.
    { key: 'coverLetter', match: /cover letter|motivation letter|thư giới thiệu|thư xin việc/i, profileKey: 'coverLetter' },
    { key: 'applyMessage', match: /\bmessage\b|note to|lời nhắn|tin nhắn/i, profileKey: 'applyMessage' },

    // Knowable ONLY to the candidate. Listed so the manifest can name them rather
    // than leaving the caller to discover them by failing.
    { key: 'salaryExpectation', match: /salary|compensation|mức lương/i, profileKey: 'desiredSalary', userOnly: true },
    { key: 'noticePeriod', match: /notice period|thời gian báo trước/i, profileKey: 'noticePeriod', userOnly: true },
    { key: 'workAuthorization', match: /legally authoriz|right to work|work permit/i, profileKey: 'workAuthorized', userOnly: true },
    { key: 'sponsorship', match: /sponsor|visa support|bảo lãnh/i, profileKey: 'requiresSponsorship', userOnly: true },
];

/**
 * The flat profile's keys, mirroring frontend/src/lib/extension-profile.ts.
 *
 * Kept here as a checkable list because the two live in different packages: a
 * `profileKey` naming a field the schema does not define reads as `undefined`
 * forever, which looks exactly like "the user has not filled it in" — so the
 * field is reported as a gap the user can never close. Five keys were in that
 * state (gpa, postalCode, noticePeriod, workAuthorized, requiresSponsorship)
 * before the schema caught up. tests/needs.test.js asserts the two agree.
 */
export const PROFILE_KEYS = new Set([
    'fullName', 'firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'gender',
    'nationality', 'maritalStatus', 'addressProvince', 'addressDistrict', 'addressStreet',
    'postalCode', 'currentTitle', 'currentLevel', 'yearsOfExperience', 'highestDegree',
    'currentSalary', 'currentIndustry', 'currentFields', 'desiredLocations', 'desiredSalary',
    'noticePeriod', 'workAuthorized', 'requiresSponsorship', 'coverLetter', 'applyMessage', 'skills',
]);

/** The concept a field is asking about, or null when nothing recognises it. */
export function classifyField(field) {
    const text = [field?.label, field?.ariaLabel, field?.placeholder, field?.name, field?.automationId]
        .filter(Boolean).join(' ');
    if (!text.trim()) return null;
    // `deny` names what a pattern is NOT — "Phone Extension" contains "phone"
    // and got the whole mobile number typed into it.
    return FIELD_PATTERNS.find(p => p.match.test(text) && !(p.deny && p.deny.test(text))) || null;
}

/** Read a dotted/indexed path out of the structured CV. */
export function readPath(cv, path) {
    if (!cv || !path) return undefined;
    let node = cv;
    for (const part of String(path).split('.')) {
        const m = part.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
        if (!m || node == null) return undefined;
        node = node[m[1]];
        if (m[2] != null) node = Array.isArray(node) ? node[Number(m[2])] : undefined;
    }
    return node;
}

/** What the candidate's own data says this field should contain, if anything. */
export function canonicalValue(pattern, data) {
    if (!pattern) return null;
    const fromProfile = pattern.profileKey ? data?.profile?.[pattern.profileKey] : undefined;
    if (fromProfile != null && String(fromProfile).trim() !== '') {
        return { value: String(fromProfile), source: SOURCE.PROFILE };
    }
    const fromCv = readPath(data?.cv, pattern.path);
    if (fromCv != null && String(fromCv).trim() !== '') {
        return { value: String(fromCv), source: SOURCE.CV };
    }
    return null;
}

/** Fold away the differences that are formatting rather than meaning. */
function normalize(v) {
    return String(v ?? '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // đọc "Hà Nội" == "ha noi"
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Does what is on the form agree with what the candidate says?
 *
 * This is the half that did not exist. The recipe treats any non-empty value as
 * finished, so an ATS that parses a job title as "Consultant" when the CV says
 * "Product Owner" was left standing — the application went out with the parser's
 * mistake in it and nothing reported anything wrong.
 */
export function compareValues(expected, actual) {
    if (expected == null || String(expected).trim() === '') return VERDICT.UNVERIFIABLE;
    if (actual == null || String(actual).trim() === '') return VERDICT.UNVERIFIABLE;
    const e = String(expected).trim(); const a = String(actual).trim();
    if (e === a) return VERDICT.MATCH;
    const ne = normalize(e); const na = normalize(a);
    if (!ne || !na) return VERDICT.UNVERIFIABLE;
    if (ne === na) return VERDICT.NORMALIZED;
    // One containing the other is the shape of a truncated or expanded parse
    // ("OCG" vs "OCG Consulting"), which is the same fact written shorter.
    if (ne.includes(na) || na.includes(ne)) return VERDICT.NORMALIZED;
    return VERDICT.MISMATCH;
}

/**
 * One pass over the observed fields.
 *
 * @param {object[]} fields  observed form fields (from observePageState)
 * @param {{profile?: object, cv?: object}} data  the candidate's own data
 * @returns {{fill: object[], verify: object[], gaps: object[]}}
 *   `fill`   — empty fields we can answer deterministically, with provenance
 *   `verify` — filled fields checked against canonical data (mismatches included)
 *   `gaps`   — required fields nothing deterministic can answer. `userOnly:true`
 *              marks the ones no inference should attempt either.
 *   `override` — filled fields the candidate's data DISAGREES with, and which can
 *              be corrected unambiguously. A mismatch that is not safely
 *              correctable stays in `verify` for the review to name.
 */
export function buildManifest(fields = [], data = {}) {
    const fill = []; const verify = []; const gaps = []; const override = [];

    // How many fields on THIS page ask for the same concept. A page with two
    // "School or University" inputs is showing two education rows, and our
    // canonical data always reads entry [0] — so we cannot tell which row is
    // which, and overriding would move the wrong school onto the wrong line.
    // Correcting is only safe where the mapping is unambiguous.
    const keyCount = new Map();
    for (const f of fields) {
        const k = classifyField(f)?.key;
        if (k) keyCount.set(k, (keyCount.get(k) || 0) + 1);
    }

    for (const f of fields) {
        // A résumé dropzone is not a QUESTION. Its answer comes from cvData via
        // the recipe's upload path — never inferred from profile text or asked
        // of the model — and once the file is in it is not a gap either (the
        // observer reports 'uploaded'). Left in, it produced a text-pipeline
        // gap literally labelled "Drop files hereor".
        if (f.componentType === 'file-upload') continue;
        const label = f.label || f.ariaLabel || f.placeholder || f.nearbyText || '';
        const pattern = classifyField(f);
        const canonical = canonicalValue(pattern, data);
        // A checkbox answers with its CHECKED state, and the observer spells
        // that 'true'/'false' — so the string 'false' read as "non-empty, hence
        // answered", and every unchecked box (the terms acknowledgement, most
        // visibly) sailed past the answer rules into the verify pile.
        const filled = f.componentType === 'checkbox'
            ? f.value === 'true'
            : String(f.value ?? '').trim() !== '';

        if (filled) {
            // Already answered — by the ATS parse, or by an earlier pass.
            const verdict = compareValues(canonical?.value, f.value);
            const entry = {
                selector: f.selector, label, key: pattern?.key ?? null,
                expected: canonical?.value ?? null, actual: f.value, verdict,
            };
            verify.push(entry);

            // The candidate's own data is the source of truth: they wrote and
            // approved it, while the ATS value is a machine's guess at a PDF. So a
            // disagreement is corrected, not merely reported — but only where the
            // correction is certainly the right one:
            //
            //   · the concept appears ONCE on the page, so there is no question
            //     which entry the field belongs to (see keyCount above), and
            //   · the control is a plain text input. Overwriting a committed
            //     dropdown means deselecting first, and a half-applied change to a
            //     select is worse than a flagged one.
            const textish = !f.componentType || f.componentType === 'native';
            if (verdict === VERDICT.MISMATCH && pattern && keyCount.get(pattern.key) === 1 && textish) {
                override.push({ ...entry, value: canonical.value, source: canonical.source, componentType: f.componentType });
            }
            continue;
        }

        if (canonical) {
            // A checkbox takes YES or NO — a canonical STRING routed at one is a
            // classification accident ("I am fluent in this language." matched
            // the language pattern and got «Vietnamese»), and pushing it made an
            // un-fillable instruction the loop retried forever. Boolean-ish
            // values pass; anything else leaves the box to the recipe/rules.
            if (f.componentType === 'checkbox'
                && !/^(yes|no|true|false|có|không|1|0)$/i.test(String(canonical.value ?? '').trim())) {
                continue;
            }
            fill.push({
                selector: f.selector, label, key: pattern.key,
                value: canonical.value, source: canonical.source,
                componentType: f.componentType,
            });
            continue;
        }

        // Nothing stored answers it. A rule might (Yes/No screening, disclosures).
        const options = (f.options || []).map(o => o.text || o.value).filter(Boolean);
        const ruled = resolveAnswer({ label, questionText: label }, options, data.profile || {});
        if (ruled) {
            fill.push({
                selector: f.selector, label, key: pattern?.key ?? ruled.kind,
                value: ruled.value, source: ruled.source, componentType: f.componentType,
            });
            continue;
        }

        if (f.required) {
            gaps.push({
                selector: f.selector, label, key: pattern?.key ?? null,
                userOnly: !!pattern?.userOnly, options,
                // The free-answer pass needs the widget shape to know which
                // gaps it can put to the model (selects only — never free text).
                componentType: f.componentType,
            });
        }
    }

    return { fill, verify, gaps, override };
}

/** The compact shape worth reporting to the app: what this page asked for that
 *  the candidate's stored data could not answer. Feeding this back is how the
 *  product learns which fields to collect ONCE instead of stalling per company. */
export function summarizeGaps(manifest) {
    const gaps = manifest?.gaps || [];
    return {
        total: gaps.length,
        userOnly: gaps.filter(g => g.userOnly).map(g => g.key || g.label),
        inferable: gaps.filter(g => !g.userOnly).map(g => g.key || g.label),
        mismatches: (manifest?.verify || [])
            .filter(v => v.verdict === VERDICT.MISMATCH)
            .map(v => ({ field: v.label, expected: v.expected, actual: v.actual })),
    };
}
