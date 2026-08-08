// The gate for Milestone 1: after Skills, nothing of Skills is left on the page.
//
// The number this file exists to hold at zero was measured on the live form:
// clicking Degree found 39 options, 20 of which belonged to Skills, whose list
// nobody had closed. Degree then reported "did not open", the calendar before it
// reported the same, and both fields were working. Every one of those verdicts
// was about a page nobody had cleared.
//
// A gate that cannot fail measures nothing, so the first test here is the
// NEGATIVE CONTROL: the same page, driven without the popup manager, must still
// produce the leftovers. If that test ever goes green while the gate does, the
// harness stopped being hostile and the gate below is worth nothing.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildHostilePage, DEGREES, SKILLS } from './harness/hostile-page.js';

let dom;
let page;
let observer;
let popups;
let scheduler;
let RESULT;
let PAGE_LOCK;
const logged = [];

/** Compressed, but real: ordering still comes from the event loop, not a fake clock. */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

const waitUntil = async (fn, budgetMs = 2000) => {
    const by = Date.now() + budgetMs;
    while (Date.now() < by) {
        if (fn()) return true;
        await sleep(8);
    }
    return fn();
};

const optionNamed = (lease, text) =>
    lease.options().find((o) => (o.textContent || '').trim() === text) || null;

/** A census carries live nodes, and a node cannot be stringified — say it in words. */
const brief = (r) => {
    const c = r?.after || r?.sweep?.after || r;
    return `orphans=${c?.orphans} lists=${c?.lists} result=${r?.result || ''} reason=${r?.reason || ''}`;
};

