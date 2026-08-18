// The knowledge library is DATA, but it still has contracts: everything loads,
// every claim carries provenance, the registry resolves, and capabilities never
// smuggle a tenant name into their routing. This is the guard that keeps the
// library honest as it grows tenant by tenant — and it proves the whole tree
// imports without a broken path (the god-file / dangling-import smoke test).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    registry, tenantFor, capabilities, slots, confirmedCapabilities,
    workdayExternalApplication, validateKnowledge,
} from '../src/knowledge/index.js';

describe('knowledge library — provenance and shape', () => {
    test('validateKnowledge passes: every entry carries measuredOn', () => {
        assert.equal(validateKnowledge(), true);
    });

    test('both tenants are present, each assembled from its focused parts', () => {
        assert.deepEqual(Object.keys(registry).sort(), ['maersk', 'mdlz']);
        for (const t of Object.values(registry)) {
            assert.ok(t.signature && t.fieldSets && t.playbook && t.evidence, `${t.id} missing a part`);
        }
    });

    test('MDLZ is enabled and proven; Maersk is harvested but v1-served', () => {
        assert.equal(registry.mdlz.enabled, true);
        assert.equal(registry.maersk.enabled, false);
        assert.equal(registry.maersk.evidence.measuredOn[0].result, 'dry-run');
    });

    test('tenantFor resolves by host+path, and Maersk carries the subdomain-tenant warning', () => {
        assert.equal(tenantFor({ hostname: 'wd3.myworkdaysite.com', pathname: '/en-US/recruiting/mdlz/External/job/x/apply' })?.id, 'mdlz');
        assert.equal(tenantFor({ hostname: 'maersk.wd3.myworkdayjobs.com', pathname: '/Maersk_Careers/job/x/apply' })?.id, 'maersk');
        assert.equal(tenantFor({ hostname: 'example.com', pathname: '/' }), null);
        assert.equal(registry.maersk.signature.tenantFrom.source, 'subdomain');
    });
});

describe('capabilities route by shape, never by tenant', () => {
    test('capability ROUTING/BEHAVIOUR never branches on a tenant — only provenance may name one', () => {
        for (const cap of Object.values(capabilities)) {
            // measuredOn/notes/todo are provenance — they MUST name the tenant.
            // Everything that decides what the capability DOES must not.
            const { measuredOn, notes, todo, ...behaviour } = cap;
            const blob = JSON.stringify(behaviour).toLowerCase();
            assert.ok(!/\bmdlz\b|\bmaersk\b/.test(blob), `${cap.id} names a tenant in its behaviour`);
            assert.ok(!/skills\[\]|fieldofstudy/.test(JSON.stringify(cap.fingerprint || {}).toLowerCase()), `${cap.id} fingerprints a slot`);
        }
    });

    test('confirmed capabilities have confidence ≥ 2 (a second tenant reused them)', () => {
        for (const id of confirmedCapabilities) {
            assert.ok(capabilities[id].confidence >= 2, `${id} is confirmed but confidence < 2`);
        }
        // The crown jewel is honest about being MDLZ-only so far.
        assert.equal(capabilities['chip-search-multi'].status, 'unverified');
    });

    test('every slot names a capability that exists', () => {
        for (const s of Object.values(slots)) {
            assert.ok(capabilities[s.capability], `slot ${s.id} → unknown capability ${s.capability}`);
        }
    });
});

describe('the archetype does not fix the step count', () => {
    test('stepCountIsFixed is false — mdlz=5, maersk=6', () => {
        assert.equal(workdayExternalApplication.workflow.stepCountIsFixed, false);
        assert.equal(registry.mdlz.fieldSets.steps, 5);
        assert.equal(registry.maersk.fieldSets.steps, 6);
    });
});
