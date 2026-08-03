// Single source of truth for the flat profile shape consumed by the
// Copo extension popup and content-agent autofill. Maps a CVData
// object into the flat shape the extension expects.

import type { CVData } from "@/lib/types";

export interface ExtensionProfile {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    nationality: string;
    ethnicity: string;
    maritalStatus: string;
    addressProvince: string;
    addressDistrict: string;
    addressStreet: string;
    currentTitle: string;
    currentLevel: string;
    yearsOfExperience: number;
    highestDegree: string;
    // Answers international ATS demand that no CV states. Empty until the
    // candidate supplies them; the agent reports them as gaps rather than
    // guessing, so they can be collected once and reused everywhere.
    postalCode: string;
    noticePeriod: string;
    // education[0].gpa — Workday asks "Overall Result (GPA)" as REQUIRED on
    // some tenants and no résumé parse supplies it; the extension's grade rule
    // answers ONLY from this (never invented — a plausible number is a
    // fabricated academic record).
    gpa: string;
    workAuthorized: string;
    requiresSponsorship: string;
    currentSalary: string;
    currentIndustry: string;
    currentFields: string;
    desiredLocations: string;
    desiredSalary: string;
    coverLetter: string;
    // The short note for an ATS's free-text "message to the hiring team" box.
    // Deliberately SEPARATE from coverLetter: the two are different lengths for
    // different destinations, and pointing that box at the letter (or worse, at
    // the CV summary, which is what it fell back to) puts the wrong shape of
    // text on a real application. Empty when nothing was generated — the agent
    // leaves an optional box empty rather than filling it with something else.
    applyMessage: string;
    skills: string;
}

/**
 * The ~20 Vietnamese family names that cover the large majority of the country,
 * with and without diacritics.
 *
 * Used only to decide WHICH END of a name is the family name. Vietnamese writes
 * family-name-first ("Võ Nam Hiếu"), English CVs routinely rewrite the same
 * person given-name-first ("Hieu Vo"), and a name string alone cannot tell you
 * which convention was used — so the ONE reliable signal is that Vietnamese
 * family names are a small closed set. If the last token is one of these, the
 * name is in Western order.
 */
const VN_FAMILY_NAMES = new Set([
    "nguyen", "nguyễn", "tran", "trần", "le", "lê", "pham", "phạm",
    "hoang", "hoàng", "huynh", "huỳnh", "phan", "vu", "vũ", "vo", "võ",
    "dang", "đặng", "bui", "bùi", "do", "đỗ", "ho", "hồ", "ngo", "ngô",
    "duong", "dương", "truong", "trương", "dinh", "đinh",
    // Deliberately NOT here: Mai, Cao, Chu, Lâm, Lương, Lý, Tạ. Each is a real
    // family name and also a common GIVEN name, so including them makes both ends
    // of "Mai Tran" look like a family name — which lands it in the ambiguous
    // branch and keeps the wrong reading. Entries that weaken the signal cost more
    // than the coverage they add.
]);

/**
 * One capital per word, for words that are shouting.
 *
 * CVs are routinely typed in caps ("HIEU VO"), and Workday says so out loud:
 * "Verify that the field Family Name is correctly capitalized because it contains
 * more than 2 capital letters." Filtering that advisory out of the agent's error
 * list stops it blocking the step; normalising the name stops the advisory being
 * raised at all, which is the better half of the fix.
 *
 * Only ALL-CAPS words are re-cased. Title-casing everything would quietly damage
 * names whose capitals are correct — McDonald → Mcdonald, MacLeod → Macleod,
 * DeSantis → Desantis — and a legal-name field is the wrong place to be clever.
 * Single letters are left alone so a middle initial ("Nguyễn Văn A") survives.
 *
 * Internal separators start a new word: NGUYEN-TRAN → Nguyen-Tran, O'BRIEN →
 * O'Brien. Diacritics come through unharmed — VÕ → Võ, NGUYỄN → Nguyễn.
 */
