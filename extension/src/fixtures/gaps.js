/**
 * The profile keys a real CV never carries, seeded for test builds.
 *
 * These are the four values that had to be pasted into the service-worker
 * console before every measured run — GPA, ethnicity, gender and notice period.
 * No résumé states them, so a profile synced from the web app arrives without
 * them, and each one blocks a REQUIRED field on a real ATS:
 *
 *   gpa           → Workday's "Overall Result (GPA)" (answered ONLY from here —
 *                   a plausible number would be a fabricated academic record)
 *   ethnicity     → VN tenants ask it as an administrative fact
 *   gender        → the Prefix ladder derives Mr./Ms. from it; empty gender
 *                   leaves PwC's REQUIRED "Prefix*" a named gap
 *   noticePeriod  → answers "notice period" and derives the earliest start date
 *
 * Nothing here is a secret and nothing here is a credential, which is why it
 * lives in the repo. Seeding NEVER overwrites: a key the real profile already
 * holds is left exactly as it is.
 */

/** Only keys a synced profile can legitimately be missing. */
export const PROFILE_GAP_SEEDS = {
    gpa: '4.0',
    ethnicity: 'Kinh',
    gender: 'Nam',
    noticePeriod: '30 days',
};

const PROFILE_KEY = 'jobfitProfile';

/**
 * Fill the empty gap keys of whatever profile is in storage.
 *
 * Returns the keys it actually wrote, so the caller can say so in its banner —
 * "seeded nothing" and "seeded four things" are different situations and the
 * console should not make them look alike.
 */
export async function seedProfileGaps(seeds = PROFILE_GAP_SEEDS) {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return [];
    const got = await chrome.storage.local.get(PROFILE_KEY);
    const profile = got?.[PROFILE_KEY];
    // No profile at all is not this function's business: the fixture build seeds
    // a whole candidate, and the creds build wants the user's real one.
    if (!profile || typeof profile !== 'object') return [];

    const wrote = [];
    for (const [k, v] of Object.entries(seeds)) {
        if (String(profile[k] ?? '').trim() === '') {
            profile[k] = v;
            wrote.push(k);
        }
    }
    if (!wrote.length) return [];
    await chrome.storage.local.set({ [PROFILE_KEY]: profile });
    return wrote;
}
