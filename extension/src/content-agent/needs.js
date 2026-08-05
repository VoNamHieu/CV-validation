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
import { foldDiacritics, normalizeNameCase } from './dom.js';

/**
 * The middle name, when the profile's own tokens contain one. "VO NAM HIEU"
 * splits into first/last and the NAM in the middle simply vanished — while
 * P&G renders "Intercalary (or Middle) Name" REQUIRED, in both scripts.
 * Derivation is subtractive only: whatever full-name tokens the first and
 * last names do not claim (parenthesised nicknames dropped first). When
 * nothing is left, there is no middle name to state — the field stays a
 * named gap rather than an invention.
 */
function deriveMiddleName(data) {
    const p = data?.profile || {};
    const full = String(p.fullName || '').replace(/\([^)]*\)/g, ' ');
    if (!full.trim()) return null;
    const tokens = (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
    const claimed = new Set([...tokens(p.firstName), ...tokens(p.lastName)]);
    const mid = full.split(/\s+/).filter(Boolean).filter(w => !claimed.has(w.toLowerCase()));
    return mid.length ? mid.join(' ') : null;
}

/**
 * The earliest date the candidate can start, when only the NOTICE PERIOD is
 * stored. "30 days" is a commitment the candidate already made; today + 30
 * is its honest date form (measured on PwC: "What is your earliest available
 * start date?" is a REQUIRED full date and no profile field held one). An
 * explicit availableStartDate always wins via profileKey; this fires only
 * beneath it. Returns ISO (YYYY-MM-DD) — setDateOnWrap parses that shape.
 */
