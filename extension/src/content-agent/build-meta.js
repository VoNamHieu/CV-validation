/**
 * What build is this, stamped so a trace cannot lie about which code produced it.
 *
 * A live run that "worked" proves nothing about a commit unless the trace it
 * printed came from that commit — and a whole afternoon was lost reading a trace
 * against the wrong HEAD, six commits stale, because nothing in it said which
 * build it was. Worse, the extension is loaded from `dist/` and reloaded by
 * hand, so the single most common failure is a run against yesterday's bundle
 * with no signal that anything is out of date.
 *
 * `build.mjs` computes the short SHA and the dirty flag at build time and folds
 * them in through esbuild `define`, so the shipped bundle carries them as
 * literals. Running from source — the test suite imports these modules directly,
 * with no esbuild pass — leaves the tokens undeclared; the `typeof` guard
 * resolves them to a dev marker rather than throwing, and `dirty:true` is the
 * honest answer there (source is not a build).
 */
/* global __COPO_BUILD_SHA__, __COPO_BUILD_DIRTY__ */
export const BUILD_SHA = typeof __COPO_BUILD_SHA__ !== 'undefined' ? __COPO_BUILD_SHA__ : 'dev';
export const BUILD_DIRTY = typeof __COPO_BUILD_DIRTY__ !== 'undefined' ? __COPO_BUILD_DIRTY__ : true;
