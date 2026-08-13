// The data-write fallback's fiber read. The live shape (measured 2026-08-13):
// props with onSelect(fn) + values[] sit a dozen levels above the search input.
// In production the content script (ISOLATED world) can never see the fiber —
// readSkillsOnSelect returns null there and the write goes through the
// background's MAIN-world bridge instead; these freeze the reader itself.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSkillsOnSelect } from '../src/content-agent/mdlz-v2/executors.js';

describe('readSkillsOnSelect finds the multiselect commit handler on the fiber', () => {
    const chain = (levels) => {
        // levels: array of memoizedProps, innermost first; returns the innermost el
        let parent = null;
        for (let i = levels.length - 1; i >= 0; i--) parent = { memoizedProps: levels[i], return: parent };
        const el = {};
        el['__reactFiber$test'] = parent;
        return el;
    };

    test('walks up to the level that carries onSelect + values', () => {
        const onSelect = () => {};
        const el = chain([{ onSelect, values: [{ label: 'SQL', id: 'R-1' }] }, { foo: 1 }, { bar: 2 }]);
        const p = readSkillsOnSelect(el);
        assert.ok(p);
        assert.equal(p.onSelect, onSelect);
        assert.equal(p.values.length, 1);
    });

    test('onSelect without a values array does not count', () => {
        const el = chain([{ onSelect: () => {} }, { values: 'not-an-array', onSelect: () => {} }]);
        assert.equal(readSkillsOnSelect(el), null);
    });

    test('no fiber (the harness, the isolated world) → null, and the fallback routes to the bridge', () => {
        assert.equal(readSkillsOnSelect({}), null);
        assert.equal(readSkillsOnSelect(null), null);
    });
});