before(async () => {
    // trace() logs every decision. Useful in a browser, noise here — but keep
    // the rows, because "did the sweep even run" is a fair thing to assert.
    // eslint-disable-next-line no-console
    console.log = (...args) => { logged.push(args.join(' ')); };
    dom = installDom();
    observer = await import('../src/content-agent/mdlz-v2/page-observer.js');
    popups = await import('../src/content-agent/mdlz-v2/popup-manager.js');
    scheduler = await import('../src/content-agent/mdlz-v2/scheduler.js');
    ({ RESULT, PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    logged.length = 0;
    page = buildHostilePage(dom.document);
});

// ── the negative control ─────────────────────────────────────────────────

describe('the harness still reproduces what was measured', () => {
    test('a Skills fill driven WITHOUT the manager leaves its list on the page', async () => {
        const f = page.fields.skills;
        f.trigger.click();
        await waitUntil(() => observer.visibleOptions().length > 0);
        optionNamed({ options: () => observer.visibleOptions() }, 'Figma')?.click();
        await waitUntil(() => page.chipsOn('skills').includes('Figma'));

        // Unclaimed, because a Workday search prompt stamps no aria-expanded on
        // its box — which is exactly why the live count called them orphans.
        assert.equal(observer.openPopups().length, 0, 'no trigger claims this list');
        assert.ok(observer.orphanOptionCount() >= SKILLS.length,
            `expected Skills leftovers, saw ${observer.orphanOptionCount()}`);
    });

    test('and the next field then reads those leftovers as its own options', async () => {
        page.fields.skills.trigger.click();
        await waitUntil(() => observer.visibleOptions().length > 0);

        page.fields.degree.trigger.click();
        await waitUntil(() => observer.visibleOptions().length > SKILLS.length);

        // The 39-options shape, in miniature: a field that reads the page
        // globally gets its own catalogue plus somebody else's.
        const onPage = observer.visibleOptions().length;
        assert.ok(onPage > DEGREES.length,
            `Degree should see a polluted page: ${onPage} options vs its own ${DEGREES.length}`);
    });
});

// ── the gate ─────────────────────────────────────────────────────────────

describe('MILESTONE 1 GATE — zero stray options after Skills', () => {
    /** Fills Skills through a lease, exactly as an executor will in M2. */
    const skillsTask = (want = ['Figma', 'SQL']) => ({
        id: 'skills',
        run: async () => {
            const r = await popups.withList(page.fields.skills.trigger, async (lease) => {
                for (const s of want) {
                    const opt = optionNamed(lease, s);
                    if (!opt) return { result: RESULT.OPTION_NOT_FOUND };
                    opt.click();
                    await waitUntil(() => page.chipsOn('skills').includes(s));
                }
                return { ok: true };
            }, { sleep, label: 'Skills' });
            return r.ok ? r.value : r;
        },
    });

    const degreeTask = (seen) => ({
        id: 'degree',
        run: async () => {
            const r = await popups.withList(page.fields.degree.trigger, async (lease) => {
                seen.count = lease.options().length;
                const opt = optionNamed(lease, DEGREES[0]);
                if (!opt) return { result: RESULT.OPTION_NOT_FOUND };
                opt.click();
                await waitUntil(() => page.fields.degree.trigger.textContent === DEGREES[0]);
                return { ok: true };
            }, { sleep, label: 'Degree' });
            return r.ok ? r.value : r;
        },
    });

    test('the page is clear the moment the Skills task returns', async () => {
        const ledger = await scheduler.runSequential([skillsTask()], { sleep });
        const skills = ledger.tasks.find((t) => t.id === 'skills');

        assert.equal(skills.result, RESULT.COMMITTED, JSON.stringify(skills));
        // `leaked` is counted BEFORE the scheduler's own cleanup, so this is the
        // task's own hygiene, not the scheduler covering for it.
        assert.equal(skills.leaked, 0, 'Skills left options on the page');
        assert.equal(ledger.leaks, 0);
        assert.equal(observer.orphanOptionCount(), 0);
        assert.equal(observer.visibleLists().length, 0);
        assert.ok(ledger.clean);
    });

    test('the chips it committed are not counted as options', async () => {
        await scheduler.runSequential([skillsTask()], { sleep });
        // The chips carry role="option" — measured on Mondelez, where a
        // committed "Vietnam (+84)" sits in selectedItemList under the option
        // id. Counting them would make the page uncleanable, and CLICKING one
        // would deselect the answer.
        assert.deepEqual(page.chipsOn('skills'), ['Figma', 'SQL']);
        assert.equal(observer.orphanOptionCount(), 0);
    });

    test('Degree, run straight after Skills, sees only its own catalogue', async () => {
        const seen = {};
        const ledger = await scheduler.runSequential([skillsTask(), degreeTask(seen)], { sleep });

        assert.equal(seen.count, DEGREES.length,
            `Degree saw ${seen.count} options; its catalogue holds ${DEGREES.length}`);
        assert.deepEqual(ledger.tasks.map((t) => t.result), [RESULT.COMMITTED, RESULT.COMMITTED]);
        assert.equal(ledger.leaks, 0);
        assert.equal(page.fields.degree.trigger.textContent, DEGREES[0]);
    });

    test('a lease opened over somebody\'s leftovers still owns only its own list', async () => {
        // No scheduler here on purpose. The clear-first step inside openList is
        // what makes the word "own" mean anything: a portalled list carries no
        // ancestry to disown it by, so ownership is established or it is guessed.
        page.fields.skills.trigger.click();
        await waitUntil(() => observer.visibleOptions().length > 0);
        assert.ok(observer.orphanOptionCount() > 0, 'the stray must be there to be cleared');

        const r = await popups.openList(page.fields.degree.trigger, { sleep, label: 'Degree' });
        assert.ok(r.ok, brief(r));
        assert.equal(r.lease.options().length, DEGREES.length);
        await r.lease.close();
    });

    test('a task that throws mid-widget still leaves the page clear', async () => {
        // The measured shape: a crash inside Skills left a list that covered
        // Degree a pass later. The `finally` in withList is the whole fix.
        const r = await popups.withList(page.fields.skills.trigger, async () => {
            throw new Error('boom, halfway through');
        }, { sleep, label: 'Skills' });

        assert.equal(r.ok, false);
        assert.equal(r.result, RESULT.COMMIT_FAILED);
        assert.ok(await waitUntil(() => observer.orphanOptionCount() === 0));
    });
});

// ── the ladder ───────────────────────────────────────────────────────────

describe('the sweep escalates instead of repeating itself', () => {
    test('a list deaf to Escape is closed by the rung after it', async () => {
        page.fields.source.trigger.click();
        await waitUntil(() => observer.visibleOptions().length > 0);

        const s = await popups.sweep({ sleep, why: 'test', budgetMs: 800 });
        assert.ok(s.clear, `not cleared: ${brief(s)}`);
        // The source prompt ignores keys entirely, so both Escape rungs must have
        // been spent and found wanting before the trigger was collapsed.
        assert.deepEqual(s.rungs, ['escape@focus', 'escape@owner', 'collapse@owner']);
    });

    test('an ownerless list that ignores keys goes down to the outside click', async () => {
        // Nothing to Escape at and nothing to collapse — the orphan's field is
        // gone. This is the rung with no live Workday measurement behind it,
        // which is exactly why it is worth a test of its own.
        page.wedgeOpenList(5, { outsideClick: true });
        const s = await popups.sweep({ sleep, why: 'test', budgetMs: 800 });

        assert.ok(s.clear, `not cleared: ${brief(s)}`);
        assert.deepEqual(s.rungs, ['escape@focus', 'escape@owner', 'click@outside']);
    });

    test('a stuck list is reported, never ripped out of the page', async () => {
        const wedged = page.wedgeOpenList(4);
        const s = await popups.sweep({ sleep, why: 'test', budgetMs: 400 });

        assert.equal(s.clear, false);
        assert.equal(s.after.orphans, 4);
        // v2 does not delete DOM it does not own — the node is still there, and
        // the caller is told so instead of being handed a page we vandalised.
        assert.ok(dom.document.contains(wedged));
    });

    test('opening a widget under someone else\'s list is refused, not attempted', async () => {
        page.wedgeOpenList(3);
        const r = await popups.openList(page.fields.degree.trigger, { sleep, label: 'Degree', sweepMs: 400 });

        assert.equal(r.ok, false);
        assert.equal(r.result, RESULT.BLOCKED_BY_POPUP);
        assert.equal(page.fields.degree.trigger.clickCount, 0, 'the trigger must not be clicked while blocked');
    });

    test('a trigger is scrolled into view before it is clicked', async () => {
        // A click aimed below the fold hit-tests as whatever covers that point —
        // the measured cause of "Add clicked, no row appeared".
        const r = await popups.openList(page.fields.degree.trigger, { sleep, label: 'Degree' });
        assert.ok(r.ok);
        assert.ok(page.fields.degree.trigger.scrollIntoViewCount > 0);
        await r.lease.close();
    });
});

// ── the scheduler ────────────────────────────────────────────────────────

describe('one task at a time, and one owner of the page', () => {
    test('an interaction failure retries cheaply; a semantic one does not retry at all', async () => {
        const blocked = { id: 'blocked', runs: 0, run() { this.runs += 1; return RESULT.BLOCKED_BY_POPUP; } };
        const missing = { id: 'missing', runs: 0, run() { this.runs += 1; return RESULT.OPTION_NOT_FOUND; } };

        const ledger = await scheduler.runSequential([blocked, missing], { sleep, interactionAttempts: 2 });
        const [b, m] = ledger.tasks;

        assert.equal(b.result, RESULT.BLOCKED_BY_POPUP);
        assert.equal(b.interaction, 2, 'a blocked open should spend the interaction budget');
        assert.equal(blocked.runs, 3, 'and should be retried, not escalated');

        // OPTION_NOT_FOUND is about the VALUE. Retrying it re-reads the same
        // catalogue for the same answer — 9-11 seconds of model time per pass,
        // measured on Degree, for a verdict that cannot change.
        assert.equal(m.result, RESULT.OPTION_NOT_FOUND);
        assert.equal(m.interaction, 0);
        assert.equal(missing.runs, 1);
    });

    test('the run halts rather than opening the next widget under a stray list', async () => {
        page.wedgeOpenList(3);
        const second = { id: 'never', runs: 0, run() { this.runs += 1; return RESULT.COMMITTED; } };

        const ledger = await scheduler.runSequential(
            [{ id: 'first', run: () => RESULT.COMMITTED }, second],
            { sleep, interactionAttempts: 0, sweepMs: 300 },
        );

        assert.equal(ledger.ok, false);
        assert.match(ledger.halted, /could not be cleared/);
        assert.equal(second.runs, 0, 'the next task must not start on a page we cannot clear');
    });

    test('tasks never overlap: a second run on a held page is refused', async () => {
        let inFlight = 0;
        let overlapped = false;
        const slow = (id) => ({
            id,
            async run() {
                inFlight += 1;
                if (inFlight > 1) overlapped = true;
                await sleep(20);
                inFlight -= 1;
                return RESULT.COMMITTED;
            },
        });

        const [a, b] = await Promise.all([
            scheduler.runSequential([slow('a1'), slow('a2')], { sleep }),
            scheduler.runSequential([slow('b1')], { sleep }),
        ]);

        assert.equal(overlapped, false);
        assert.ok(a.busy || b.busy, 'one of the two runs must have been refused');
        assert.equal((a.tasks.length ? a : b).tasks.length, 2);
    });

    test('a fill already running under v1 owns the page, and v2 stands down', async () => {
        // Same lock key as v1 on purpose: this is the mechanism behind "either
        // v1 or v2 owns the page, never both".
        globalThis.window[PAGE_LOCK] = { at: Date.now() };
        const ran = { id: 'x', runs: 0, run() { this.runs += 1; return RESULT.COMMITTED; } };

        const ledger = await scheduler.runSequential([ran], { sleep });
        assert.equal(ledger.busy, true);
        assert.equal(ran.runs, 0);
    });

    test('a lock left behind by a dead pass is taken over, and released after', async () => {
        globalThis.window[PAGE_LOCK] = { at: Date.now() - 200000 };   // past LOCK_STALE_MS
        const ledger = await scheduler.runSequential([{ id: 'x', run: () => RESULT.COMMITTED }], { sleep });

        assert.equal(ledger.busy, false);
        assert.equal(globalThis.window[PAGE_LOCK], null, 'the page must be handed back');
    });

    test('every sweep is on the record', async () => {
        await scheduler.runSequential([{ id: 'x', run: () => RESULT.COMMITTED }], { sleep });
        assert.ok(logged.some((l) => l.includes('mdlz.sched.task')));
        assert.ok(logged.some((l) => l.includes('mdlz.sched.done')));
    });
});
