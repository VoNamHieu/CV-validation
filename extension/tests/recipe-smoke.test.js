// The hot path is EXECUTED here, not just imported.
//
// 429 tests passed while `applyRecipeFields` threw "Cannot access 'stepName'
// before initialization" on its first line of real work — because not one of
// them ever called it. A temporal-dead-zone error, a typo'd identifier, a
// helper used above its declaration: none of it is visible to a suite that
// only checks pure functions. This file runs the recipe's entry points
// against a minimal browser stub, so that class of mistake fails here instead
// of on a real application.
//
// The stub answers "nothing on the page" to every query. That is enough: the
// crash we are hunting happens while the function is SETTING UP, before it
// ever needs a real widget.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

function stubBrowser() {
    const nullNode = () => null;
    const emptyList = () => [];
    const fakeEl = () => ({
        style: {}, value: '', textContent: '', checked: false, tagName: 'DIV',
        offsetParent: null, children: [], id: '',
        setAttribute() { }, removeAttribute() { }, getAttribute: nullNode,
        appendChild() { }, removeChild() { }, remove() { }, focus() { }, blur() { }, click() { },
        addEventListener() { }, removeEventListener() { }, dispatchEvent: () => true,
        querySelector: nullNode, querySelectorAll: emptyList, closest: nullNode,
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
        scrollIntoView() { }, classList: { add() { }, remove() { }, contains: () => false },
        insertAdjacentHTML() { }, contains: () => false, matches: () => false,
    });
    globalThis.location = {
        href: 'https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External/job/Smoke_R-1/apply',
        hostname: 'wd3.myworkdaysite.com',
        pathname: '/en-US/recruiting/mdlz/External/job/Smoke_R-1/apply',
        origin: 'https://wd3.myworkdaysite.com',
    };
    globalThis.document = {
        querySelector: nullNode, querySelectorAll: emptyList, getElementById: nullNode,
        createElement: fakeEl, createTextNode: () => ({}),
        body: { ...fakeEl(), innerText: '' },
        documentElement: fakeEl(),
        addEventListener() { }, removeEventListener() { },
        activeElement: null, hidden: false, visibilityState: 'visible',
        elementFromPoint: nullNode, execCommand: () => true,
    };
    globalThis.window = {
        location: globalThis.location, addEventListener() { }, removeEventListener() { },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        scrollTo() { }, innerHeight: 800, innerWidth: 1200,
    };
    globalThis.sessionStorage = {
        _s: {},
        getItem(k) { return this._s[k] ?? null; },
        setItem(k, v) { this._s[k] = String(v); },
        removeItem(k) { delete this._s[k]; },
    };
    globalThis.CSS = { escape: (s) => String(s) };
    globalThis.MutationObserver = class { observe() { } disconnect() { } };
    globalThis.performance = globalThis.performance || { getEntriesByType: () => [] };
    for (const name of ['Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'DragEvent', 'CustomEvent']) {
        globalThis[name] = class { constructor(type, init) { Object.assign(this, { type }, init || {}); } };
    }
    globalThis.DataTransfer = class { constructor() { this.items = { add() { } }; this.files = []; } };
    globalThis.File = class { constructor(bits, name) { this.name = name; } };
    globalThis.chrome = {
        runtime: {
            id: 'smoke', lastError: null,
            sendMessage: (...a) => { const cb = a.find(x => typeof x === 'function'); if (cb) { cb({}); return; } return Promise.resolve({}); },
            getURL: (p) => p,
        },
        storage: {
            local: {
                get: (keys, cb) => (cb ? cb({}) : Promise.resolve({})),
                set: (v, cb) => (cb ? cb() : Promise.resolve()),
                remove: (k, cb) => (cb ? cb() : Promise.resolve()),
            },
        },
    };
}

/**
 * A page where selectors RESOLVE.
 *
 * The empty-page stub above is not enough on its own: the regression that
 * shipped only fired once a field was actually claimed by an owner, so on a
 * page where nothing resolves the offending line never ran. This variant
 * answers every querySelector with a VISIBLE element, which is what makes the
 * recipe walk its real setup: step detected, fields collected, owners
 * assigned. querySelectorAll still answers empty, so no list/row machinery
 * spins and the test stays fast.
 */
function pageWithFields() {
    const visible = () => {
        const el = {
            style: {}, value: '', textContent: '', checked: false, tagName: 'INPUT',
            offsetParent: {}, children: [], id: 'smoke', type: 'text', disabled: false,
            setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
            appendChild() { }, remove() { }, focus() { }, blur() { }, click() { },
            addEventListener() { }, removeEventListener() { }, dispatchEvent: () => true,
            querySelector: () => null, querySelectorAll: () => [], closest: () => null,
            getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 20, bottom: 30, right: 110 }),
            scrollIntoView() { }, classList: { add() { }, remove() { }, contains: () => false },
            contains: () => false, matches: () => false, select() { },
        };
        return el;
    };
    globalThis.document.querySelector = () => visible();
    globalThis.document.getElementById = () => visible();
}