export function normalizeNameCase(raw: string): string {
    return (raw ?? "")
        .split(/(\s+)/)
        .map((word) => {
            const letters = word.replace(/[^\p{L}]/gu, "");
            // Leave it exactly as written unless it is all caps and long enough
            // for the casing to be a choice rather than an initial.
            if (letters.length < 2 || word !== word.toUpperCase()) return word;
            return word
                .toLowerCase()
                .replace(/(^|[^\p{L}])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
        })
        .join("");
}

/**
 * Split a CV's name into the given/family pair an ATS asks for.
 *
 * Two defects this exists to fix, both measured on a real Workday application:
 *
 *   1. The pair came out SWAPPED. The old rule took the last token as the given
 *      name — correct for "Võ Nam Hiếu", wrong for a CV that writes the same
 *      person as "HIEU (CHARLES) VO", which submitted Family Name = "HIEU" and
 *      Given Name = "VO" to a real employer. The family-name set above decides
 *      the order instead of assuming one.
 *   2. A parenthesised English nickname rode along into the legal name. Workday
 *      raised two capitalization alerts on "HIEU (CHARLES)", and a legal-name
 *      field is the one place a nickname does not belong.
 *
 * When neither end is a recognised family name the behaviour is unchanged —
 * Vietnamese order assumed — because that is the right default for this product's
 * users and guessing the other way would be no better founded.
 */
export function splitLegalName(raw: string): { firstName: string; lastName: string } {
    // "HIEU (CHARLES) VO" → "HIEU VO". Also drops the bracketed forms CVs use
    // for the same purpose.
    const cleaned = (raw ?? "")
        .replace(/[（(\[][^）)\]]*[）)\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const parts = cleaned.split(" ").filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "" };
    if (parts.length === 1) return { firstName: normalizeNameCase(parts[0]), lastName: "" };

    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}]/gu, "");
    const lastIsFamily = VN_FAMILY_NAMES.has(norm(parts[parts.length - 1]));
    const firstIsFamily = VN_FAMILY_NAMES.has(norm(parts[0]));

    // Western order — family name last. Only when the END looks like a family
    // name and the START does not, so "Nguyen Van Le" (both ends plausible) keeps
    // the Vietnamese reading rather than flipping on a coin toss.
    if (lastIsFamily && !firstIsFamily) {
        return {
            firstName: normalizeNameCase(parts.slice(0, -1).join(" ")),
            lastName: normalizeNameCase(parts[parts.length - 1]),
        };
    }
    // Vietnamese order — family name first, given name last.
    return {
        firstName: normalizeNameCase(parts[parts.length - 1]),
        lastName: normalizeNameCase(parts.slice(0, -1).join(" ")),
    };
}

// `coverLetterOverride` is the per-job tailored letter (from /api/ai/cover-letter),
// preferred over the generic CV summary so the auto-apply agent fills a letter
// written for THIS job. Falls back to the summary when no letter was generated.
// `applyMessageOverride` is the short per-job note for an ATS message box.
export function cvToExtensionProfile(
    cv: CVData,
    coverLetterOverride?: string,
    applyMessageOverride?: string,
): ExtensionProfile {
    const { firstName, lastName } = splitLegalName(cv.name ?? "");

    const contact = cv.contact ?? ({} as CVData["contact"]);
    const personal = cv.personal ?? ({} as CVData["personal"]);
    const employment = cv.employment ?? ({} as CVData["employment"]);
    const preferences = cv.preferences ?? ({} as CVData["preferences"]);

    const currentTitle =
        employment.current_title || cv.experience?.[0]?.title || "";
    const yearsOfExperience =
        employment.years_of_experience || cv.experience?.length || 0;
    // `education[0].degree` holds whatever the CV wrote on that line, which for
    // most CVs is the SUBJECT ("Marketing"), not the qualification. Feeding that
    // to an ATS degree dropdown — 19 named qualifications, B.S. / B.B.A. /
    // L.L.B. — can never match, and the agent spent ten seconds per iteration
    // proving it before giving up, eight iterations running. An unusable value is
    // worse than none: empty makes the field a gap the review names, which is the
    // honest outcome when the CV never stated a qualification.
    const looksLikeQualification = (v: string) =>
        /bachelor|master|doctor|phd|associate|diploma|certificate|high school|b\.?[sae]\b|m\.?[sa]\b|mba|llb|cử nhân|thạc sĩ|tiến sĩ|kỹ sư|cao đẳng|trung cấp/i
            .test(v);
    const degreeFromCv = cv.education?.[0]?.degree ?? "";
    const highestDegree =
        employment.highest_degree || (looksLikeQualification(degreeFromCv) ? degreeFromCv : "");

    return {
        // Same normalisation as the split pair, or the two disagree on the
        // same form (fullName feeds ATS that ask for one field, not two).
        fullName: normalizeNameCase(cv.name ?? ""),
        firstName,
        lastName,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        dateOfBirth: personal.date_of_birth ?? "",
        gender: personal.gender ?? "",
        nationality: personal.nationality ?? "",
        ethnicity: personal.ethnicity ?? "",
        gpa: cv.education?.[0]?.gpa ?? "",
        maritalStatus: personal.marital_status ?? "",
        addressProvince: contact.address_province ?? "",
        addressDistrict: contact.address_district ?? "",
        addressStreet: contact.address_street ?? "",
        postalCode: contact.address_postal_code ?? "",
        currentTitle,
        currentLevel: employment.current_level ?? "",
        yearsOfExperience,
        highestDegree,
        currentSalary: employment.current_salary ?? "",
        currentIndustry: employment.current_industry ?? "",
        currentFields: employment.current_fields ?? "",
        desiredLocations: preferences.desired_locations ?? "",
        desiredSalary: preferences.desired_salary ?? "",
        noticePeriod: preferences.notice_period ?? "",
        workAuthorized: preferences.work_authorized ?? "",
        requiresSponsorship: preferences.requires_sponsorship ?? "",
        coverLetter: (coverLetterOverride && coverLetterOverride.trim()) || (cv.summary ?? ""),
        // A generated message wins; a letter the user wrote is an acceptable
        // second (long, but genuinely addressed to this employer). The CV
        // summary is NOT a third option — it is written about the candidate in
        // the abstract and says nothing to a hiring team, which is exactly the
        // text that has been going into these boxes.
        applyMessage:
            (applyMessageOverride && applyMessageOverride.trim())
            || (coverLetterOverride && coverLetterOverride.trim())
            || "",
        skills: (cv.skills ?? []).join(", "),
    };
}