function deriveStartDate(data) {
    const p = data?.profile || {};
    const days = noticeDays(p.noticePeriod);
    if (days == null) return null;
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "30 days" / "2 tuần" / "1 month" → a day count, or null. */
function noticeDays(text) {
    const m = String(text || '').match(/(\d+)\s*(day|ngày|week|tuần|month|tháng)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    return /week|tuần/.test(unit) ? n * 7 : /month|tháng/.test(unit) ? n * 30 : n;
}

/**
 * The other direction (user rule 2026-08-05): when the candidate stored the DATE
 * they can start but not a notice period, "How much notice do you need to give?"
 * is that date minus today. Both facts are the same commitment written two ways,
 * and a form asking for the one we didn't store used to stall the run.
 * Days below a week are reported as days; otherwise whole weeks read naturally.
 */
function deriveNoticePeriod(data) {
    const p = data?.profile || {};
    const iso = String(p.availableStartDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const start = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((start.getTime() - today.getTime()) / 86400000);
    if (days <= 0) return 'Immediately';
    if (days < 7) return `${days} days`;
    const weeks = Math.round(days / 7);
    return weeks % 4 === 0 ? `${weeks / 4} months` : `${weeks} weeks`;
}

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
    // Dual-script blocks (measured on P&G VN): every Name/Address field is
    // rendered twice — "… - Vietnamese" and "… - Western Script" — and all of
    // them required. No dedicated handling is needed for the SUFFIX: these
    // patterns match by substring, so both variants resolve to the same
    // profile fact (a Vietnamese name typed without diacritics is still the
    // candidate's name). What WAS missing: a middle-name concept, an Address
    // Line 2 concept, and the city fallback at this layer.
    //
    // Before firstName: "Tên đệm" contains "tên", and first-match order is
    // the only thing keeping the middle name out of the given-name box.
    {
        key: 'middleName', match: /middle name|intercalary|tên đệm/i,
        profileKey: 'middleName', normalize: 'name', derive: deriveMiddleName,
    },
    { key: 'firstName', match: /first name|given name|tên(?! đệm)/i, profileKey: 'firstName', normalize: 'name' },
    { key: 'lastName', match: /last name|family name|surname|họ/i, profileKey: 'lastName', normalize: 'name' },
    { key: 'fullName', match: /full name|họ (và |và tên|tên)/i, profileKey: 'fullName', normalize: 'name' },
    { key: 'email', match: /e-?mail/i, profileKey: 'email' },
    // The phone NUMBER only. /phone/ also matched "Phone Extension" (the whole
    // mobile number got typed into it), "Phone Device Type" and "Country Phone
    // Code" (both flagged as mismatches against the number on every run) —
    // none of them holds a number.
    { key: 'phone', match: /phone(?!\s*extension)|mobile|điện thoại|số đt/i, deny: /extension|\bext\.?\b|máy lẻ|device\s*type|country\s*phone\s*code|loại (điện thoại|máy)/i, profileKey: 'phone' },
    // City name as the LAST resort before empty — user decision (a CV that
    // only names "Hà Nội" still answers a required street/district box with
    // that city rather than stalling the run). The recipe applies the same
    // rule via fallbackProfileKey; this copy serves the label-matched fields
    // the recipe has no selector for (the "- Vietnamese" duplicates).
    { key: 'addressStreet', match: /address line ?1|street|địa chỉ/i, profileKey: 'addressStreet', fallbackKeys: ['addressDistrict', 'addressProvince'] },
    { key: 'addressStreet2', match: /address line ?2/i, profileKey: 'addressStreet2', fallbackKeys: ['addressDistrict', 'addressProvince'] },
    { key: 'addressDistrict', match: /district|town|city\b|quận|huyện|thành phố/i, profileKey: 'addressDistrict', fallbackKeys: ['addressProvince'] },
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
    // `position` names the title field on most ATSs — but it is also the word
    // every screening QUESTION uses for the job being applied to ("…authorised
    // to work in the country in which the position is based?", "…sponsor your
    // visa for the position you are applying for?"). Measured on PwC: three
    // required Yes/No questions were routed the profile's job title, which no
    // Yes/No list offers, and only the model rescued them — three calls, ~20s
    // each, for answers the policy rules below already hold. So: question-shaped
    // labels are not title fields.
    {
        key: 'currentTitle',
        match: /job title|current (job )?title|position|chức danh|chức vụ/i,
        deny: /\?|^(are|do|does|did|have|has|will|would|can|could|is|were) you\b|\bi (agree|consent|acknowledge)\b|bạn có/i,
        profileKey: 'currentTitle',
    },
    { key: 'currentCompany', match: /employer|company name|công ty/i, path: 'experience[0].company' },
    // Two different asks, and conflating them is what put a CV summary in a
    // hiring-team message box: a "cover letter" field takes the long document,
    // a "message" box takes the short note. Ordered specific-first.
    { key: 'coverLetter', match: /cover letter|motivation letter|thư giới thiệu|thư xin việc/i, profileKey: 'coverLetter' },
    { key: 'applyMessage', match: /\bmessage\b|note to|lời nhắn|tin nhắn/i, profileKey: 'applyMessage' },

    // Knowable ONLY to the candidate. Listed so the manifest can name them rather
    // than leaving the caller to discover them by failing.
    { key: 'salaryExpectation', match: /salary|compensation|mức lương/i, profileKey: 'desiredSalary', userOnly: true },
    // Stored notice wins; else it is the stored start DATE minus today (the same
    // commitment, written the other way round). userOnly still holds for the case
    // where neither exists — nobody can guess it from a CV.
    { key: 'noticePeriod', match: /notice period|how much notice|thời gian báo trước/i, profileKey: 'noticePeriod', derive: deriveNoticePeriod, userOnly: true },
    // "What is your earliest available start date?" (PwC, REQUIRED, a full
    // date). The stored date wins; else it derives from the notice period.
    { key: 'availableStartDate', match: /earliest available|available start date|available to start|when (can|could) you start|ngày có thể bắt đầu/i, profileKey: 'availableStartDate', derive: deriveStartDate },
    { key: 'workAuthorization', match: /legally authoriz|right to work|work permit/i, profileKey: 'workAuthorized', userOnly: true },
    { key: 'sponsorship', match: /sponsor|visa support|bảo lãnh/i, profileKey: 'requiresSponsorship', userOnly: true },
    // Unilever asks it REQUIRED ("Do you hold a valid driver's license?*") —
    // knowable only to the candidate, collected once in the web app profile.
    { key: 'driversLicense', match: /driver'?s? licen[cs]e|giấy phép lái xe|bằng lái/i, profileKey: 'driversLicense', normalize: 'yesno', userOnly: true },
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
    'fullName', 'firstName', 'middleName', 'lastName', 'email', 'phone', 'dateOfBirth', 'gender',
    'nationality', 'maritalStatus', 'addressProvince', 'addressDistrict', 'addressStreet', 'addressStreet2',
    'postalCode', 'currentTitle', 'currentLevel', 'yearsOfExperience', 'highestDegree',
    'currentSalary', 'currentIndustry', 'currentFields', 'desiredLocations', 'desiredSalary',
    'noticePeriod', 'availableStartDate', 'workAuthorized', 'requiresSponsorship', 'driversLicense', 'coverLetter', 'applyMessage', 'skills',
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
    // Same rule the recipe applies via `normalize: 'name'` — ALL-CAPS names
    // raise a Workday capitalization advisory on every application. 'yesno'
    // bridges the profile's Vietnamese ("Có"/"Không") onto the Yes/No options
    // every ATS actually offers.
    const shape = (v) => {
        const s = String(v);
        if (pattern.normalize === 'name') return normalizeNameCase(s);
        if (pattern.normalize === 'yesno') {
            if (/^(yes|y|có|co|true|1)$/i.test(s.trim())) return 'Yes';
            if (/^(no|không|khong|false|0)$/i.test(s.trim())) return 'No';
        }
        return s;
    };
    const fromProfile = pattern.profileKey ? data?.profile?.[pattern.profileKey] : undefined;
    if (fromProfile != null && String(fromProfile).trim() !== '') {
        return { value: shape(fromProfile), source: SOURCE.PROFILE };
    }
    const fromCv = readPath(data?.cv, pattern.path);
    if (fromCv != null && String(fromCv).trim() !== '') {
        return { value: shape(fromCv), source: SOURCE.CV };
    }
    // Derived from the user's own data (middle name out of the full name) —
    // still their fact, just not stored under its own key.
    if (pattern.derive) {
        const v = pattern.derive(data);
        if (v != null && String(v).trim() !== '') return { value: shape(v), source: SOURCE.PROFILE };
    }
    // Coarser profile keys as the last resort before empty (street → district
    // → city). A vaguer truth beats a stranded required field; AGENT_DEFAULT
    // is what makes the review name it.
    for (const k of pattern.fallbackKeys || []) {
        const v = data?.profile?.[k];
        if (v != null && String(v).trim() !== '') return { value: String(v), source: SOURCE.AGENT_DEFAULT };
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
    // The concept count is SCRIPT-SCOPED: on a dual-script page the same key
    // appears twice by design ("Family Name - Vietnamese" beside "Family Name
    // - Western Script"), and counting them together made every name field
    // "ambiguous" — which is precisely what let Workday's parser keep a
    // swapped family/given pair uncorrected. Two School boxes in the SAME
    // script still count as two (two education rows — genuinely ambiguous).
    const VI_HALF_RE = /vietnamese|tiếng việt/;
    const scriptHalf = (f) => (VI_HALF_RE.test(String(f.label || f.ariaLabel || '').toLowerCase()) ? 'vi' : 'west');
    const keyCount = new Map();
    for (const f of fields) {
        const k = classifyField(f)?.key;
        if (k) {
            const kk = `${k}::${scriptHalf(f)}`;
            keyCount.set(kk, (keyCount.get(kk) || 0) + 1);
        }
    }

    // Script-aware duplicates (measured on P&G): the "- Western Script" half
    // of a dual-script pair takes the same fact WITHOUT diacritics; the
    // "- Vietnamese" half keeps them. A PLAIN label is also the western half
    // whenever its Vietnamese twin sits on the same page — P&G suffixes only
    // the local-script address boxes ("Address Line 1 - Vietnamese" beside a
    // bare "Address Line 1"). On a page with no twin, values pass unchanged.
    const allLabels = fields.map(f => String(f.label || f.ariaLabel || '').trim().toLowerCase());
    const hasViTwin = (label) => {
        const base = String(label).trim().toLowerCase();
        return !!base && allLabels.some(l => l !== base && l.startsWith(base) && /vietnamese|tiếng việt/.test(l));
    };
    const shapeScript = (label, value) => {
        const l = String(label).toLowerCase();
        if (/vietnamese|tiếng việt/.test(l)) return value;
        if (/western script|romanized|latin/.test(l) || hasViTwin(label)) return foldDiacritics(value);
        return value;
    };

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

        // ── The local-script half of a NAME, when the CV has no local-script
        // name to give (user rule 2026-08-04). The profile's "Vo"/"Hieu" is
        // the ENGLISH spelling; writing it into "… - Vietnamese" claims a
        // Vietnamese name that does not exist in the data. So: an OPTIONAL
        // local box stays empty — and parser junk in it (measured on Visa:
        // family and given SWAPPED, nickname included) is CLEARED, because a
        // scrambled name is worse than an empty optional box. A REQUIRED one
        // falls through and takes the English name instead. When the CV name
        // DOES carry diacritics, none of this fires and both halves fill
        // normally (Vietnamese keeps its marks, Western folds them).
        const NAME_KEYS = ['firstName', 'lastName', 'middleName', 'fullName'];
        if (pattern && NAME_KEYS.includes(pattern.key) && canonical
            && VI_HALF_RE.test(String(label).toLowerCase())
            && canonical.value === foldDiacritics(canonical.value)
            && !f.required) {
            const cur = String(f.value ?? '').replace(/\s+/g, ' ').trim();
            const wantN = canonical.value.replace(/\s+/g, ' ').trim().toLowerCase();
            if (cur && cur.toLowerCase() !== wantN) {
                override.push({
                    selector: f.selector, label, key: pattern.key,
                    expected: '', actual: f.value, verdict: VERDICT.MISMATCH,
                    value: '', source: SOURCE.AGENT_DEFAULT, componentType: f.componentType,
                });
            }
            continue;
        }

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
            const scopedOnce = pattern && keyCount.get(`${pattern.key}::${scriptHalf(f)}`) === 1;
            if (verdict === VERDICT.MISMATCH && scopedOnce && textish) {
                override.push({ ...entry, value: shapeScript(label, canonical.value), source: canonical.source, componentType: f.componentType });
            } else if (scopedOnce && textish && canonical
                && NAME_KEYS.includes(pattern.key)
                && (verdict === VERDICT.MATCH || verdict === VERDICT.NORMALIZED)) {
                // Same fact, wrong SHAPE (user decision 2026-08-04): "VO" is
                // the same name as "Vo" but raises Workday's capitalization
                // advisory on every application, and the western half must
                // not keep diacritics the fold would remove. Re-case/refold
                // to the canonical spelling; converges in one pass — once the
                // box says "Vo", shaped equals it and nothing fires.
                const shaped = shapeScript(label, canonical.value);
                if (shaped && String(f.value).trim() !== String(shaped).trim()) {
                    override.push({ ...entry, value: shaped, source: canonical.source, componentType: f.componentType });
                }
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
                value: shapeScript(label, canonical.value), source: canonical.source,
                componentType: f.componentType,
            });
            continue;
        }

        // Nothing stored answers it. A rule might (Yes/No screening, disclosures).
        const options = (f.options || []).map(o => o.text || o.value).filter(Boolean);
        const ruled = resolveAnswer({ label, questionText: label }, options, data.profile || {}, data.cv || null);
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
