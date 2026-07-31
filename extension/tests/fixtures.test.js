// The test-build fixture: a fake candidate complete enough to drive a real ATS.
//
// A fixture that drifts from the schema is worse than none — it makes the agent
// look broken on fields the fixture simply never filled, and the debugging goes
// looking in the wrong file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    DUMMY_PROFILE, DUMMY_CV, DUMMY_CV_FILENAME, buildDummyPdfBase64,
} from '../src/fixtures/dummy.js';
import * as dummy from '../src/fixtures/dummy.js';
import * as noop from '../src/fixtures/noop.js';
import { PROFILE_KEYS, buildManifest, classifyField, canonicalValue } from '../src/content-agent/needs.js';

describe('the production stub can stand in for the fixture', () => {
    test('it provides every name background.js imports', () => {
        // build.mjs swaps the module by path, so a missing export is an esbuild
        // error — but only for the names imported TODAY. Pinning them here keeps
        // the swap from quietly becoming a partial one.
        for (const name of ['initFixture', 'readFixtureCredential']) {
            assert.equal(typeof noop[name], 'function', `noop.js is missing ${name}`);
            assert.equal(typeof dummy[name], 'function', `dummy.js is missing ${name}`);
        }
    });

    test('the stub does nothing without a chrome runtime', () => {
        assert.doesNotThrow(() => noop.initFixture());
    });

    test('production never yields a credential', async () => {
        // The property that matters more than any other in this file: a shipped
        // build cannot log into an ATS with a password someone left in storage,
        // because the function that would read it returns null unconditionally.
        assert.equal(await noop.readFixtureCredential(), null);
    });
});

describe('the fixture credential', () => {
    // chrome.storage stub — enough to exercise the read, and it disappears with
    // the test rather than becoming a fake the rest of the suite quietly leans on.
    const withStorage = async (value, fn) => {
        const prev = globalThis.chrome;
        globalThis.chrome = { storage: { local: { get: async () => ({ jobfitApplyCredentials: value }) } } };
        try { return await fn(); } finally { globalThis.chrome = prev; }
    };

    test('defaults to LOGIN, not signup', async () => {
        // Supplying a credential says the account exists. Probing signup first —
        // the right default when that is unknown — means every test run opens by
        // trying to register an account that is already there.
        const c = await withStorage({ email: 'a@b.test', password: 'pw' }, dummy.readFixtureCredential);
        assert.equal(c.operation, 'login');
    });

    test('signup is available when asked for by name', async () => {
        const c = await withStorage({ email: 'a@b.test', password: 'pw', operation: 'signup' },
            dummy.readFixtureCredential);
        assert.equal(c.operation, 'signup');
    });

    test('a half-filled credential is no credential', async () => {
        // Otherwise a typo'd key sends the agent at a login form with a blank
        // password, which burns an attempt against the tenant's budget.
        for (const bad of [null, {}, { email: 'a@b.test' }, { password: 'pw' }, { email: '', password: 'pw' }]) {
            assert.equal(await withStorage(bad, dummy.readFixtureCredential), null, JSON.stringify(bad));
        }
    });

    test('no chrome runtime means no credential', async () => {
        const prev = globalThis.chrome;
        globalThis.chrome = undefined;
        try { assert.equal(await dummy.readFixtureCredential(), null); } finally { globalThis.chrome = prev; }
    });
});

describe('the fake profile matches the real schema', () => {
    test('every key it defines is one the agent reads', () => {
        const unknown = Object.keys(DUMMY_PROFILE).filter(k => !PROFILE_KEYS.has(k));
        assert.deepEqual(unknown, [], 'a key outside ExtensionProfile is never read — dead fixture data');
    });

    test('every key the agent reads is one it defines', () => {
        const missing = [...PROFILE_KEYS].filter(k => !(k in DUMMY_PROFILE));
        assert.deepEqual(missing, [], 'an unset key reads as a gap the tester cannot close');
    });
});

