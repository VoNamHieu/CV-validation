// The note that goes in an ATS's "message to the hiring team" box.
//
// Two things are being protected here. First, that the box reads `applyMessage`
// and not `coverLetter`: coverLetter falls back to the CV SUMMARY when no letter
// was generated, so an application whose owner never pressed "Tạo thư giới
// thiệu" used to send a third-person paragraph about themselves to a box asking
// what they wanted to say. Second, that a job title parsed off the tab title is
// the ROLE — "Easy apply" as the title produces a message applying for a job
// called Easy apply, on a real application, under the candidate's name.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RECIPES, parseDocumentTitle } from '../src/content-agent/recipe.js';
import { PROFILE_KEYS, classifyField } from '../src/content-agent/needs.js';

describe('the SmartRecruiters message field', () => {
    const sr = FALLBACK_RECIPES.find(r => r.ats === 'smartrecruiters');
    const field = sr.steps
        .flatMap(s => s.fields || [])
        .find(f => f.label === 'Message');

    test('reads the short per-job message, not the cover letter', () => {
        assert.equal(field.profileKey, 'applyMessage');
    });

    test('is written by the agent when nothing was synced for it', () => {
        // An apply that never went through the editor carries no message. The
        // field is not skipped for having no value — it is generated.
        assert.equal(field.generate, 'message');
    });

    test('is resolved through the shadow root the control actually lives in', () => {
        // Verified live (Bosch, 2026-08-01): <oc-textarea data-test=…> wraps an
        // <spl-textarea> whose SHADOW root holds the real <textarea>.
        assert.equal(field.type, 'shadow-text');
        assert.match(field.selector, /hiring-manager-message-text/);
    });

    test('is not marked required — an empty optional box beats a filled wrong one', () => {
        assert.ok(!field.required);
    });
});

describe('applyMessage is a key the agent can actually read', () => {
    test('it is in the profile schema', () => {
        // A profileKey the schema does not define reads as undefined forever,
        // which is indistinguishable from "the user has not filled it in".
        assert.ok(PROFILE_KEYS.has('applyMessage'));
    });

    test('a "message" field classifies as applyMessage, not coverLetter', () => {
        assert.equal(classifyField({ label: 'Message to the Hiring Team' })?.key, 'applyMessage');
        assert.equal(classifyField({ label: 'Lời nhắn cho nhà tuyển dụng' })?.key, 'applyMessage');
    });

    test('a real cover-letter field still classifies as coverLetter', () => {
        assert.equal(classifyField({ label: 'Cover letter' })?.key, 'coverLetter');
        assert.equal(classifyField({ label: 'Thư giới thiệu' })?.key, 'coverLetter');
    });
});

describe('reading the job off the tab title', () => {
    test('the measured SmartRecruiters title', () => {
        const t = parseDocumentTitle(
            'Easy apply - [EMC] Embedded Android Developer (01 Year Contact) - Bosch Group');
        assert.equal(t.title, '[EMC] Embedded Android Developer (01 Year Contact)');
        assert.equal(t.company, 'Bosch Group');
    });

    test('a plain "<role> - <company>" title', () => {
        const t = parseDocumentTitle('Senior Product Owner - Techcombank');
        assert.equal(t.title, 'Senior Product Owner');
        assert.equal(t.company, 'Techcombank');
    });

    test('flow words never become the job title', () => {
        for (const raw of [
            'Apply - Data Analyst - VNG',
            'Application form | Data Analyst | VNG',
            'Ứng tuyển – Data Analyst – VNG',
        ]) {
            assert.equal(parseDocumentTitle(raw).title, 'Data Analyst', raw);
        }
    });

    test('a one-part title is a role with no company, not a role that is its own company', () => {
        const t = parseDocumentTitle('Backend Engineer');
        assert.equal(t.title, 'Backend Engineer');
        assert.equal(t.company, '');
    });

    test('a title made only of flow words yields nothing to apply for', () => {
        // The caller refuses to write a message on this — better an empty
        // optional box than one addressed to a job that was never named.
        assert.deepEqual(parseDocumentTitle('Easy apply'), { title: '', company: '' });
        assert.deepEqual(parseDocumentTitle(''), { title: '', company: '' });
        assert.deepEqual(parseDocumentTitle(null), { title: '', company: '' });
    });
});
