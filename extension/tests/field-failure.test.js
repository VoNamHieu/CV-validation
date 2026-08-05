// What the agent does with a field it knows it failed to fill.
//
// The behaviour this replaces: nothing consumed the FAIL verdict. The recipe
// reported "Language — never committed", re-ran the identical strategy next
// pass, derived the identical failure, and meanwhile the loop clicked "Save and
// Continue" — because the page did not list the widget as unfilled-required and
// rendered no error, so from the advance gate's point of view the step was done.
// The application moved on carrying a field the agent had just told itself it
// had not filled.
//
// Two rules come out of that: a failure has to be COUNTED (so "try something
// else" has a trigger), and it has to BLOCK the advance while the count is
// inside its budget (so the step cannot be papered over). Both are bounded —
// a widget nobody can drive must cost a few passes and then let go, not
// deadlock the run.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FIELD_FAIL_BUDGET, recipeBlockingFields, recipeFieldStatus,
    recipeReleased, recordOutcomes, resetFieldStatus, writeStrategy,
} from '../src/content-agent/recipe.js';

const FAIL = (label, why) => [[label, 'FAIL', why]];
const OK = (label) => [[label, 'OK', 'value']];

beforeEach(() => resetFieldStatus());

describe('a repeated failure is counted, not rediscovered', () => {
    test('the same failure three passes running is a streak of three', () => {
        for (let i = 0; i < 3; i++) recordOutcomes(FAIL('Language', 'never committed'));
        assert.equal(recipeFieldStatus('Language').fails, 3);
    });

    test('distinct reasons are remembered, so an escalation knows what is ruled out', () => {
        recordOutcomes(FAIL('Language', 'level1:no-row'));
        recordOutcomes(FAIL('Language', 'list-closed'));
        recordOutcomes(FAIL('Language', 'level1:no-row'));   // a repeat is not a new fact
        assert.deepEqual(recipeFieldStatus('Language').tried, ['level1:no-row', 'list-closed']);
    });

    test('any success ends the streak', () => {
        recordOutcomes(FAIL('Language', 'never committed'));
        recordOutcomes(FAIL('Language', 'never committed'));
        recordOutcomes(OK('Language'));
        assert.equal(recipeFieldStatus('Language').fails, 0);
        assert.deepEqual(recipeBlockingFields(), []);
    });

    test("'absent' ends it too — a widget that stopped resolving is a different situation", () => {
        // Carrying the old count into it would spend a budget the new situation
        // never used, and the field would be released before it had been tried.
        recordOutcomes(FAIL('Field of Study', 'no control'));
        recordOutcomes([['Field of Study', 'absent', 'not rendered yet']]);
        assert.equal(recipeFieldStatus('Field of Study').fails, 0);
    });
});

describe('a failing field holds the step — for a bounded number of passes', () => {
    test('one failure already blocks the advance', () => {
        recordOutcomes(FAIL('Language', 'never committed'));
        assert.deepEqual(recipeBlockingFields().map(b => b.label), ['Language']);
    });

    test('it keeps blocking while it is inside the budget', () => {
        for (let i = 0; i < FIELD_FAIL_BUDGET; i++) recordOutcomes(FAIL('Language', 'never committed'));
        assert.equal(recipeBlockingFields().length, 1);
    });

    test('past the budget it lets go, so the run cannot deadlock', () => {
        // The failure does not disappear — it stops holding the step and travels
        // to the user in the review instead.
        for (let i = 0; i < FIELD_FAIL_BUDGET + 1; i++) recordOutcomes(FAIL('Language', 'never committed'));
        assert.deepEqual(recipeBlockingFields(), []);
        assert.equal(recipeFieldStatus('Language').status, 'FAIL');
        assert.equal(recipeReleased('Language'), true);
    });

    test('only failures block — done / skip / absent do not', () => {
        recordOutcomes([
            ['Degree', 'done', 'already filled'],
            ['Work To', 'skip', 'no end date (current role)'],
            ['Field of Study', 'absent', 'not rendered yet'],
        ]);
        assert.deepEqual(recipeBlockingFields(), []);
    });

    test('several failing fields all hold, and are all named', () => {
        recordOutcomes([
            ['Language', 'FAIL', 'never committed'],
            ['Language level', 'FAIL', 'option-not-found'],
            ['Skills', 'OK', 'x'],
        ]);
        assert.deepEqual(recipeBlockingFields().map(b => b.label).sort(), ['Language', 'Language level']);
    });
});

describe('a new step starts with its own budget', () => {
    test('reset clears the verdicts', () => {
        for (let i = 0; i < FIELD_FAIL_BUDGET + 1; i++) recordOutcomes(FAIL('Language', 'never committed'));
        resetFieldStatus();
        assert.equal(recipeFieldStatus('Language'), null);
        assert.deepEqual(recipeBlockingFields(), []);
        // And the next step's first failure has its full budget, rather than
        // inheriting an exhausted one from a widget that is no longer on screen.
        recordOutcomes(FAIL('Language', 'never committed'));
        assert.equal(recipeBlockingFields().length, 1);
    });
});

// ── A value that was written and then thrown away ───────────────────────────
// The other half of "counted, not rediscovered": a dropdown that never commits
// is caught by the FAIL verdict above, but a TEXT box that accepts a value and
// loses it on the next re-render used to be indistinguishable from one that was
// never filled. So the recipe rewrote it every pass, reported OK every pass, and
// the run ended NEED_HUMAN on a field it believed it had filled (measured on
// PwC's local-script name box).

describe('a text box that loses what we wrote', () => {
    test('the first write is the keyboard route', () => {
        const s = writeStrategy(undefined);
        assert.equal(s.method, 'keyboard');
        assert.equal(s.wipes, 0);
        assert.equal(s.giveUp, false);
    });

    test('finding it empty after writing counts as a wipe and changes route', () => {
        const s = writeStrategy({ value: 'Vo', wipes: 0 });
        assert.equal(s.wipes, 1);
        assert.equal(s.method, 'native-event', 'the same route a third time is the loop, not a retry');
        assert.equal(s.giveUp, false);
    });

    test('wipes are bounded by the same budget every other failure gets', () => {
        assert.equal(writeStrategy({ value: 'Vo', wipes: FIELD_FAIL_BUDGET - 1 }).giveUp, false);
        assert.equal(writeStrategy({ value: 'Vo', wipes: FIELD_FAIL_BUDGET }).giveUp, true,
            'past the budget the box is reported, not rewritten');
    });
});
