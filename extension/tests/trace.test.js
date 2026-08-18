// The run trace: what a failed apply leaves behind for whoever debugs it.
//
// This buffer exists to be pasted somewhere — a chat, an issue — so what it must
// never carry matters as much as what it must.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// sessionStorage + a console that records instead of printing. Installed before
// the module is imported, because the module reads sessionStorage on first use.
const store = new Map();
globalThis.sessionStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
};
globalThis.location = { pathname: '/recruiting/mdlz/External/job/apply' };

const logged = [];
globalThis.console = { ...console, log: (...a) => logged.push(a), warn: (...a) => logged.push(a), table: () => { } };

const { trace, traceClear, traceDump } = await import('../src/content-agent/trace.js');

const rows = () => JSON.parse(store.get('copoAgentTrace') || '[]');

describe('the trace', () => {
    beforeEach(() => { store.clear(); logged.length = 0; });

    test('records a step with its data', () => {
        trace('auth.grant', { ok: true, operation: 'login' });
        assert.equal(rows().length, 1);
        assert.equal(rows()[0].step, 'auth.grant');
        assert.equal(rows()[0].operation, 'login');
    });

    test('survives a navigation', () => {
        // The whole reason it is in sessionStorage. The cause of a failed apply is
        // usually several page loads back, in a console that no longer exists.
        trace('login.submit', { via: 'button' });
        const carried = rows();
        assert.equal(carried.length, 1, 'a fresh page load reads the same buffer');
        trace('login.outcome', { verdict: 'success' });
        assert.deepEqual(rows().map(r => r.step), ['login.submit', 'login.outcome']);
    });

    test('a dump includes the steps from before the last navigation', () => {
        trace('auth.wall', {});
        trace('login.submit', {});
        assert.equal(traceDump('blocked').length, 2);
    });

    test('clearing is explicit, so a page load cannot lose the evidence', () => {
        trace('auth.wall', {});
        traceClear();
        assert.equal(rows().length, 0);
    });
});

describe('what it refuses to write down', () => {
    beforeEach(() => { store.clear(); logged.length = 0; });

    test('a password becomes a length', () => {
        trace('login.fill', { password: 'hunter2', passwordConfirm: 'hunter2' });
        const r = rows()[0];
        assert.equal(JSON.stringify(r).includes('hunter2'), false);
        assert.match(r.password, /«7 chars»/);
    });

    test('anything credential-shaped is caught by name, not by value', () => {
        trace('auth.grant', { apiToken: 'abc123', userCredential: 'x', secretKey: 'y' });
        const s = JSON.stringify(rows()[0]);
        for (const leak of ['abc123', 'secretKey":"y']) assert.equal(s.includes(leak), false);
    });

    test('an email in a quoted error banner is masked', () => {
        // Auth banners quote the account back at you — "No account for x@y.com".
        // The trace is written to be shared, so reproducing it verbatim would hand
        // someone's address to whoever reads the paste.
        trace('login.outcome', { banner: 'No account found for hieu.vo@example.com — try again' });
        const r = rows()[0];
        assert.equal(r.banner.includes('hieu.vo@example.com'), false);
        assert.match(r.banner, /h\*\*\*@example\.\*\*\*/, 'still recognisable as which account');
    });

    test('a runaway value cannot swallow the buffer', () => {
        trace('login.noWall', { bodyHead: 'x'.repeat(5000) });
        assert.ok(rows()[0].bodyHead.length <= 200);
    });
});
