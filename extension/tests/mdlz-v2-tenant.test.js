// Tenant derivation + the ownership gate — the Nhịp-2 generalisation that let
// one engine recognise a SECOND Workday tenant. The measured trap: the tenant
// id lives in the PATH on myworkdaysite.com but in the SUBDOMAIN on
// myworkdayjobs.com (Maersk), so a single path regex returned the wrong id.
// These freeze both, and that v2 stands down on a Workday tenant it has not
// been cleared for.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { deriveTenant, isOwnedPage, ENABLED_TENANTS } from '../src/content-agent/mdlz-v2/config.js';

const setLocation = (hostname, pathname) => { globalThis.location = { hostname, pathname }; };
const savedLocation = globalThis.location;
afterEach(() => { globalThis.location = savedLocation; });

describe('deriveTenant reads the id from wherever the URL carries it', () => {
    test('myworkdaysite.com: tenant is in the path (/recruiting/mdlz/)', () => {
        setLocation('wd3.myworkdaysite.com', '/en-US/recruiting/mdlz/External/job/R-1/apply/applyManually');
        assert.equal(deriveTenant(), 'mdlz');
    });

    test('myworkdayjobs.com: tenant is the SUBDOMAIN, NOT the /Site_Careers/ path segment', () => {
        setLocation('maersk.wd3.myworkdayjobs.com', '/en-US/Maersk_Careers/job/x/apply/applyManually');
        assert.equal(deriveTenant(), 'maersk', 'Maersk_Careers is the site; maersk (subdomain) is the tenant');
    });

    test('a cxs API path is read too', () => {
        setLocation('anything.myworkdaysite.com', '/wday/cxs/someco/skillsearch');
        assert.equal(deriveTenant(), 'someco');
    });

    test('an un-derivable page is null, never a silent fallback to mdlz', () => {
        setLocation('example.com', '/');
        assert.equal(deriveTenant(), null);
    });
});

describe('isOwnedPage gates v2 to tenants it can COMPLETE, not merely recognise', () => {
    test('MDLZ is owned', () => {
        setLocation('wd3.myworkdaysite.com', '/en-US/recruiting/mdlz/External/apply');
        assert.equal(isOwnedPage(), true);
    });

    test('Maersk is DERIVABLE but not yet owned — engagement proven, held until a clean live pass', () => {
        // The degree-ladder loop is FIXED (category fallthrough, unit-proven both
        // vocabularies). But `enabled` means "can COMPLETE", and two maersk gaps
        // are still unmeasured for v2: the segmented date-of-birth widget (v1
        // looped ~3 min there) and the sign-in chooser. It stays declined until a
        // clean live run clears them.
        setLocation('maersk.wd3.myworkdayjobs.com', '/Maersk_Careers/job/x/apply');
        assert.equal(deriveTenant(), 'maersk', 'the mechanism recognises it');
        assert.ok(!ENABLED_TENANTS.has('maersk'), 'but it is not cleared to complete');
        assert.equal(isOwnedPage(), false, 'so v2 stands down and v1 serves it to Review');
    });

    test('any Workday tenant not in the allowlist is declined (v2 stands down, v1 serves it)', () => {
        assert.ok(!ENABLED_TENANTS.has('someco'));
        setLocation('someco.wd3.myworkdayjobs.com', '/SomeCo_Careers/job/x/apply');
        assert.equal(isOwnedPage(), false);
    });

    test('a non-Workday host is never owned', () => {
        setLocation('careers.google.com', '/apply');
        assert.equal(isOwnedPage(), false);
    });
});
