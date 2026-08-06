// esbuild build for the Copo extension.
//   src/*.js  (ES-module source; god files split into modules over time)
//     → dist/*.js  (self-contained IIFE bundles Chrome loads directly)
//   + static assets copied verbatim.
// The loadable / zippable extension is dist/. Dev: `npm run watch` then load
// dist/ unpacked. Ship: `npm run zip`.
import esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = 'dist';
const watch = process.argv.includes('--watch');
// `npm run build:test` → a bundle that seeds itself with a fake candidate so the
// apply agent can be driven without the web app, a synced profile or a tailored
// CV. Off by default, and esbuild folds the constant so a normal build contains
// neither the fixture data nor the call that would use it.
const fixture = process.argv.includes('--fixture');

// The middle bundle: PRODUCTION data behaviour (no seeding, no fake candidate)
// but the local-credential path stays on — for exercising login flows with
// real data before the server-side credential store is configured. Temporary
// tooling; ship builds remain the plain `node build.mjs`.
const localCreds = !fixture && process.argv.includes('--local-creds');

// Static assets (source of truth at the extension root) copied as-is into dist.
const STATIC = ['manifest.json', 'popup.html', 'content.css', 'popup.css', 'icons'];

function copyStatic() {
    for (const f of STATIC) cpSync(f, `${OUT}/${f}`, { recursive: true });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyStatic();

// One entry per Chrome execution context. All are classic scripts (content
// script / service worker / popup), so bundle to IIFE — no runtime imports.
const options = {
    entryPoints: {
        'content-agent': 'src/content-agent/index.js',
        'background': 'src/background.js',
        'content-webapp': 'src/content-webapp.js',
        'popup': 'src/popup.js',
    },
    bundle: true,
    outdir: OUT,
    format: 'iife',
    target: ['chrome110'],
    logLevel: 'info',
    minify: false,      // keep readable — we debug these live in the browser
    sourcemap: false,
    // Point the fixture import at an empty stub unless this is a fixture build.
    // Dead-code elimination alone was not enough: esbuild folds the guard and
    // tree-shakes the module but keeps the `if (false)` block calling into it,
    // leaving a production bundle that referenced a function it no longer
    // contained. Swapping the file makes the absence structural instead.
    plugins: [
        // The test accounts live OUTSIDE the repo (public), so the import has to
        // resolve to something either way: the developer's local file when it
        // exists, the tracked template — which supplies nulls — when it does not.
        // Without this a fresh clone fails to build on a missing file.
        {
            name: 'local-creds',
            setup(build) {
                build.onResolve({ filter: /fixtures\/creds\.local\.js$/ }, () => ({
                    path: resolve(existsSync('src/fixtures/creds.local.js')
                        ? 'src/fixtures/creds.local.js'
                        : 'src/fixtures/creds.local.example.js'),
                }));
            },
        },
        ...(fixture ? [] : [{
            name: 'strip-fixtures',
            setup(build) {
                build.onResolve({ filter: /fixtures\/dummy\.js$/ }, () => ({
                    path: resolve(localCreds ? 'src/fixtures/creds-only.js' : 'src/fixtures/noop.js'),
                }));
            },
        }]),
    ],
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    // Re-copy static on each rebuild would need a plugin; static rarely changes,
    // so copy once here and tell the user to re-run for manifest/asset edits.
    console.log('[build] watching src/ → dist/ (re-run `npm run build` after editing manifest/static)');
} else {
    await esbuild.build(options);
    console.log(`[build] done → dist/${fixture ? '  ⚠️  FIXTURE BUILD — seeds fake candidate data' : localCreds ? '  ⚠️  LOCAL-CREDS BUILD — reads jobfitApplyCredentials, no seeding' : ''}`);
}
