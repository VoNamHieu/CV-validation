// esbuild build for the Copo extension.
//   src/*.js  (ES-module source; god files split into modules over time)
//     → dist/*.js  (self-contained IIFE bundles Chrome loads directly)
//   + static assets copied verbatim.
// The loadable / zippable extension is dist/. Dev: `npm run watch` then load
// dist/ unpacked. Ship: `npm run zip`.
import esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const OUT = 'dist';
const watch = process.argv.includes('--watch');

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
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    // Re-copy static on each rebuild would need a plugin; static rarely changes,
    // so copy once here and tell the user to re-run for manifest/asset edits.
    console.log('[build] watching src/ → dist/ (re-run `npm run build` after editing manifest/static)');
} else {
    await esbuild.build(options);
    console.log('[build] done → dist/');
}