let mdlz;
let generic;
before(async () => {
    stubBrowser();
    mdlz = await import('../src/content-agent/recipe-mdlz-v1.js');
    generic = await import('../src/content-agent/recipe.js');
});

const WORKDAY_PROFILE = {
    firstName: 'Hieu', lastName: 'Vo', fullName: 'Hieu Vo',
    email: 'x@example.com', phone: '0700000000', city: 'Hà Nội', country: 'Vietnam',
};
const CV = {
    experience: [
        { title: 'Product Owner', company: 'ACME', start_date: '02/2023', end_date: '02/2026', description: 'x' },
        { title: 'No Month Job', company: 'BETA', start_date: '2021', end_date: '2022', description: 'y' },
    ],
    education: [{ school: 'University', degree: 'Bachelor', field: 'Business' }],
    languages: [{ language: 'Vietnamese', level: 'Native' }],
    skills: ['Agile/Scrum'],
};

for (const which of ['mdlz-v1', 'generic']) {
    describe(`${which}: the recipe's hot path runs without throwing`, () => {
        const mod = () => (which === 'mdlz-v1' ? mdlz : generic);

        test('applyRecipeFields survives an empty page', async () => {
            // The TDZ regression died exactly here: first pass, before any
            // widget existed. An empty page is the cheapest way to execute
            // every line of setup.
            const wd = mod().FALLBACK_RECIPES.find(r => r.ats === 'workday');
            const res = await mod().applyRecipeFields(wd, WORKDAY_PROFILE, null, CV);
            assert.ok(res && typeof res === 'object', 'must return a result object');
            assert.equal(typeof res.matched, 'boolean');
        });

        test('every fallback recipe can be walked for a matching step', async () => {
            for (const r of mod().FALLBACK_RECIPES) {
                const res = await mod().applyRecipeFields(r, WORKDAY_PROFILE, null, CV);
                assert.ok(res, `${r.ats} returned nothing`);
            }
        });

        test('the step helpers answer on an empty page instead of throwing', () => {
            const wd = mod().FALLBACK_RECIPES.find(r => r.ats === 'workday');
            assert.equal(typeof mod().atFinalStep(wd), 'boolean');
            assert.ok(Array.isArray(mod().recipeBlockingFields()));
            assert.doesNotThrow(() => mod().resetFieldStatus());
            assert.doesNotThrow(() => mod().recipeOwnedWrappers(wd));
        });
    });
}

describe('a field claimed by an owner does not crash the pass', () => {
    // THE REGRESSION, pinned. Shipping the owner filter above its own
    // `stepName` declaration threw "Cannot access 'stepName' before
    // initialization" on the first real page and killed the run — while the
    // whole suite stayed green, because nothing executed this path.
    const RECIPE = {
        ats: 'workday',
        steps: [{
            name: 'Smoke Step',
            detect: '[data-automation-id="smoke"]',
            advance: '[data-automation-id="pageFooterNextButton"]',
            fields: [
                { label: 'Work From', selector: '#wf', type: 'date', cvPath: 'experience.0.start_date' },
                { label: 'Language', selector: '#lang', type: 'custom-select' },
                { label: 'Postal Code', selector: '#pc', type: 'text', profileKey: 'postalCode' },
            ],
        }],
    };

    test('mdlz-v1 assigns owners without throwing', async () => {
        pageWithFields();
        const res = await mdlz.applyRecipeFields(RECIPE, WORKDAY_PROFILE, null, CV);
        assert.ok(res && typeof res === 'object');
    });

    test('the generic does the same', async () => {
        pageWithFields();
        const res = await generic.applyRecipeFields(RECIPE, WORKDAY_PROFILE, null, CV);
        assert.ok(res && typeof res === 'object');
    });
});

