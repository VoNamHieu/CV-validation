/**
 * Shared semantic mappings used by BOTH form-fill engines — the v1 recipe
 * engine (recipe.js, recipe-mdlz-v1.js) and the v2 deterministic engine
 * (mdlz-v2/). It exists so the vocabulary lives in exactly ONE place instead of
 * the three drifting copies it had grown into.
 *
 * This is shared infrastructure, not the v1 engine: v2 importing from here does
 * NOT couple it to v1 (the retirement of v1 leaves this module standing).
 *
 * Keep it a pure, node-safe leaf: no DOM, no chrome.*, no imports of either
 * fill engine — every engine may depend on it, it depends on none of them.
 */

/**
 * A stated gender → the labels a tenant's list might render for it, in the order
 * to try. "Nam"/"Male"/"Man" all map to the male set, "Nữ"/"Female"/"Woman" to
 * the female set. The caller matches these against the options the form actually
 * offers and picks the tenant's OWN label (so a US list yields "Male", a VN list
 * "Nam"). Anything that is not plainly male/female returns [] — an unrecognised
 * value is left for the review, never guessed.
 *
 * Matching against these is EXACT on the caller side (page-disclosures.js): "man"
 * is a substring of "woman" and "male" of "female", so an includes() match would
 * misgender.
 */
export function genderLadder(gender) {
    const g = String(gender || '').trim().toLowerCase();
    if (/^(m|male|nam)$/.test(g)) return ['Male', 'Nam', 'Man'];
    if (/^(f|female|nữ|nu)$/.test(g)) return ['Female', 'Nữ', 'Woman'];
    return [];
}
