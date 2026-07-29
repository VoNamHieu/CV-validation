/**
 * What `./fixtures/dummy.js` resolves to in a normal build.
 *
 * The swap is done by build.mjs, and it is the WHOLE mechanism — there is no
 * `if (fixtureBuild)` anywhere, on purpose. A compile-time flag was tried first
 * and did not hold: esbuild substitutes the constant but only prunes the dead
 * branch under `minifySyntax`, which these bundles deliberately do not use (we
 * read them in the browser while debugging). The result was a production bundle
 * containing `if (false) { seedDummyData() }` where `seedDummyData` had been
 * tree-shaken away — an undeclared reference kept alive by an unreachable
 * branch, which is the same shape as bugs that have already bitten this codebase.
 *
 * Calling unconditionally into a module that is swapped at resolve time removes
 * the branch entirely: production seeds nothing because the function does
 * nothing, and the file holding the fake candidate is never read.
 */
export function initFixture() {
    /* production build — no fixture data exists to seed, and no console
       helper is installed, so `copoFixture` is undefined. That absence is a
       usable check: if it answers in a build you thought was clean, it is not. */
}

/**
 * Always null in production, which is the point.
 *
 * The fixture reads an ATS password out of chrome.storage.local. Production
 * never does: it fetches credentials from the backend at the moment of use and
 * keeps them in local scope for the length of the fill. Returning null here is
 * what makes "a stored password can be used to apply" untrue of a shipped build
 * rather than merely unused by it.
 */
export async function readFixtureCredential() {
    return null;
}
