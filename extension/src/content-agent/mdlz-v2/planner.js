/**
 * What this page still needs, decided fresh every time it is asked.
 *
 * The planner answers two questions and nothing else: which rows should exist,
 * and what belongs in each field of them. It writes nothing — every descriptor
 * it returns is data, and the executors are what touch the page.
 *
 * THE MEASUREMENT THIS FILE IS BUILT AROUND: a form ended up with three
 * "Vietnamese" rows under a red "Duplicate language entries are not allowed."
 * Two independent defects met there. The grow loop read its work list ONCE and
 * never recomputed it, so every pass acted on a page that had already changed;
 * and the planner behind it skipped empty rows entirely, so a blank row already
 * on the page counted for nothing and "Add" kept being clicked until the section
 * hit its cap. Those blanks were then somewhere to put a language, and each
 * concurrent pass put the same one in a different one.
 *
 * So, three rules, and they are the whole design:
 *
 *   1. THE PLAN IS RE-DERIVED FROM THE PAGE, never remembered. It is cheap, and
 *      a remembered plan is a plan about a page that no longer exists.
 *   2. A ROW IS CLAIMED BY CONTENT, never by index. An entry finds its row by
 *      what the row says; only then, failing that, does it take an empty one.
 *   3. NOTHING IS ADDED WHILE AN EMPTY ROW EXISTS. An empty row is not "no row",
 *      it is somewhere to put the next entry.
 */

import { COPY, MONTHS, SEL } from './config.js';
import { fieldByLabel, fieldIn, isEmptyRow, rowsOf, valueIn } from './row.js';
import { fold } from './text.js';
import { trace } from '../trace.js';

/**
 * A CV date, as month and year.
 *
 * The shapes that actually arrive: ISO (`2021-03-01`), `MM/YYYY`, and a named
 * month with a year. "Present"/"hiện tại" is not a date — it is the checkbox.
 */
