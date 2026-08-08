/**
 * One list open at a time, and it belongs to whoever asked for it.
 *
 * WHY THIS EXISTS, in one measurement: clicking Degree found 39 options on the
 * page, 20 of which were Skills' — a list nobody had closed. The field then
 * reported "did not open", the calendar before it reported the same, and both
 * verdicts were about a widget that was working. On HSE Specialist R-173159 the
 * same shape ate four drill levels of Province or City, plus the search rung and
 * the keyboard rung, while that field's real popup had never been open at all.
 *
 * The reason a stray is indistinguishable from our own list is structural, not
 * accidental: Workday PORTALS every prompt's option list to the document root,
 * so it has no formField ancestor to disown it by. Ownership therefore cannot be
 * read off a leftover — it can only be ESTABLISHED, and there is exactly one way
 * to establish it: clear the page first, then attribute the one list that
 * appears to the click that made it appear.
 *
 * So this module offers two things and no third: a sweep that is VERIFIED (a
 * close that lands 550ms later has fooled a verifier before), and a lease that
 * cannot leak — `withList` closes in a `finally`, because "every field closes
 * its own popup" is a rule the crashing field never gets to obey.
 *
 * What it will not do: remove a node. Ripping a list out of the DOM would be a
 * write into state React still owns, to fix a problem whose whole cost is that
 * we cannot see past it. A page that refuses every rung is reported BLOCKED and
 * handed back, not forced.
 */

import { RESULT } from './config.js';
import { openPopups, orphanOptionCount, vis, visibleLists, visibleOptions } from './page-observer.js';
import { trace } from '../trace.js';

const napper = (sleep) => sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

/** What is open right now, and how much of it is nobody's. */
export function census() {
    const popups = openPopups();
    const lists = visibleLists();
    return {
        expanded: popups.length,
        lists: lists.length,
        orphans: orphanOptionCount(),
        options: visibleOptions().length,
        owners: popups.map((p) => p.ownerField || '(portal)'),
        popups,
        listNodes: lists,
    };
}

/**
 * Clear = no choices on screen that the next widget could mistake for its own.
 *
 * Deliberately not "no popups": a chip list is not a popup, and an expanded
 * trigger over an empty list blocks nothing.
 */
export function isClear(c) {
    const s = c || census();
    return s.orphans === 0 && s.lists === 0;
}

// ── The rungs ────────────────────────────────────────────────────────────

/** Escape exactly as v1 sends it — the shape measured to close a Workday prompt. */
function escapeAt(el) {
    if (!el) return;
    for (const type of ['keydown', 'keyup']) {
        try {
            el.dispatchEvent(new KeyboardEvent(type, {
                key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                bubbles: true, cancelable: true, composed: true,
            }));
        } catch { /* a target that cannot take an event is not the one holding the list */ }
    }
}

const fire = (el, type, Ctor) => {
    try { el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true })); }
    catch { /* best effort, by design — the verify below is what decides */ }
};

/**
 * The ladder, cheapest and most specific first.
 *
 * Each rung is followed by a verified wait, so a rung only "worked" if the
 * census says so afterwards. The order is not taste: Escape at the focused
 * element is what a user does and what v1 measured working; an outside click is
 * last because it is the least specific thing on the list and the only rung with
 * no live measurement behind it.
 */
