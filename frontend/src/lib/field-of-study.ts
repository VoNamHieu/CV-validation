// Resolve a CV's field of study to a value Workday's closed catalogue accepts,
// BEFORE it reaches the extension. FE-only — the deterministic apply engine is
// never told to translate.
//
// Field of Study on Workday is a SINGLE-select closed list of 327 English majors
// (measured, R-172558/R-173704). A Vietnamese major ("Kinh doanh quốc tế") or an
// English one the list does not carry ("International Economics") never matches,
// and the intern form gaps mid-run. This maps the common cases deterministically
// — the exact catalogue label first, then a Vietnamese-major dictionary whose
// every target is asserted (by test) to be in the catalogue — and returns the
// input UNCHANGED when it recognises nothing. So an unmatched value is no worse
// than today (the extension's own search / the review gap still apply), and the
// long tail is left for an LLM layer to resolve later.

import { FIELD_OF_STUDY_CATALOG } from './field-of-study-catalog';

/** Accent-fold + lowercase + collapse spaces, so "Kinh tế Quốc tế", "kinh te
 *  quoc te" and "  KINH  TE " all key the same. `đ`→`d` is explicit — NFD does
 *  not decompose it. */
export function foldMajor(s: string): string {
    return String(s ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ')
        .trim();
}

const CATALOG_BY_FOLD = new Map(FIELD_OF_STUDY_CATALOG.map((label) => [foldMajor(label), label]));

/**
 * Common Vietnamese majors → the nearest catalogue label. Keys are folded. Every
 * target is a real catalogue row (asserted in the test). The nearest-match ones
 * (kinh tế quốc tế / kinh tế đối ngoại — the catalogue has no "International
 * Economics" or "Foreign Trade") are the honest deterministic answer; the LLM
 * layer can refine them, but a defensible economics/international label beats a
 * gap.
 */
const VN_MAJOR: Record<string, string> = {
    'quan tri kinh doanh': 'Business Administration',
    'kinh doanh quoc te': 'International Business',
    'kinh te quoc te': 'Economics',
    'kinh te doi ngoai': 'International Business',
    'kinh te': 'Economics',
    'kinh te hoc': 'Economics',
    'thuong mai': 'Business Administration',
    'thuong mai quoc te': 'International Business',
    'marketing': 'Marketing',
    'tiep thi': 'Marketing',
    'ke toan': 'Accounting',
    'kiem toan': 'Accounting',
    'ke toan kiem toan': 'Accounting',
    'tai chinh': 'Finance',
    'tai chinh ngan hang': 'Finance',
    'ngan hang': 'Finance',
    'cong nghe thong tin': 'Information Technology',
    'khoa hoc may tinh': 'Computer and Information Science',
    'he thong thong tin': 'Management Information Systems',
    'he thong thong tin quan ly': 'Management Information Systems',
    'khoa hoc du lieu': 'Data Science',
    'luat': 'Law',
    'luat kinh te': 'Law',
    'quan tri nhan luc': 'Human Resources Management',
    'quan tri nhan su': 'Human Resources Management',
    'ngon ngu anh': 'English',
    'su pham': 'Education',
    'logistics': 'Logistics Management',
    'logistics va quan ly chuoi cung ung': 'Logistics Management',
    'quan ly chuoi cung ung': 'Logistics Management',
    'quan tri chuoi cung ung': 'Logistics Management',
    'xay dung': 'Civil Engineering',
    'ky thuat xay dung': 'Civil Engineering',
    'co khi': 'Mechanical Engineering',
    'ky thuat co khi': 'Mechanical Engineering',
    'dien': 'Electrical Engineering',
    'dien tu': 'Electrical Engineering',
    'ky thuat dien': 'Electrical Engineering',
    'kien truc': 'Architecture',
    'quan tri khach san': 'Hospitality',
    'quan tri du lich': 'Hospitality',
    'du lich': 'Hospitality',
    'tam ly hoc': 'Psychology',
    'quan he quoc te': 'International Relations',
    'truyen thong': 'Mass Communication',
    'bao chi': 'Journalism',
    'y khoa': 'Medicine',
    'duoc': 'Pharmacy',
    'dieu duong': 'Nursing',
};

/**
 * Map a raw field of study to a catalogue label, or leave it unchanged.
 *
 *   1. an EXACT catalogue major (any casing / accent) — return the canonical
 *      spelling the catalogue uses;
 *   2. a known Vietnamese major — return its mapped label;
 *   3. otherwise the input verbatim — unknown is not wrong here, it is "the
 *      deterministic layer has no answer", and the value flows on exactly as it
 *      does today for the extension's search and, failing that, the review gap.
 */
export function resolveFieldOfStudy(raw: string | null | undefined): string {
    const value = String(raw ?? '').trim();
    if (!value) return value;
    const folded = foldMajor(value);
    const exact = CATALOG_BY_FOLD.get(folded);
    if (exact) return exact;
    const mapped = VN_MAJOR[folded];
    if (mapped) return mapped;
    return value;
}

/** True when the resolver could place this value in the catalogue. */
export function isResolvableMajor(raw: string | null | undefined): boolean {
    const value = String(raw ?? '').trim();
    if (!value) return false;
    const folded = foldMajor(value);
    return CATALOG_BY_FOLD.has(folded) || folded in VN_MAJOR;
}