describe('mdlz-v1 and the generic still agree on their contract', () => {
    test('the router can bind every name it exports', () => {
        const names = ['applyRecipeFields', 'atFinalStep', 'clickRecipeGateway', 'FIELD_FAIL_BUDGET',
            'fillResolvedDate', 'inferFillDynamicField', 'loadRecipes', 'recipeBlockingFields',
            'recipeForUrl', 'recipeOwnedWrappers', 'recipeReleased', 'resetFieldStatus', 'recipeFieldStatus'];
        for (const n of names) {
            assert.ok(mdlz[n] !== undefined, `mdlz-v1 is missing ${n}`);
            assert.ok(generic[n] !== undefined, `generic is missing ${n}`);
        }
    });
});

// ── STATIC GUARD: a name used must be a name imported ──
//
// "recipeFieldStatus is not defined" killed a run because an edit that was
// supposed to add it to index.js's import list silently matched nothing —
// and no test could see it, since index.js is the loop and never runs here.
// esbuild does not catch it either: an unknown identifier is a global as far
// as a bundler is concerned. So the check is textual and cheap: every name
// index.js takes FROM the router must appear in the import statement it takes
// them from.
describe('index.js imports every router name it uses', () => {
    test('no identifier is referenced without being imported', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('../src/content-agent/index.js', import.meta.url), 'utf8');
        const routerSrc = readFileSync(new URL('../src/content-agent/recipe-router.js', import.meta.url), 'utf8');

        const importLine = src.split('\n').find(l => l.includes("from './recipe-router.js'"));
        assert.ok(importLine, 'index.js must import from the router');
        const imported = new Set(
            importLine.slice(importLine.indexOf('{') + 1, importLine.indexOf('}'))
                .split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean),
        );
        const exported = [...routerSrc.matchAll(/export const (\w+)/g)].map(m => m[1]);

        const body = src.slice(src.indexOf('\n', src.indexOf(importLine)));
        const missing = exported.filter(name => !imported.has(name)
            && new RegExp(`(?<![.\\w])${name}\\s*\\(`).test(body));
        assert.deepEqual(missing, [], `used but not imported: ${missing.join(', ')}`);
    });
});

// ── MDLZ v2, Milestone 0: reads the page, never touches it ──
describe('mdlz-v2 observes without acting', () => {
    test('the module loads and reports a step on an empty page', async () => {
        stubBrowser();
        const v2 = await import('../src/content-agent/mdlz-v2/index.js');
        const r = await v2.observeOnly({ sleep: () => Promise.resolve() });
        assert.ok(r && typeof r.step === 'string');
        assert.equal(typeof r.orphanOptions, 'number');
        assert.equal(typeof r.openPopups, 'number');
    });

    test('it refuses to take the page while the flag is off', async () => {
        stubBrowser();
        const v2 = await import('../src/content-agent/mdlz-v2/index.js');
        const r = await v2.runMdlzV2({ sleep: () => Promise.resolve() });
        assert.equal(r.took, false, 'v2 must never take the page while there is no executor');
    });

    // The gate suite drives these against a DOM built for them. This runs the
    // same entry points against the stub that answers "nothing on the page" to
    // every query — the shape a real page has for the first seconds of its life,
    // and the one that catches a helper used above its declaration.
    test('the sweep and the scheduler run on a page with nothing on it', async () => {
        stubBrowser();
        const pm = await import('../src/content-agent/mdlz-v2/popup-manager.js');
        const sch = await import('../src/content-agent/mdlz-v2/scheduler.js');
        const sleep = () => Promise.resolve();

        const s = await pm.sweep({ sleep, why: 'smoke' });
        assert.equal(s.clear, true, 'an empty page is already clear — no rung should be spent');
        assert.deepEqual(s.rungs, []);

        const ledger = await sch.runSequential([{ id: 'noop', run: () => 'SATISFIED' }], { sleep });
        assert.equal(ledger.ok, true);
        assert.equal(ledger.tasks[0].result, 'SATISFIED');
        assert.equal(ledger.tasks[0].attempts, 1, 'a settled page must not be waited out twice');
    });

    test('the config records the measurements that must not be re-learned', async () => {
        const c = await import('../src/content-agent/mdlz-v2/config.js');
        assert.match(c.FORBIDDEN.typeIntoDateSection, /writes NOTHING/);
        assert.equal(c.COMMIT_SIGNAL.dateSection, 'aria-valuenow');
        assert.ok(c.INTERACTION_ONLY.has(c.RESULT.BLOCKED_BY_POPUP));
        assert.ok(!c.INTERACTION_ONLY.has(c.RESULT.OPTION_NOT_FOUND));
    });
});