const RUNGS = [
    {
        name: 'escape@focus',
        applies: () => true,
        run: () => {
            const at = (typeof document !== 'undefined' && document.activeElement
                && document.activeElement !== document.body)
                ? document.activeElement : (document.body || null);
            escapeAt(at);
        },
    },
    {
        // Focus is not reliably inside the list that is stuck. After a
        // re-render it is commonly on the body, and a handler scoped to the
        // widget's own subtree never hears an Escape aimed there — so aim at
        // the trigger AND at the list, for every one that is open.
        name: 'escape@owner',
        applies: (c) => c.popups.length > 0 || c.listNodes.length > 0,
        run: (c) => {
            for (const p of c.popups) { escapeAt(p.trigger); escapeAt(p.listbox); }
            for (const l of c.listNodes) escapeAt(l);
        },
    },
    {
        // A trigger that says aria-expanded is a trigger whose click collapses
        // it, and a search box gives its list up when it loses focus (measured
        // on SmartRecruiters, where a trailing blur closed the list before a
        // pick could commit — the same reflex, used on purpose here).
        //
        // The scroll is not optional: a click aimed below the fold hit-tests as
        // whatever covers that point, which is what "Add clicked, no row
        // appeared" was.
        name: 'collapse@owner',
        applies: (c) => c.popups.length > 0,
        run: (c) => {
            for (const p of c.popups) {
                const t = p.trigger;
                if (!t) continue;
                try { t.scrollIntoView?.({ block: 'center' }); } catch { /* no layout, no scroll */ }
                if (t.tagName === 'INPUT') { try { t.blur?.(); } catch { /* noop */ } continue; }
                try { t.click?.(); } catch { /* noop */ }
            }
        },
    },
    {
        // What a user does when a list will not take a key: click somewhere
        // else. Dispatched ON the body, so it cannot hit-test into a link or a
        // Delete charm — and last, because unlike the rungs above it has never
        // been measured against a live Workday prompt.
        name: 'click@outside',
        applies: () => true,
        run: () => {
            const body = typeof document !== 'undefined' ? document.body : null;
            if (!body) return;
            const Mouse = typeof MouseEvent !== 'undefined' ? MouseEvent : Event;
            const Pointer = typeof PointerEvent !== 'undefined' ? PointerEvent : Mouse;
            fire(body, 'pointerdown', Pointer);
            fire(body, 'mousedown', Mouse);
            fire(body, 'mouseup', Mouse);
            fire(body, 'click', Mouse);
        },
    },
];

/**
 * Close everything the page has left open, and prove it closed.
 *
 * Returns which rungs were spent, which is the number worth watching: a page
 * that needs rung 3 every time is telling us something about the widget that
 * a boolean "cleared" would hide.
 */
export async function sweep({ sleep, why = '', budgetMs = 2400, pollMs = 60 } = {}) {
    const nap = napper(sleep);
    const before = census();
    if (isClear(before)) return { clear: true, rungs: [], before, after: before, ms: 0 };

    const t0 = Date.now();
    const spent = [];
    for (const rung of RUNGS) {
        const now = census();
        if (isClear(now)) break;
        if (!rung.applies(now)) continue;
        spent.push(rung.name);
        try { rung.run(now); } catch { /* a rung that throws is a rung that did not work */ }

        // Verify, don't assume. A close was measured landing ~550ms after the
        // click that caused it, which is exactly long enough for an unverified
        // sweep to report a clear page over an open list — and short enough that
        // a rung judged any sooner gets blamed for a close that was on its way.
        //
        // Every rung gets that same window, not a share of what is left: giving
        // the first one half the budget bought 1.2s of waiting on a list it was
        // never going to close. The default budget is the four rungs at 600ms.
        const slice = Math.min(600, Math.max(40, Math.floor(budgetMs / RUNGS.length)));
        const by = Date.now() + slice;
        while (Date.now() < by && !isClear()) await nap(pollMs);
        if (isClear() || Date.now() - t0 >= budgetMs) break;
    }

    const after = census();
    const clear = isClear(after);
    trace('mdlz.popup.sweep', {
        why,
        clear,
        rungs: spent.join('→') || '(none)',
        orphansBefore: before.orphans,
        orphansAfter: after.orphans,
        listsAfter: after.lists,
        owners: before.owners.join(',') || '(portal)',
        ms: Date.now() - t0,
    });
    return { clear, rungs: spent, before, after, ms: Date.now() - t0 };
}

// ── Leases ───────────────────────────────────────────────────────────────

/** The node id is the only handle that survives a re-render; the node may not. */
function relist(node) {
    if (!node) return null;
    try {
        const byId = node.id ? document.getElementById(node.id) : null;
        const live = byId || node;
        return document.contains?.(live) === false ? null : live;
    } catch { return node; }
}

/**
 * Open `trigger`'s list and hand back a lease over the options that are OURS.
 *
 * The clear-first step is not hygiene, it is what makes the word "ours" mean
 * anything: on a page swept clean, the list that appears after our click is the
 * one our click opened. Where Workday stamps the trigger with
 * aria-controls/aria-owns we prefer that, because it survives a second list
 * opening underneath us.
 */
