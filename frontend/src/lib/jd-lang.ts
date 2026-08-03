// Which language a job posting is written in.
//
// Its own module, with no imports, because BOTH sides need it: the editor (a
// client component, which must not pull `lib/cover-letter` and the Gemini SDK
// into the browser bundle) and the API route that generates the text.
//
// The editor's cover LETTER has a language picker — the user downloads it and
// decides. The auto-filled message has no picker by design, because nobody is
// watching it get written, so it follows the posting instead: a Vietnamese ad
// gets a Vietnamese note, an English one gets English.

type Rec = Record<string, unknown>;

// Detection is by diacritic DENSITY, not a word list. Vietnamese postings
// routinely carry English job-title jargon ("Senior Product Owner", "OKR",
// "stakeholder") inside Vietnamese prose, so any keyword rule flips to English
// on the very ads that most need Vietnamese. Diacritics only ever appear in the
// Vietnamese half, so a low threshold separates the two cleanly.
const VN_DIACRITICS =
    /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi;

/** 'vi' or 'en' — the language a message about this job should be written in. */
export function detectJdLang(jd: unknown): string {
    const j: Rec = jd && typeof jd === 'object' ? (jd as Rec) : {};
    const text = [j.title, j.company, j.responsibilities, j.must_have, j.nice_to_have, j.description]
        .map(v => (Array.isArray(v) ? v.join(' ') : String(v ?? '')))
        .join(' ');
    if (!text.trim()) return 'vi';
    const viChars = (text.match(VN_DIACRITICS) || []).length;
    const letters = (text.match(/[a-zăâđêôơư]/gi) || []).length;
    // 2%: an all-Vietnamese paragraph runs far above it, and an English one with
    // a stray Vietnamese company name ("Vingroup", "Techcombank" — no diacritics
    // anyway) stays below.
    return letters > 0 && viChars / letters > 0.02 ? 'vi' : 'en';
}