describe('it answers the fields that actually blocked a real run', () => {
    // Every one of these was measured as REQUIRED on Mondelez, and each stopped
    // the application when nothing supplied it. A fixture that leaves them empty
    // cannot exercise the steps they gate.
    const DATA = { profile: DUMMY_PROFILE, cv: DUMMY_CV };

    for (const label of [
        'School or University', 'Field of Study', 'Overall Result (GPA)',
        'Postal Code', 'Phone Number', 'First Name',
    ]) {
        test(`answers "${label}"`, () => {
            const v = canonicalValue(classifyField({ label }), DATA);
            assert.ok(v && String(v.value).trim(), `${label} resolves to nothing`);
        });
    }

    test('a required-everything page produces no gaps', () => {
        const fields = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Postal Code',
            'School or University', 'Field of Study', 'Overall Result (GPA)']
            .map(label => ({ label, selector: `#${label.replace(/\W/g, '')}`, value: '', required: true }));
        const m = buildManifest(fields, { profile: DUMMY_PROFILE, cv: DUMMY_CV });
        assert.deepEqual(m.gaps.map(g => g.label), []);
    });
});

describe('the generated PDF is a real PDF', () => {
    const pdf = Buffer.from(buildDummyPdfBase64(), 'base64').toString('latin1');

    test('has the header, trailer and a resolvable xref', () => {
        assert.ok(pdf.startsWith('%PDF-1.4'));
        assert.ok(pdf.trimEnd().endsWith('%%EOF'));
        const at = Number(pdf.match(/startxref\s+(\d+)/)[1]);
        assert.equal(pdf.slice(at, at + 4), 'xref', 'startxref must point AT the xref table');
    });

    test('each xref offset lands on the object it claims', () => {
        // The one thing a hand-built PDF gets wrong silently: a parser that
        // trusts the table reads garbage, and the ATS reports "unreadable file"
        // rather than anything that points here.
        const rows = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
        assert.equal(rows.length, 5);
        rows.forEach((off, i) => {
            assert.ok(pdf.startsWith(`${i + 1} 0 obj`, off), `object ${i + 1} is not at offset ${off}`);
        });
    });

    test('carries the CV text a résumé parser would read', () => {
        assert.match(pdf, /TEST Nguyen Van A/);
        assert.match(pdf, /Example National University/);
    });

    test('says what it is, in the text and in the filename', () => {
        // The safeguard that survives a screenshot: anyone looking at this
        // document, or at a file picker showing it, can tell it is not real.
        assert.match(pdf, /DO NOT SUBMIT/);
        assert.match(DUMMY_CV_FILENAME, /TEST/);
    });
});

describe('nothing here can be mistaken for a person', () => {
    test('the address is a reserved TLD that cannot receive mail', () => {
        // .invalid is reserved by RFC 2606 precisely so it can never resolve —
        // a typo'd real domain would send a stranger a job application.
        assert.match(DUMMY_PROFILE.email, /@example\.invalid$/);
        assert.equal(DUMMY_CV.contact.email, DUMMY_PROFILE.email);
    });

    test('the name announces itself', () => {
        assert.match(DUMMY_PROFILE.fullName, /TEST/);
        assert.match(DUMMY_CV.summary, /not a real person/i);
    });

    test('demographic fields are blank, not invented', () => {
        // The fixture must not pre-answer what the policy refuses to answer, or
        // a test build silently passes a step the real build stops on.
        assert.equal(DUMMY_PROFILE.gender, '');
        assert.equal(DUMMY_CV.personal.gender, '');
    });
});

describe('a build says whether it reads local credentials', () => {
    test('the two modules disagree, on purpose', () => {
        // Switching dist from build:test to build silently removed the local
        // credential path, and the agent then failed with "no credential for this
        // site" — which reads as a broken agent rather than the wrong bundle. The
        // flag is what lets the failure name itself.
        assert.equal(dummy.FIXTURE_CREDS_SUPPORTED, true);
        assert.equal(noop.FIXTURE_CREDS_SUPPORTED, false);
    });
});