export async function openList(trigger, {
    sleep, label = '', openMs = 6500, sweepMs = 2400, activate,
} = {}) {
    const nap = napper(sleep);
    if (!trigger) return { ok: false, result: RESULT.OPEN_TIMEOUT, reason: 'no trigger', label };

    const pre = await sweep({ sleep, why: `open:${label}`, budgetMs: sweepMs });
    if (!pre.clear) {
        trace('mdlz.popup.blocked', { field: label, orphans: pre.after.orphans, rungs: pre.rungs.join('→') });
        return {
            ok: false, result: RESULT.BLOCKED_BY_POPUP, label,
            reason: `${pre.after.orphans} option(s) from ${pre.before.owners.join(',') || 'a portal'} would not close`,
        };
    }

    const before = new Set(visibleLists());
    try { trigger.scrollIntoView?.({ block: 'center' }); } catch { /* no layout in a test DOM */ }
    // The click is injectable so the executor layer can route it through the
    // policy gate (v1 spends `activation: 'widget-open'` here) without this
    // module having to know what a policy is.
    try {
        if (activate) activate(trigger);
        else { trigger.focus?.(); trigger.click?.(); }
    } catch (e) {
        return { ok: false, result: RESULT.OPEN_TIMEOUT, label, reason: `activate threw: ${e?.message || e}` };
    }

    const ownId = trigger.getAttribute?.('aria-controls') || trigger.getAttribute?.('aria-owns') || null;
    const mine = () => {
        const owned = ownId ? document.getElementById(ownId) : null;
        if (owned && vis(owned) && visibleOptions(owned).length) return [owned];
        return visibleLists().filter((l) => !before.has(l));
    };

    const deadline = Date.now() + openMs;
    let found = mine();
    while (!found.length && Date.now() < deadline) {
        await nap(120);
        found = mine();
    }

    if (!found.length) {
        trace('mdlz.popup.openTimeout', {
            field: label,
            trigger: `${trigger.tagName || '?'}${trigger.getAttribute?.('aria-haspopup') ? '[haspopup]' : ''}`,
            optionsOnPage: visibleOptions().length,
            note: 'the widget did not open — the page was clear when we clicked',
        });
        return { ok: false, result: RESULT.OPEN_TIMEOUT, label, reason: 'no list appeared' };
    }
    if (found.length > 1) {
        // Two lists over a page that was clear a moment ago: something other
        // than us is driving this document. Retryable, never guessable — taking
        // one at random is how a field commits another field's answer.
        trace('mdlz.popup.ambiguousOpen', { field: label, lists: found.length });
        return {
            ok: false, result: RESULT.BLOCKED_BY_POPUP, label,
            reason: `${found.length} lists opened for one click`,
        };
    }

    const node = found[0];
    const lease = {
        label,
        trigger,
        listbox: () => relist(node),
        /** Re-read on every call: the virtualiser recycles row nodes, so a held
         *  option reference can already mean a different option. */
        options: () => visibleOptions(relist(node) || node),
        alive: () => {
            const live = relist(node);
            return !!(live && vis(live));
        },
        close: async () => {
            escapeAt(trigger);
            escapeAt(node);
            const by = Date.now() + 900;
            while (Date.now() < by && !isClear()) await nap(60);
            if (isClear()) return { clear: true, swept: false };
            const s = await sweep({ sleep, why: `close:${label}`, budgetMs: sweepMs });
            return { clear: s.clear, swept: true, rungs: s.rungs };
        },
    };
    trace('mdlz.popup.open', { field: label, options: lease.options().length, owned: !!ownId });
    return { ok: true, result: RESULT.COMMITTED, lease, label };
}

/**
 * Do something with a list, and leave the page as clean as it was found.
 *
 * The `finally` is the whole point. Every field in v1 was supposed to close its
 * own popup on the way out, and the ones that threw mid-widget never got the
 * chance — measured: a crash in Skills left a list that covered Degree a pass
 * later. A rule that only holds when nothing goes wrong is not a rule.
 */
export async function withList(trigger, fn, opts = {}) {
    const opened = await openList(trigger, opts);
    if (!opened.ok) return opened;
    let value;
    let threw = null;
    try {
        value = await fn(opened.lease);
    } catch (e) {
        threw = e;
    }
    const closed = await opened.lease.close();
    if (threw) {
        return { ok: false, result: RESULT.COMMIT_FAILED, label: opened.label, closed, reason: threw?.message || String(threw) };
    }
    return { ok: true, value, closed, label: opened.label, leaked: !closed.clear };
}

/**
 * The guard a step runs before it touches anything: make the page clear, or say
 * why it could not.
 */
export async function ensureClear(opts = {}) {
    const s = await sweep(opts);
    return s.clear ? { ok: true, sweep: s } : { ok: false, result: RESULT.BLOCKED_BY_POPUP, sweep: s };
}
