/**
 * Filling one field: is it already right, how is it written, and how do we KNOW.
 *
 * Every capability here answers those three questions separately, and the third
 * one is the reason the file exists. v1's two failure modes were both verdicts,
 * not fills:
 *
 *   · IT REPORTED FAILED FOR A FIELD THAT WAS CORRECT — a committed date reads
 *     `.value === ""` while aria-valuenow carries the number, so every date the
 *     picker had just written came back "not committed".
 *   · IT REPORTED DONE FOR A FIELD THAT WAS EMPTY — a value painted into a
 *     React-controlled input survives in `.value` until the next render hands
 *     the old one back, and a verifier that read it immediately never saw the
 *     revert.
 *
 * So each widget declares its own commit signal, none of them is `.value` alone,
 * and every verify RE-READS the node (Workday replaces it) and then waits long
 * enough to catch a value that does not stick.
 *
 * What no capability does: guess. An option list that offers three plausible
 * rows for one term returns AMBIGUOUS and stops — putting a skill the candidate
 * never claimed onto a real application is worse than leaving a field empty.
 */

import { MONTHS, MONTH_LABEL, RESULT, SEL } from './config.js';
import { WIDGET, triggerOf } from './fingerprint.js';
import { errorsIn } from './row.js';
import { visibleMonthCells, visiblePanels } from './page-observer.js';
import { withList } from './popup-manager.js';
import { trace } from '../trace.js';

const napper = (sleep) => sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
const txt = (el) => (el?.textContent || '').trim();
const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isPlaceholder = (s) => /^select one$/i.test(String(s || '').trim());

/** Poll a condition to a deadline. Cheap, and never a fixed sleep. */
async function until(fn, { sleep, budgetMs = 1200, pollMs = 60 } = {}) {
    const nap = napper(sleep);
    const by = Date.now() + budgetMs;
    for (;;) {
        if (fn()) return true;
        if (Date.now() >= by) return false;
        await nap(pollMs);
    }
}

/**
 * Write into a React-controlled input the way the page's own code would.
 *
 * The prototype setter is what React's change tracker listens through; a plain
 * assignment can be swallowed whole. Falls back when there is no prototype
 * descriptor to borrow.
 */
export function setNativeValue(el, value) {
    try {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
    } catch { try { el.value = value; } catch { /* the control refuses; verify will say so */ } }
    for (const type of ['input', 'change']) {
        try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch { /* noop */ }
    }
}

/**
 * Choose one option, or choose none.
 *
 * Exact wins outright. A single distinct row containing the term is taken — that
 * is what a search field is for. Several different rows containing it is
 * AMBIGUOUS, because "SQL" offering SQL Server, MySQL and PL/SQL is three
 * answers the candidate never gave.
 */
export function chooseOption(options, want) {
    const rows = options.map((o) => ({ node: o, text: txt(o) })).filter((r) => r.text);
    const w = fold(want);
    if (!w) return { option: null, why: RESULT.OPTION_NOT_FOUND };
    const exact = rows.filter((r) => fold(r.text) === w);
    if (exact.length) return { option: exact[0].node, matched: exact[0].text };
    const partial = rows.filter((r) => fold(r.text).includes(w));
    const distinct = [...new Set(partial.map((r) => fold(r.text)))];
    if (distinct.length === 1) return { option: partial[0].node, matched: partial[0].text };
    if (distinct.length > 1) return { option: null, why: RESULT.AMBIGUOUS, saw: distinct.slice(0, 4) };
    return { option: null, why: RESULT.OPTION_NOT_FOUND };
}

/** The row a field sits in, if the caller gave us one — errors live there. */
const rowClean = (ctx) => !ctx?.row || errorsIn(ctx.row).length === 0;

// ── the capabilities ─────────────────────────────────────────────────────