export function monthYear(value) {
    const t = String(value || '').trim();
    if (!t || /^(hiện tại|hien tai|present|current|now|nay)$/i.test(t)) return null;
    const iso = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (iso) return { month: Number(iso[2]), year: Number(iso[1]) };
    const year = (t.match(/\b(19|20)\d{2}\b/) || [])[0];
    if (!year) return null;
    const named = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}`, 'i').test(t));
    const numeric = (t.match(/\b(0?[1-9]|1[0-2])\b(?!\d)/) || [])[0];
    const month = named >= 0 ? named + 1 : (numeric ? Number(numeric) : null);
    return month ? { month, year: Number(year) } : null;
}

/** Is this experience still going? The CV says so in words, or by omission. */
const isCurrent = (e) => /^(hiện tại|hien tai|present|current|now|nay)$/i.test(String(e?.end_date || '').trim())
    || (!!e?.start_date && !e?.end_date);

/**
 * The sections of My Experience, as specifications.
 *
 * A section is its anchor, the fields a row of it carries, and the key that
 * says which entry a row already holds. Adding Education and Languages is
 * therefore data, not another copy of the loop that fills Work Experience.
 */
export const SECTIONS = [
    {
        name: 'work',
        anchor: SEL.row.jobTitle,
        entries: (cv) => (cv?.experience || []),
        /** What identifies a row of this section, read off the page. */
        keyOf: (row) => fold(`${valueIn(row, 'formField-jobTitle')}@${valueIn(row, 'formField-companyName')}`),
        keyOfEntry: (e) => fold(`${e.title || ''}@${e.company || ''}`),
        /** A looser match, for a row half-written by an earlier pass. */
        partialOf: (row) => fold(valueIn(row, 'formField-jobTitle')),
        partialOfEntry: (e) => fold(e.title || ''),
        emptyWhen: ['formField-jobTitle', 'formField-companyName'],
        fields: (e) => [
            { id: 'formField-jobTitle', want: e.title },
            { id: 'formField-companyName', want: e.company },
            { id: 'formField-roleDescription', want: e.description, optional: true },
            { id: 'formField-currentlyWorkHere', want: isCurrent(e), when: () => isCurrent(e) },
            { id: 'formField-startDate', want: monthYear(e.start_date) },
            { id: 'formField-endDate', want: monthYear(e.end_date), when: () => !isCurrent(e) },
        ],
    },
    {
        name: 'education',
        // The anchor matches BOTH measured row shapes (see SEL.row.schoolName):
        // mdlz's free-text schoolName and PwC's school PICKER. Every reading
        // below asks both ids and takes whichever the tenant rendered.
        anchor: SEL.row.schoolName,
        entries: (cv) => (cv?.education || []),
        keyOf: (row) => fold(valueIn(row, 'formField-schoolName') || valueIn(row, 'formField-school')),
        keyOfEntry: (e) => fold(e.institution || e.school || ''),
        // The picker commits the CATALOGUE's name for the school, not the CV's
        // spelling — the row must still be claimable by the entry that put it
        // there, or the next pass reads it as nobody's and Adds again (the PwC
        // runaway, one layer up). The catalogue hit was FOUND by searching the
        // CV's own name, so one contains the other; and a committed "School Not
        // Listed" is the fallback rung's own honest answer, claimable by the
        // entry that fell to it.
        keyMatches: (rowKey, entryKey) => {
            if (!rowKey) return false;
            if (/school not listed/.test(rowKey)) return true;
            const stem = (s) => String(s || '').replace(/[(（][^)）]*[)）]?/g, ' ').replace(/\s+/g, ' ').trim();
            const a = stem(rowKey);
            const b = stem(entryKey);
            return !!a && !!b && (a.includes(b) || b.includes(a));
        },
        emptyWhen: ['formField-schoolName', 'formField-school'],
        fields: (e) => [
            // The free-text variant (mdlz). whenPresent keeps it off the picker
            // tenant, where the id simply does not render.
            { id: 'formField-schoolName', want: e.institution || e.school, whenPresent: true },
            // The PICKER variant (PwC, measured 2026-08-15): search-on-Enter,
            // same widget family as the HDYHAU cascade, so it is answered the
            // same way — a LADDER walked by typeFilterPick. The CV's own name
            // first (verbatim, then bracket-stripped), and Workday's designed
            // escape — "School Not Listed" — when the catalogue does not hold
            // it. NEVER a semantically-near catalogue school: picking a school
            // the candidate did not name rewrites their academic record.
            { id: 'formField-school', ladder: schoolLadder(e), whenPresent: true },
            // Degree is asked for as a LADDER, not a value — see degreeLadder.
            { id: 'formField-degree', ladder: degreeLadder(e), optional: true },
            // REQUIRED where it renders, and it does not render on every tenant
            // (measured: absent on mdlz, present and required on others). Planned
            // only when the row actually has it — a plan full of fields nobody
            // renders wastes a pass and hides what is really missing.
            // want is the MAJOR — from field_of_study/major, and FAILING THOSE,
            // from `degree` ONLY when that string names a subject and not a
            // qualification (fieldOfStudy()). A degree of "B.B.A." is a
            // qualification, not a major, is not on Workday's closed Field-of-
            // Study catalogue, and is never used here — the search would miss and
            // the page would gap. But the extractor mis-slots a bare subject into
            // `degree` too (MEASURED live PwC 715624WD, 2026-08-15: education
            // {degree:"Marketing"}, no field_of_study), and "Marketing" IS the
            // major the CV stated — reading it is not inventing. Salvaging it is
            // safe both ways: a real subject commits, a qualification misses the
            // catalogue and gaps exactly as an empty want would.
            //
            // NOT optional, for the same reason GPA is not: where this field
            // RENDERS it is REQUIRED (measured on the intern form), so an empty
            // major must surface as a GAP the candidate fills. `optional: true`
            // used to make an empty field_of_study produce NO task — no type, no
            // search, no gap — so the agent "did nothing" on a field the form
            // still demanded. whenPresent keeps it off the executive pages that
            // never render it, so this does not touch the executive flow.
            //
            // SINGLE-select behind the multi-select's exact DOM (probed side by
            // side vs Skills, 2026-08-13), so the contract below — not the
            // fingerprint — is what routes it to searchSelect: one term, typed
            // whole, Enter-committed on a unique result, chip REPLACED. Without
            // this declaration the router refuses the field (CONTRACT_ERROR)
            // rather than let the multi engine spread the string into
            // one-character searches again (measured, R-173704).
            { id: 'formField-fieldOfStudy', want: fieldOfStudy(e), whenPresent: true,
                capability: 'searchSelect', cardinality: 'one' },
            // "Overall Result (GPA)" — REQUIRED on the intern postings (measured
            // R-172558 Marketing Intern, 2026-08-11) and absent on the executive
            // ones the flow was built against, which is exactly why it is gated on
            // `whenPresent`: it plans nothing on a page that does not render it, so
            // adding it cannot touch the executive My Experience that already
            // works. Not optional — when it IS on the page it is required, so an
            // empty gpa is a gap the candidate fills, never a field skipped over
            // (which is how v2, blind to this field, tried to Save an invalid page
            // and stalled the whole intern run). The value comes from the CV, and
            // ONLY the CV: a plausible GPA is a fabricated academic record.
            { id: 'formField-gradeAverage', want: e.gpa, whenPresent: true },
            // Attendance years — rendered on the picker tenant (PwC, measured
            // 2026-08-15), absent on mdlz. Optional like Degree: their required-
            // ness is unmeasured, so a CV without dates must not hold the page —
            // if the tenant does demand them, Workday's own row error says so
            // and blocks the advance with a reason. "Present" yields no year,
            // and an ongoing degree rightly leaves the last year unanswered.
            { id: 'formField-firstYearAttended', want: yearOf(e.start_date), whenPresent: true, optional: true },
            { id: 'formField-lastYearAttended', want: yearOf(e.end_date), whenPresent: true, optional: true },
        ],
    },
    {
        name: 'languages',
        anchor: SEL.row.language,
        entries: (cv) => dedupeLanguages(cv?.languages || []),
        keyOf: (row) => fold(valueIn(row, 'formField-language')),
        keyOfEntry: (e) => fold(e.language || ''),
        emptyWhen: ['formField-language'],
        fields: (e) => [
            { id: 'formField-language', want: e.language },
            // Overall proficiency has a per-tenant GUID for an id, so it is
            // reached by its label INSIDE the row — never page-wide. And it is
            // asked for as a LADDER, for the same reason Degree is.
            { byLabel: /overall/i, ladder: proficiencyLadder(e.level), optional: !e.level, name: 'Overall' },
            // "I am fluent in this language." — see speaksFluently for why this
            // exists and why it keys off the same tiers as Overall. A level
            // below fluent plans nothing (want stays undefined), so a tick
            // already on the page — the ATS's parse or the candidate's own —
            // is never removed.
            { id: 'formField-native', want: speaksFluently(e.level) ? true : undefined, optional: true, whenPresent: true },
        ],
    },
];

/**
 * WHAT QUALIFICATION TO ASK THE CATALOGUE FOR — as a ladder, because the answer
 * depends on options that cannot be read until the list is open.
 *
 * MEASURED, the mdlz Degree catalogue (R-174102, 2026-08-09), 18 entries all
 * shaped `CODE - Full Name or equivalent`:
 *
 *   A.A. · B.Arch · B.B.A. · B.C.S. · B.Com · B.Ed · B.Eng · B.F.A. ·
 *   B.S. Acc · L.L.B. · B.S. · B.A. · M.A. · MBA · M.S. · HS · PhD · JD
 *
 * Two things follow from that list. There is NO plain "Bachelor's Degree" row,
 * so a bare want of "Bachelor" matches eleven of them and comes back AMBIGUOUS —
 * which is why this is a ladder and not a string. And every label ends "or
 * equivalent", which is what makes a default defensible at all.
 *
 * THE DEFECT THIS REPLACES: the field was sent `e.degree`, and the CV's degree
 * field holds "Marketing" — a field of STUDY, not a qualification. The catalogue
 * has no such row, so Degree refused itself USER_REQUIRED every pass and, being
 * required, held the whole application on the page.
 *
 * THE RULE (the user's, 2026-08-09): the CV parse decides, because a master's is
 * written out explicitly; anything ambiguous defaults to a bachelor. So an
 * explicit qualification anywhere in the education entry always wins, and only
 * when none is stated does the bachelor default apply.
 *
 * What this deliberately does NOT do: infer a bachelor's FLAVOUR from the field
 * of study. "Marketing" is not evidence of a B.B.A. rather than a B.S., and
 * putting a qualification the candidate never claimed on a real application is
 * worse than a generic one that says "or equivalent".
 *
 * SECOND TENANT (maersk, R173118, 2026-08-14): the same field, a coarser
 * catalogue — `High School · AA · AS · BA · BS · MA`, short codes, no "or
 * equivalent", and NO long label anywhere. The mdlz ladder, spelled entirely in
 * long labels, matched none of them and the required Degree looped. So each rung
 * is now a LADDER OF ITS CATEGORY: the verbose label mdlz prints, then the short
 * codes a coarse catalogue offers (=BA, =MA, …). The verbose rung still hits
 * first on mdlz — that tenant is untouched — and only a catalogue that prints
 * nothing longer ever reaches the codes. Where the coarse list cannot tell a
 * B.B.A. from a B.S. (maersk has only BA/BS), the specific code misses and it
 * falls to the generic bachelor bucket — the same "don't claim a flavour we
 * can't support" rule, one catalogue coarser.
 */
/**
 * WHAT SCHOOL TO ASK THE PICKER FOR — the CV's own name, then Workday's own
 * escape hatch, and nothing in between.
 *
 * MEASURED (PwC 715624WD, 2026-08-15): formField-school is a search-on-Enter
 * picker — type ≥4 chars, Enter runs the server search, pick from the list —
 * with "School Not Listed" as the catalogue's own designed answer for a school
 * it does not hold. The same widget family as the HDYHAU cascade, so the ladder
 * rides the same executor (answerFromLadder → typeFilterPick).
 *
 * The bracket-stripped rung exists because CVs write "Foreign Trade University
 * (FTU)" while catalogues hold the plain name — a search seeded with the
 * bracket misses a school that is there. What this NEVER does is fall to a
 * similar catalogue school: the skills incident ("unit economics" → CLV)
 * settled that policy — exact claim or verbatim fallback, no semantic mapping.
 */
export function schoolLadder(entry) {
    const name = String(entry?.institution || entry?.school || '').trim();
    const plain = name.replace(/[(（][^)）]*[)）]?/g, ' ').replace(/\s+/g, ' ').trim();
    return [...new Set([name, plain].filter(Boolean)), '=School Not Listed'];
}

/**
 * The YEAR a CV date carries, as the string a year dropdown offers.
 *
 * monthYear() first (it reads every shape the extractor produces), then a bare
 * four-digit year, which monthYear alone rejects — "2019" has no month in it.
 * "Present" and friends yield nothing: an ongoing degree has no last year.
 */
export function yearOf(value) {
    const my = monthYear(value);
    if (my) return String(my.year);
    return (String(value || '').match(/\b(19|20)\d{2}\b/) || [])[0] || '';
}

/**
 * Does this string NAME A QUALIFICATION (a degree level), rather than a subject?
 *
 * The same tokens degreeLadder recognises — every level and every abbreviation
 * it ladders — folded into one test. It exists so fieldOfStudy can tell a
 * mis-slotted SUBJECT ("Marketing") from a real qualification ("B.B.A.") sitting
 * in the same `degree` key: the first is the major and belongs in Field of
 * Study, the second is not on that catalogue and must not be typed into it.
 *
 * Deliberately matches "business administration" and other qualification-named
 * subjects as qualifications — the safe direction. A borderline subject gaps to
 * the candidate (unchanged from today); it is never mis-typed into the search.
 */
const QUALIFICATION = new RegExp([
    'ph\\.?\\s?d', 'doctorate', 'doctoral', 'tiến sĩ', 'juris doctor', '\\bj\\.?d\\b',
    '\\bmba\\b', 'master of business', 'thạc sĩ', 'master of science', 'master of arts',
    '\\bm\\.?sc?\\b', '\\bm\\.?a\\b', '\\bmaster\\b',
    'associate of', '\\ba\\.?a\\b', '\\ba\\.?s\\b',
    'high school', 'secondary school', 'thpt', 'trung học',
    'bachelor', 'cử nhân', 'kỹ sư', 'business administration',
    'b\\.?arch', 'b\\.?b\\.?a', 'b\\.?c\\.?s', 'b\\.?com', 'b\\.?ed', 'b\\.?eng',
    'b\\.?f\\.?a', 'l\\.?l\\.?b', '\\bb\\.?a\\b', '\\bb\\.?sc?\\b',
    'diploma', 'đại học',
].join('|'), 'i');

export const isQualification = (s) => QUALIFICATION.test(fold(s));

/**
 * THE SUBJECT SOMEONE STUDIED, for Workday's closed Field-of-Study catalogue.
 *
 * The extractor is inconsistent about where the major lands: `field_of_study`,
 * `major`, or — MEASURED live (PwC 715624WD, 2026-08-15: education
 * {degree:"Marketing"}, no field_of_study) — inside `degree` when the CV wrote
 * only the subject. So the explicit keys win, and failing them the degree string
 * is used ONLY when it is not itself a qualification. "Marketing" is the
 * candidate's stated field; "B.B.A." is a level and is left for the person.
 */
export function fieldOfStudy(entry) {
    const explicit = String(entry?.field_of_study || entry?.major || '').trim();
    if (explicit) return explicit;
    const degree = String(entry?.degree || '').trim();
    return degree && !isQualification(degree) ? degree : '';
}

export function degreeLadder(entry) {
    const s = fold(`${entry?.degree || ''} ${entry?.qualification || ''} ${entry?.degree_level || ''}`);
    // Anchored on purpose: "ma" lives inside "marketing", and an unanchored
    // rung would read a marketing degree as a Master of Arts.
    if (/\bph\.?\s?d\b|doctorate|doctoral|tiến sĩ/.test(s)) return ['Doctor of Philosophy', '=PhD', '=Doctorate', '=Doctoral', '=DPhil'];
    if (/\bj\.?d\.?\b|juris doctor/.test(s)) return ['Juris Doctor', '=JD'];
    // Vietnamese names the LEVEL and the FIELD as one phrase, and the two must
    // be read together: "thạc sĩ quản trị kinh doanh" is an MBA while "cử nhân
    // quản trị kinh doanh" is a B.B.A. — the field alone decides neither.
    if (/\bmba\b|master of business|thạc sĩ quản trị kinh doanh/.test(s)) return ['Master of Business Administration', '=MBA', ...MASTER];
    if (/\bm\.?sc?\.?\b|master of science/.test(s)) return ['Master of Science', '=MS', '=MSc', ...MASTER];
    if (/\bm\.?a\.?\b|master of arts/.test(s)) return ['Master of Arts', '=MA', ...MASTER];
    if (/\bmaster|thạc sĩ/.test(s)) return MASTER;
    if (/\bassociate\b|\ba\.?a\.?\b/.test(s)) return ['Associate of Arts', '=AA', '=AS', 'Associate', "=Associate's"];
    if (/high school|secondary school|thpt|trung học/.test(s)) return ['High School', '=HS', 'Secondary School', '=GED'];
    // An explicit bachelor flavour the candidate DID claim.
    if (/\bb\.?arch\b|bachelor of architecture/.test(s)) return ['Bachelor of Architecture', '=BArch', ...BACHELOR];
    if (/\bb\.?b\.?a\.?\b|business administration|cử nhân quản trị kinh doanh/.test(s)) return ['Bachelor of Business Administration', '=BBA', ...BACHELOR];
    if (/\bb\.?c\.?s\.?\b|computer science/.test(s)) return ['Bachelor of Computer Science', '=BCS', ...BACHELOR];
    if (/\bb\.?com\b|bachelor of commerce/.test(s)) return ['Bachelor of Commerce', '=BCom', ...BACHELOR];
    if (/\bb\.?ed\b|bachelor of education/.test(s)) return ['Bachelor of Education', '=BEd', ...BACHELOR];
    if (/\bb\.?eng\b|bachelor of engineering|kỹ sư/.test(s)) return ['Bachelor of Engineering', '=BEng', '=BE', ...BACHELOR];
    if (/\bb\.?f\.?a\.?\b|fine arts/.test(s)) return ['Bachelor of Fine Arts', '=BFA', ...BACHELOR];
    if (/accountancy|accounting/.test(s)) return ['Bachelor of Accountancy', '=BAcc', ...BACHELOR];
    if (/\bl\.?l\.?b\.?\b|bachelor of laws/.test(s)) return ['Bachelor of Laws', '=LLB', ...BACHELOR];
    if (/\bb\.?a\.?\b|bachelor of arts/.test(s)) return ['Bachelor of Arts', '=BA', ...BACHELOR];
    if (/\bb\.?sc?\.?\b|bachelor of science/.test(s)) return ['Bachelor of Science', '=BS', '=BSc', ...BACHELOR];
    return BACHELOR;
}

/**
 * The category fallbacks — the verbose label a long-form catalogue (mdlz) prints
 * FIRST, then the short codes a coarse one (maersk: BA/BS/MA) offers instead.
 * Anchored (=) so a two-letter code matches a whole cell or its prefix, never a
 * substring: '=MA' is Maersk's Master, not the "ma" inside "Pharmacy". The verbose
 * rung always hits first on mdlz, so its behaviour is unchanged; the codes only
 * fire on a tenant that prints nothing longer.
 */
const BACHELOR = ['Bachelor of Arts', 'Bachelor of Science', 'Bachelor', "=Bachelor's", '=BA', '=BS', '=BSc'];
const MASTER = ['Master of Science', 'Master of Arts', 'Master', "=Master's", '=MS', '=MA'];

/**
 * HOW WELL SOMEBODY SPEAKS A LANGUAGE — against a scale that may not have the
 * word the CV used.
 *
 * MEASURED, the mdlz Overall proficiency catalogue (R-174102, 2026-08-09):
 * exactly three rows — `1 - Beginner`, `2 - Intermediate`, `3 - Fluent`.
 *
 * There is no "Native". So the CV's Vietnamese, written by the extractor as
 * "Native", matched nothing and the field refused itself USER_REQUIRED, while
 * English ("Fluent") committed on the first try — the same field, the same
 * widget, one word apart. A three-rung scale simply does not have a word for a
 * mother tongue.
 *
 * The CV'S OWN WORD IS ALWAYS TRIED FIRST, so a tenant that does offer "Native"
 * gets "Native". Only when the scale has no such row does a native speaker fall
 * to the highest rung it does offer — which understates nothing: somebody's
 * mother tongue is fluent by any reading. Nothing is stretched upward: an
 * intermediate never becomes fluent.
 *
 * A level the CV does not state returns nothing, and the field stays the
 * candidate's to answer.
 */
const NATIVE_TIER = /native|mother tongue|first language|bản ngữ|tiếng mẹ đẻ/;
const FLUENT_TIER = /fluent|advanced|proficient|thành thạo|lưu loát|\bc[12]\b/;

export function proficiencyLadder(level) {
    const own = String(level || '').trim();
    const s = fold(own);
    if (!s) return null;
    if (NATIVE_TIER.test(s)) return [own, 'Native', 'Fluent', 'Advanced', 'Proficient'];
    if (FLUENT_TIER.test(s)) return [own, 'Fluent', 'Advanced', 'Proficient'];
    if (/intermediate|conversational|trung cấp|\bb[12]\b/.test(s)) return [own, 'Intermediate', 'Conversational'];
    if (/beginner|basic|elementary|novice|cơ bản|sơ cấp|\ba[12]\b/.test(s)) return [own, 'Beginner', 'Basic', 'Elementary'];
    // A word we have no scale for is still the candidate's own — try it, and
    // let the catalogue refuse it rather than inventing a level for them.
    return [own];
}

/**
 * May the "I am fluent in this language." box carry a tick for this level?
 *
 * The box renders as formField-native and was never planned — by v1 or v2 — so
 * every application shipped "I am fluent: No" directly above an Overall reading
 * "3 - Fluent", one row contradicting itself (user-caught on R-172396's review,
 * 2026-08-10). The tick derives from the SAME two top tiers the proficiency
 * ladder trusts, so the two answers cannot disagree by construction: a level
 * that puts Overall at Fluent ticks the box, anything softer plans nothing —
 * and unticked is then the truth, not a miss.
 */
export function speaksFluently(level) {
    const s = fold(String(level || '').trim());
    return !!s && (NATIVE_TIER.test(s) || FLUENT_TIER.test(s));
}

/**
 * One row per language, whatever the CV called it.
 *
 * The duplicate-row incident started here: two spellings of one language rode
 * through as two entries and the form refused them both.
 */
export function dedupeLanguages(list) {
    const out = [];
    for (const raw of list) {
        const name = String(raw?.language || '').trim();
        if (!name) continue;
        const key = canonicalLanguage(name);
        const seen = out.find((o) => o.key === key);
        if (!seen) { out.push({ key, language: askableLanguage(name), level: raw.level || '' }); continue; }
        // The entry that states a level is the one worth keeping.
        if (!seen.level && raw.level) seen.level = raw.level;
    }
    return out;
}

/**
 * The name to ask the FORM for — which is not always the name the CV used.
 *
 * The extractor writes what the CV wrote: "English (IELTS 7.5)" from a
 * certificate, "Tiếng Việt" from a Vietnamese CV's own language. The employer's
 * catalogue holds neither. Asking it for a certificate finds nothing, and
 * asking it in Vietnamese finds nothing either — the field would come back
 * option-not-found for a language the candidate plainly speaks.
 *
 * So: a qualification is stripped, and the two languages this market always
 * carries are asked for by the name the catalogue uses. Anything else is left
 * exactly as written — inventing an English name for a language we have no
 * mapping for would be guessing at what the form calls it.
 */
export function askableLanguage(name) {
    const key = canonicalLanguage(name);
    const KNOWN = { vietnamese: 'Vietnamese', english: 'English' };
    if (KNOWN[key]) return KNOWN[key];
    return String(name || '').replace(/[(（].*$/, '').replace(/\s+[-–—:,].*$/, '').trim() || String(name || '');
}

/**
 * One name for one language, whatever the CV wrote.
 *
 * The market rule is not decoration: the extractor derives Vietnamese from the
 * CV's own written language and English from a certificate, so a Vietnamese CV
 * that also names its mother tongue arrives as BOTH "Vietnamese" and "Tiếng
 * Việt". That is the exact pair behind the three-row screenshot — folding a
 * qualification ("English (IELTS 7.5)") but not a translation would leave the
 * measured case unfixed.
 */
export function canonicalLanguage(name) {
    const s = fold(name);
    if (/vietnamese|tiếng việt|tieng viet/.test(s)) return 'vietnamese';
    if (/english|tiếng anh|tieng anh/.test(s)) return 'english';
    // Everything after a bracket or a dash is a qualification, not a language.
    return s.replace(/[(（].*$/, '').replace(/[-–—:,].*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Which row holds this entry — by what the page says, then by what is free.
 *
 * Never by index: append order stops describing anything the moment Workday
 * re-renders, a row is deleted, or a previous pass half-filled one.
 */
export function claimRow(spec, entry, rows, taken) {
    const free = rows.filter((r) => !taken.has(r));
    const want = spec.keyOfEntry(entry);
    const exact = free.find((r) => spec.keyOf(r) === want);
    if (exact) return { row: exact, how: 'key' };
    // A section whose rows hold a CATALOGUE's spelling of the entry (the school
    // picker) declares keyMatches — the near-claim that keeps a committed row
    // from reading as nobody's and triggering another Add.
    if (spec.keyMatches) {
        const near = free.find((r) => spec.keyMatches(spec.keyOf(r), want));
        if (near) return { row: near, how: 'near-key' };
    }
    if (spec.partialOf) {
        const partial = free.find((r) => spec.partialOf(r) && spec.partialOf(r) === spec.partialOfEntry(entry));
        if (partial) return { row: partial, how: 'partial-key' };
    }
    const blank = free.find((r) => isEmptyRow(r, spec.emptyWhen));
    if (blank) return { row: blank, how: 'empty-row' };
    return { row: null, how: 'needs-add' };
}

/**
 * The container a section's HEADING belongs to.
 *
 * The headings are Workday's own copy, from the language bundle the apply flow
 * loads ("Work Experience", "Education", "Languages", "Skills") — the same
 * words a human uses to tell one Add button from the next, and the only thing
 * on the page that distinguishes them when a section has no rows yet.
 *
 * The climb stops where the ancestor would take in ANOTHER section's heading:
 * one heading, one section, exactly the rule rows are found by.
 */
export function sectionByHeading(title) {
    if (typeof document === 'undefined' || !title) return null;
    const others = Object.values(COPY.sections).filter((t) => t !== title);
    const holds = (node, text) => [...(node.querySelectorAll?.('h1,h2,h3,h4,h5,label,div,span') || [])]
        .some((el) => (el.textContent || '').trim() === text);

    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,label,div,span')]
        .filter((el) => (el.textContent || '').trim() === title)
        .filter((el) => el.offsetParent !== null);
    for (const head of heads) {
        let node = head;
        while (node.parentNode && node.parentNode !== document.documentElement) {
            const parent = node.parentNode;
            if (others.some((t) => holds(parent, t))) break;      // the next section starts here
            node = parent;
            if (node.querySelector?.(SEL.addButton)) return node; // its own Add, and nobody else's
        }
    }
    return null;
}

/**
 * The section container, and the Add button that belongs to IT.
 *
 * Four Add buttons are visible at once on this step, so a page-wide query adds
 * a row to whichever section comes first in the document. Two ways to be sure
 * which is which, in order of how much they rely on: the section a row already
 * sits in, and failing that the section its HEADING names. Returns which one
 * answered, because on a live page that is the interesting half.
 */
export function addButtonFound(spec, rows, addVia = 'any') {
    if (rows.length) {
        const section = rows.length > 1 ? rows[0].parentNode : rows[0];
        const byRows = section?.querySelector?.(SEL.addButton);
        if (byRows) return { button: byRows, via: 'rows' };
    }
    // The heading strategy is grounded in Workday's own copy and has never met a
    // real page. `addVia: 'rows'` is the switch that turns it off from a console
    // if a live run puts a row in the wrong section.
    if (addVia === 'rows') return { button: null, via: null };
    const heading = sectionByHeading(COPY.sections[spec.name]);
    const byHeading = heading?.querySelector?.(SEL.addButton);
    if (byHeading) return { button: byHeading, via: 'heading' };
    return { button: null, via: null };
}

/** Just the button, for callers that only want to click it. */
export const addButtonFor = (spec, rows, addVia) => addButtonFound(spec, rows, addVia).button;

/**
 * Everything this page still needs, in the order it should be done.
 *
 * Rows before their fields, fields of one entry together, and the whole thing
 * derived from the page as it is right now.
 */
export function planStep(cv, { root = null, maxRows = 8, addVia = 'any' } = {}) {
    const tasks = [];
    const gaps = [];

    for (const spec of SECTIONS) {
        const entries = spec.entries(cv).slice(0, maxRows);
        if (!entries.length) continue;
        const rows = rowsOf(spec.anchor, { root });
        const taken = new Set();

        for (const entry of entries) {
            const { row, how } = claimRow(spec, entry, rows, taken);
            if (!row) {
                const { button: add, via } = addButtonFound(spec, rows, addVia);
                if (!add) {
                    // ABSENT vs AMBIGUOUS, and the difference is the whole page.
                    //
                    // A section whose heading is missing WHILE the page still
                    // NAMES other sections is genuinely not on this form — the
                    // tenant does not collect it. Measured on the Maersk intern
                    // form (R192834, 2026-08-14): Work Experience / Languages /
                    // Skills are there, Education is not, yet the CV carries one.
                    // Declining the whole page for a section that is not on it
                    // stranded work AND languages AND skills too. So an absent
                    // section is a NON-blocking gap (surfaced at review — the form
                    // simply does not ask for it), and v2 finishes what IS present.
                    //
                    // A page that names NO section at all is the OTHER case:
                    // headings unreadable, Add buttons indistinguishable, and
                    // clicking one writes a job into the wrong section. That stays
                    // the BLOCKING "no add button" gap — hand the page to v1 whole,
                    // exactly as before. MDLZ renders every section with its
                    // heading, so `headingHere` is never null there and this absent
                    // branch is never reached — MDLZ is untouched.
                    const headingHere = sectionByHeading(COPY.sections[spec.name]);
                    const pageNamesSections = SECTIONS.some((s) => sectionByHeading(COPY.sections[s.name]));
                    if (!rows.length && !headingHere && pageNamesSections) {
                        gaps.push({ section: spec.name, why: 'section absent — this tenant does not render it', absent: true });
                        break;
                    }
                    gaps.push({ section: spec.name, why: 'no row and no add button we can identify' });
                    break;
                }
                tasks.push({
                    kind: 'addRow', section: spec.name, id: `${spec.name}.add`,
                    entryKey: spec.keyOfEntry(entry),
                    // How the button was identified — worth carrying, because on
                    // a live page "by heading" is the claim that has never been
                    // tested against a real one.
                    via,
                });
                // Everything after an add is planned on the NEXT pass, against
                // the page the add produced. A plan that assumes what the click
                // will render is the plan that filled rows that did not exist.
                break;
            }
            taken.add(row);
            for (const f of spec.fields(entry)) {
                if (f.when && !f.when()) continue;
                // A field this tenant does not render is not a gap and not a
                // task; it is simply not there. The absence is TRUSTED because
                // planning only runs behind waitPageReady (a settled, stable
                // fingerprint — a late-hydrating field changes the field count
                // and drops the page out of ready) and the lookup is inside a
                // row whose anchor already rendered. Traced so an absence is
                // auditable rather than silent.
                if (f.whenPresent && f.id && !fieldIn(row, f.id)) {
                    trace('mdlz.plan.whenPresentSkip', { section: spec.name, field: f.id, row: spec.keyOfEntry(entry) });
                    continue;
                }
                // A LADDER IS AN ANSWER, it just is not a single value — the
                // rung can only be chosen against options that are not on the
                // page until the list is open.
                if (!f.ladder?.length && (f.want === null || f.want === undefined || f.want === '')) {
                    if (!f.optional) gaps.push({ section: spec.name, field: f.id || f.name, why: 'the CV does not say' });
                    continue;
                }
                tasks.push({
                    kind: 'field',
                    section: spec.name,
                    id: `${spec.name}[${spec.keyOfEntry(entry)}].${f.id || f.name}`,
                    rowKey: spec.keyOfEntry(entry),
                    anchor: spec.anchor,
                    field: f.id || null,
                    byLabel: f.byLabel || null,
                    ladder: f.ladder || null,
                    // A field reached by its label has no id to be named by — and
                    // "Overall" is what a report has to call it.
                    name: f.name || null,
                    want: f.want,
                    optional: !!f.optional,
                    // The chip-search contract, verbatim from the spec — the
                    // router refuses a chip-search field that carries none.
                    capability: f.capability || null,
                    cardinality: f.cardinality || null,
                    contractException: f.contractException || null,
                });
            }
        }
    }

    // Skills is one field with many values — no rows, no adds, and the chips
    // already on the page are the candidate's own.
    //
    // OPTIONAL, and measured twice over: Workday renders it "Type to Add Skills"
    // with no required marker, and this tenant's catalogue answers "No Items."
    // to every term — including plain ones like "Sales", typed on a real
    // keyboard (R-174102, 2026-08-09). A field the employer did not ask for and
    // whose catalogue cannot answer must not be what holds an application on the
    // page: it is reported as a gap and the step still finishes. A tenant that
    // DOES require it still stops us, through the row error Workday shows —
    // which `pageComplete` reads independently of this flag.
    //
    // AND ONLY WHERE IT EXISTS. MEASURED on the Demand Planning Intern posting
    // (R-173704, 2026-08-09): its My Experience renders Work Experience,
    // Education, Languages, Résumé and Websites — and NO Skills section at all.
    // Planned unconditionally, the task resolved to nothing and came back
    // WAITING_HYDRATION on every pass forever; that is an INTERACTION outcome,
    // so it is never forgiven as an optional semantic gap and the page could
    // never advance. Worse, WAITING_HYDRATION is not a terminal result either,
    // so it was not even listed as a blocker — the run named the only other
    // unsatisfied task instead and sent us after the wrong field.
    //
    // Same rule the education fields already use: a field this posting does not
    // render is not a gap and not a task; it is simply not there.
    // CAP the skills. A real CV lists a handful (~15 at most); a parse that hands
    // over 168 (measured, HSE_Specialist CV) is over-extraction, and on a
    // create-only tenant like Maersk EVERY skill is a fresh create — 168 of them
    // would grind the page for minutes and trip the watchdog. Twenty is generous
    // headroom above a real CV, so a genuine skill list is never cut; it only
    // fences off the absurd. (The FE parse producing 168 is a separate bug.)
    const skills = normaliseSkills(cv?.skills).slice(0, SKILLS_CAP);
    const skillsField = typeof document !== 'undefined'
        ? (root || document).querySelector('[data-automation-id="formField-skills"]')
        : null;
    if (skills.length && skillsField) {
        tasks.push({
            kind: 'field', section: 'skills', id: 'skills', field: 'formField-skills',
            want: skills, optional: true,
            // The TRUE multi-select: many terms, Enter inert, checkbox commits,
            // chips accumulate (measured; five sat side by side on R-173186).
            capability: 'searchMulti', cardinality: 'many',
        });
    }

    return { tasks, gaps };
}

/** How many skills v2 will ever add — a fence against parse over-extraction,
 *  never a limit a real CV reaches. See the note at the call site. */
export const SKILLS_CAP = 20;

/** A CV may hold skills as a list or as one comma-separated line. */
export function normaliseSkills(raw) {
    const list = Array.isArray(raw) ? raw.flatMap(splitSkills) : splitSkills(raw);
    return [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
}

/**
 * Split a skills string WITHOUT cutting a skill in half.
 *
 * MEASURED on R-174102, 2026-08-09: the CV's "unit economics (CPI, CAC, LTV)"
 * went to the form as three separate searches — `unit economics (CPI`, `CAC`,
 * `LTV)`. A plain split on commas does not know that the ones inside brackets
 * are listing examples, not separating skills.
 *
 * v1 carries the same rule and the reason it was written: one of those
 * fragments — "CAC" — WAS found in an employer's taxonomy and got added. A
 * piece of a phrase became a claim on a real application, which is worse than
 * skipping the skill. Here it came back AMBIGUOUS and nothing was added, but
 * that was luck, not the design.
 *
 * So a separator inside brackets does not separate. Everything else does.
 */
export function splitSkills(value) {
    const text = String(value ?? '');
    const out = [];
    let buf = '';
    let depth = 0;
    for (const ch of text) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) { out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    out.push(buf);
    return out.map((v) => v.trim()).filter(Boolean);
}

/**
 * Find the wrapper a task points at, at the moment it runs.
 *
 * Re-resolved from the key every time, because between planning and running the
 * row may have been re-rendered, moved, or (for the row an Add just produced)
 * come into existence.
 */
export function resolveTarget(task, { root = null } = {}) {
    if (!task.rowKey) {
        return task.field && typeof document !== 'undefined'
            ? document.querySelector(`[data-automation-id="${task.field}"]`)
            : null;
    }
    const spec = SECTIONS.find((s) => s.name === task.section);
    const rows = rowsOf(task.anchor, { root });
    // keyMatches sits between the exact key and the empty fallback for the same
    // reason it does in claimRow: mid-pass, the school picker has already put
    // the CATALOGUE's spelling on the row, and the entry's remaining fields
    // (degree, years) must still find it.
    const row = rows.find((r) => spec.keyOf(r) === task.rowKey)
        || (spec.keyMatches ? rows.find((r) => spec.keyMatches(spec.keyOf(r), task.rowKey)) : null)
        || (spec.partialOf ? rows.find((r) => spec.partialOf(r) && spec.partialOf(r) === task.rowKey.split('@')[0]) : null)
        || rows.find((r) => isEmptyRow(r, spec.emptyWhen))
        || null;
    if (!row) return null;
    return task.byLabel ? fieldByLabel(row, task.byLabel) : fieldIn(row, task.field);
}

/** The row a task belongs to — what an error has to be attributed to. */
export function resolveRow(task, { root = null } = {}) {
    if (!task.rowKey) return null;
    const spec = SECTIONS.find((s) => s.name === task.section);
    const rows = rowsOf(task.anchor, { root });
    return rows.find((r) => spec.keyOf(r) === task.rowKey)
        || (spec.keyMatches ? rows.find((r) => spec.keyMatches(spec.keyOf(r), task.rowKey)) : null)
        || rows.find((r) => spec.partialOf && spec.partialOf(r) === task.rowKey.split('@')[0])
        || null;
}