const text = {
    /** Idempotent: a box that already says it is not typed into again. */
    satisfied: (f, want) => fold(f.controls().text?.value || f.controls().textarea?.value) === fold(want),
    async commit(f, want) {
        const c = f.controls();
        const el = c.text || c.textarea;
        if (!el) return { result: RESULT.WAITING_HYDRATION, reason: 'no control yet' };
        try { el.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        el.focus?.();
        setNativeValue(el, String(want));
        return { result: RESULT.COMMITTED };
    },
    /**
     * Read it, then read it AGAIN after the page has had a chance to change its
     * mind. The second read is the whole verify: the measured failure is a value
     * that is there and then is not.
     */
    async verify(f, want, ctx = {}) {
        const now = () => {
            const c = f.controls();
            return fold((c.text || c.textarea)?.value);
        };
        const landed = await until(() => now() === fold(want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!landed) return { result: RESULT.COMMIT_FAILED, reason: `value never read back (${now() || 'empty'})` };

        // Then WATCH it, on the wall clock rather than for one nap: the failure
        // being caught is a value that is there and then is not, and a verifier
        // whose watch shrinks with the caller's sleep would miss exactly that.
        const nap = napper(ctx.sleep);
        const watchUntil = Date.now() + (ctx.stableMs || 250);
        while (Date.now() < watchUntil) {
            await nap(40);
            if (now() !== fold(want)) return { result: RESULT.COMMIT_FAILED, reason: 'value did not stick' };
        }
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

const checkbox = {
    satisfied: (f, want) => !!f.controls().checkbox?.checked === !!want,
    async commit(f) {
        const box = f.controls().checkbox;
        if (!box) return { result: RESULT.WAITING_HYDRATION, reason: 'no box yet' };
        // Below the fold, a click hit-tests as whatever covers that point.
        try { box.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        box.click();
        return { result: RESULT.COMMITTED };
    },
    /**
     * Checked is not enough. Measured on the language rows: Workday swallows a
     * tick during re-hydration and leaves the row's error standing, so the state
     * says yes while the form says no.
     */
    async verify(f, want, ctx = {}) {
        const ok = await until(() => !!f.controls().checkbox?.checked === !!want,
            { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: 'tick did not take' };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

const listbox = {
    satisfied(f, want) {
        const c = f.controls();
        const shown = txt(c.button) || c.text?.value || '';
        return !isPlaceholder(shown) && fold(shown) === fold(want);
    },
    async commit(f, want, ctx = {}) {
        const trigger = triggerOf(f);
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };
        let picked = null;
        const r = await withList(trigger, async (lease) => {
            const choice = chooseOption(lease.options(), want);
            if (!choice.option) return { result: choice.why, saw: choice.saw };
            picked = choice.matched;
            choice.option.click();
            return { result: RESULT.COMMITTED };
        }, { sleep: ctx.sleep, label: f.name });
        if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
        return { ...r.value, picked };
    },
    async verify(f, want, ctx = {}) {
        const shown = () => {
            const c = f.controls();
            return txt(c.button) || c.chips.map(txt).join(' | ') || c.text?.value || '';
        };
        const ok = await until(() => !isPlaceholder(shown()) && fold(shown()).includes(fold(want)),
            { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: `field still reads "${shown() || 'Select One'}"` };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

const searchMulti = {
    /**
     * Chips are the truth, and they are also somebody's data.
     *
     * A chip already on the page may be the candidate's own from another
     * application, so nothing here removes one. And re-typing eight terms to
     * re-learn "already there" cost 39-44 seconds a pass, which is what this
     * check buys back.
     */
    satisfied(f, want) {
        const have = new Set(f.controls().chips.map((c) => fold(txt(c))));
        return [...want].every((w) => have.has(fold(w)));
    },
    async commit(f, want, ctx = {}) {
        const missing = [...want].filter((w) => !this.satisfied(f, [w]));
        const added = [];
        for (const term of missing) {
            const trigger = triggerOf(f);
            if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
            // For a search prompt the ACTIVATION is the typing: opening it with a
            // bare click shows a catalogue, and the whole point of this widget is
            // that the employer's taxonomy is too long to be one.
            const activate = (t) => {
                t.focus?.();
                setNativeValue(t, term);
                try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
                catch { /* a box that answers to typing alone has already opened */ }
            };
            const r = await withList(trigger, async (lease) => {
                const choice = chooseOption(lease.options(), term);
                if (!choice.option) return { result: choice.why, term, saw: choice.saw };
                // Re-read by LABEL and click that, never the node found a moment
                // ago: the virtualiser recycles row nodes, and the measured cost
                // was chips for "Agentforce" and "Agile Systems" nobody asked for.
                const again = chooseOption(lease.options(), choice.matched);
                if (!again.option) return { result: RESULT.OPEN_TIMEOUT, term, reason: 'the row moved under us' };
                again.option.click();
                added.push(choice.matched);
                return { result: RESULT.COMMITTED, term };
            }, { sleep: ctx.sleep, label: `${f.name}:${term}`, activate });
            if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason, term };
            if (r.value?.result !== RESULT.COMMITTED) return { ...r.value };
        }
        return { result: RESULT.COMMITTED, added };
    },
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
        if (!ok) {
            const have = f.controls().chips.map((c) => txt(c));
            return { result: RESULT.COMMIT_FAILED, reason: `chips read ${have.join(' | ') || '(none)'}` };
        }
        return { result: RESULT.COMMITTED };
    },
};

const date = {
    read(f) {
        const c = f.controls();
        const n = (el) => Number(el?.getAttribute('aria-valuenow'));
        return { month: n(c.month), year: n(c.year) };
    },
    satisfied(f, want) {
        const now = this.read(f);
        return now.month === want.month && now.year === want.year;
    },
    /**
     * The picker, and only the picker.
     *
     * Synthetic typing into a date section writes NOTHING — value stays "",
     * aria-valuenow stays null — and CDP insertText does not write either. Every
     * "date filled" in a v1 trace was Workday's own résumé parse. So there is no
     * typing rung here to fall back to, on purpose.
     */
    async commit(f, want, ctx = {}) {
        const icon = f.controls().icon;
        if (!icon) return { result: RESULT.WAITING_HYDRATION, reason: 'no calendar icon yet' };
        try { icon.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        icon.click();

        const cells = () => visibleMonthCells().map((c) => {
            const m = MONTH_LABEL.exec((c.getAttribute('aria-label') || '').trim());
            return m ? { node: c, month: MONTHS.indexOf(m[1]) + 1, year: Number(m[2]) } : null;
        }).filter(Boolean);

        if (!await until(() => cells().length > 0, { sleep: ctx.sleep, budgetMs: ctx.openMs || 4000 })) {
            return { result: RESULT.OPEN_TIMEOUT, reason: 'the picker did not open' };
        }

        // Walk the year with the panel's own arrows, re-reading the panel each
        // step — the year is shown by the cells, and the cells are replaced.
        for (let step = 0; step < 80; step++) {
            const shown = cells()[0]?.year;
            if (shown === want.year) break;
            // The arrows live in the panel that holds the cells, and that panel
            // is re-read every step — never the one we saw before the click.
            const panel = visiblePanels()[0];
            const arrow = panel?.querySelector(shown > want.year ? SEL.yearBack : SEL.yearForward);
            if (!arrow) return { result: RESULT.COMMIT_FAILED, reason: `no year arrow (showing ${shown})` };
            arrow.click();
            await until(() => cells()[0]?.year !== shown, { sleep: ctx.sleep, budgetMs: 600 });
        }

        const cell = cells().find((c) => c.month === want.month && c.year === want.year);
        if (!cell) return { result: RESULT.OPTION_NOT_FOUND, reason: `${MONTHS[want.month - 1]} ${want.year} not on the panel` };
        cell.node.click();
        return { result: RESULT.COMMITTED };
    },
    /**
     * aria-valuenow, NEVER .value. A committed date reads `.value === ""`, so a
     * verifier that trusts .value calls every correct date a failure — which it
     * did, for a whole run.
     */
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
        if (!ok) {
            const now = this.read(f);
            return { result: RESULT.COMMIT_FAILED, reason: `aria-valuenow reads ${now.month || '—'}/${now.year || '—'}` };
        }
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

export const CAPABILITY = {
    [WIDGET.TEXT]: text,
    [WIDGET.TEXTAREA]: text,
    [WIDGET.CHECKBOX]: checkbox,
    [WIDGET.LISTBOX]: listbox,
    [WIDGET.SEARCH_MULTI]: searchMulti,
    [WIDGET.DATE]: date,
};

/** What each verify actually reads, spelled out for the trace. */
const SIGNAL = {
    [WIDGET.DATE]: 'aria-valuenow',
    [WIDGET.SEARCH_MULTI]: 'chips',
    [WIDGET.LISTBOX]: 'button text',
    [WIDGET.CHECKBOX]: 'checked + no row error',
    [WIDGET.TEXT]: 'value that stuck + no row error',
    [WIDGET.TEXTAREA]: 'value that stuck + no row error',
};

/**
 * Fill one field: skip it if it is already right, write it, then prove it.
 *
 * The three answers stay separate all the way out. An interaction failure never
 * becomes a semantic one, a satisfied field never spends a click, and a commit
 * is only ever reported by the widget's own signal.
 */
export async function runField(f, want, ctx = {}) {
    const cap = CAPABILITY[f.kind];
    if (!cap) {
        // No handler is not a licence to improvise on a real application.
        trace('mdlz.field.unknown', { field: f.name, label: f.label });
        return { result: RESULT.USER_REQUIRED, reason: `no capability for a ${f.kind} widget` };
    }
    if (!f.present()) return { result: RESULT.WAITING_HYDRATION, reason: 'field not on the page' };

    if (cap.satisfied(f, want)) {
        trace('mdlz.field.satisfied', { field: f.name, kind: f.kind });
        return { result: RESULT.SATISFIED };
    }

    const wrote = await cap.commit(f, want, ctx);
    if (wrote.result !== RESULT.COMMITTED) {
        trace('mdlz.field.commit', { field: f.name, kind: f.kind, result: wrote.result, reason: wrote.reason || '' });
        return wrote;
    }

    const proof = await cap.verify(f, want, ctx);
    trace('mdlz.field.verify', {
        field: f.name, kind: f.kind, result: proof.result, reason: proof.reason || '',
        signal: SIGNAL[f.kind] || 'n/a',
    });
    return { ...proof, picked: wrote.picked, added: wrote.added };
}
