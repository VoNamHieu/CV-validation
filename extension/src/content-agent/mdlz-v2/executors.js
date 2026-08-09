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

import { MONTHS, MONTH_LABEL, RESULT, SEL, SEMANTIC } from './config.js';
import { WIDGET, triggerOf } from './fingerprint.js';
import { errorsIn, rowsOf } from './row.js';
import { visibleMonthCells, visibleOptions, visiblePanels } from './page-observer.js';
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
/**
 * Rows a list renders that are not choices.
 *
 * MEASURED on Skills (R-174102): an empty catalogue answers "No Items." — as
 * THREE nested nodes (menuItem / promptLeafNode / promptOption) that all answer
 * the option selector. They are counted as options on purpose, so the list still
 * registers as OPEN and the field reports a semantic refusal rather than a
 * timeout; but they are never something a click may land on.
 */
const NOT_A_CHOICE = /^(select one|no items\.?)$/i;

export function chooseOption(options, want) {
    const all = options.map((o) => ({ node: o, text: txt(o) })).filter((r) => r.text);
    // Placeholders are counted in the evidence and excluded from the choosing.
    const rows = all.filter((r) => !NOT_A_CHOICE.test(r.text));
    const w = fold(want);
    // EVERY refusal carries its evidence. A live run came back
    // `OPTION_NOT_FOUND, reason: ""` about a list of 249 countries, and there
    // was no way to tell from it what had been wanted, what was on the list, or
    // why 249 rows held no match — so the cause had to be guessed at. v1 logs
    // tried/shown/sample for exactly this; this returns the same.
    const evidence = { want: String(want ?? ''), shown: all.length, sample: all.slice(0, 4).map((r) => r.text) };
    if (!w) return { option: null, why: RESULT.OPTION_NOT_FOUND, ...evidence };
    const exact = rows.filter((r) => fold(r.text) === w);
    if (exact.length) return { option: exact[0].node, matched: exact[0].text };
    const partial = rows.filter((r) => fold(r.text).includes(w));
    const distinct = [...new Set(partial.map((r) => fold(r.text)))];
    if (distinct.length === 1) return { option: partial[0].node, matched: partial[0].text };
    if (distinct.length > 1) return { option: null, why: RESULT.AMBIGUOUS, ...evidence, saw: distinct.slice(0, 4) };
    return { option: null, why: RESULT.OPTION_NOT_FOUND, ...evidence };
}

/**
 * Walk a ladder of candidate answers against the options a page really offers.
 *
 * The rungs are measured, in order, and the ANCHOR matters: a rung written
 * '=Other' matches exactly or by prefix only, because "other" lives inside
 * "another" and a substring hit on "Another job board" is a wrong claim about
 * how somebody found the job, not a fallback.
 *
 * Nothing is invented: a ladder that ends without a hit returns nothing, and the
 * field is left for the person whose answer it is.
 */
export function chooseFromLadder(options, ladder) {
    const rows = options.map((o) => ({ node: o, text: txt(o) }))
        .filter((r) => r.text && !NOT_A_CHOICE.test(r.text));
    for (const raw of ladder) {
        const anchored = raw.startsWith('=');
        const cand = fold(anchored ? raw.slice(1) : raw);
        const hit = rows.find((r) => fold(r.text) === cand)
            || rows.find((r) => (anchored ? fold(r.text).startsWith(cand) : fold(r.text).includes(cand)));
        if (hit) return { option: hit.node, matched: hit.text, rung: raw };
    }
    return {
        option: null,
        why: RESULT.OPTION_NOT_FOUND,
        want: ladder.slice(0, 3).join(' → '),
        shown: rows.length,
        sample: rows.slice(0, 4).map((r) => r.text),
    };
}

/** The row a field sits in, if the caller gave us one — errors live there. */
const rowClean = (ctx) => !ctx?.row || errorsIn(ctx.row).length === 0;

/**
 * What `after` holds that `before` did not — as a MULTISET, so a second copy of
 * a chip that was already there counts as new. Comparing sets would call a
 * duplicate "nothing happened", which is the one answer it must not give.
 */
export function freshOnes(before, after) {
    const pool = [...before];
    const out = [];
    for (const c of after) {
        const i = pool.indexOf(c);
        if (i >= 0) pool.splice(i, 1);
        else out.push(c);
    }
    return out;
}

/**
 * What this field is showing, in words, for a human reading a report.
 *
 * NOT a commit signal and never used as one: each capability's `verify` stays
 * the only authority on whether something committed. This is for the preflight
 * table, where the useful column is "what is in there right now".
 */
export function readNow(f) {
    const c = f.controls();
    if (f.kind === WIDGET.DATE) {
        const at = (el) => el?.getAttribute('aria-valuenow') || '—';
        return `${at(c.month)}/${at(c.year)}`;
    }
    if (f.kind === WIDGET.SEARCH_MULTI) return c.chips.map(txt).join(' | ') || '(no chips)';
    if (f.kind === WIDGET.CHECKBOX) return c.checkbox?.checked ? 'ticked' : 'unticked';
    if (f.kind === WIDGET.LISTBOX) {
        const shown = txt(c.button) || c.text?.value || '';
        return isPlaceholder(shown) || !shown ? '(Select One)' : shown;
    }
    return (c.text || c.textarea)?.value || '(empty)';
}

// ── the capabilities ─────────────────────────────────────────────────────

const text = {
    /** Idempotent: a box that already says it is not typed into again. */
    satisfied: (f, want) => fold(f.controls().text?.value || f.controls().textarea?.value) === fold(want),
    /**
     * Write it, then LET GO of it — the blur is not politeness, it is the
     * commit.
     *
     * MEASURED (R-174102, 2026-08-09), and it cost a whole run: every text
     * field on My Experience displayed its value, every verify passed, no row
     * showed an error — and Save and Continue came back "The field Job Title is
     * required and must have a value" for three titles that were plainly on the
     * screen. Workday's model had none of them. Blurring each field, changing
     * nothing else, cleared all seven errors: 3 × Job Title, 3 × Company, 1 ×
     * School.
     *
     * So `setNativeValue` paints the box and Workday takes the value on blur.
     * Without it a field is written, verified, and still empty as far as the
     * ATS is concerned — the `valueAsCommitProof` hazard in config.js, arriving
     * from the one direction nothing here was watching.
     */
    async commit(f, want) {
        const c = f.controls();
        const el = c.text || c.textarea;
        if (!el) return { result: RESULT.WAITING_HYDRATION, reason: 'no control yet' };
        try { el.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        el.focus?.();
        setNativeValue(el, String(want));
        // The order is the measurement: focusout is what Workday's own handler
        // listens through, and blur() alone does not bubble to it.
        try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }
        catch { try { el.dispatchEvent(new Event('focusout', { bubbles: true })); } catch { /* noop */ } }
        try { el.blur?.(); } catch { /* the control refuses; verify will say so */ }
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
        // A row error is checked AFTER the field has been let go of, because
        // that is when Workday gets to disagree. Checked before the blur it says
        // nothing at all — which is exactly how seven required-field errors
        // stayed invisible until Save and Continue.
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
            if (!choice.option) {
                return { result: choice.why, saw: choice.saw, want: choice.want, shown: choice.shown, sample: choice.sample };
            }
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
    /**
     * A chip counts when it is the ANSWER to what was asked, which is not always
     * the same string. Measured on countryPhoneCode: the value asked for is
     * "Vietnam" and the committed chip reads "Vietnam (+84)" — the catalogue's
     * own wording. So a chip is matched the way an option is chosen: exactly, or
     * as the single chip that contains it. Two chips containing it is not an
     * answer, it is two.
     */
    satisfied(f, want) {
        const chips = f.controls().chips.map((c) => fold(txt(c)));
        return [...want].every((w) => {
            const t = fold(w);
            if (chips.includes(t)) return true;
            return chips.filter((c) => c.includes(t)).length === 1;
        });
    },
    /** The chips this field is showing right now, as text. */
    chipsNow: (f) => f.controls().chips.map((c) => txt(c)),
    /**
     * The chips that could be this term's answer — read exactly as `satisfied`
     * reads them, or the two would disagree about the same page.
     *
     * An EXACT chip settles it: "Figma" answered by a chip reading "Figma" is
     * one answer, and a "Figma Design" sitting beside it is a different skill,
     * quite possibly the candidate's own. Only when nothing matches exactly do
     * the loose ones count, and then two of them is an ambiguity rather than an
     * answer.
     */
    holding(f, term) {
        const t = fold(term);
        const chips = this.chipsNow(f);
        const exact = chips.filter((c) => fold(c) === t);
        return exact.length ? exact : chips.filter((c) => fold(c).includes(t));
    },
    async commit(f, want, ctx = {}) {
        // A TERM THAT ALREADY HAS A CHIP IS NEVER CLICKED AGAIN — and that is
        // not the same question as "is it satisfied".
        //
        // `satisfied` is strict: two chips containing one term is not an answer,
        // it is two, so it reports false. Driving the click list off it meant a
        // term with two chips read as MISSING on every pass and was picked
        // again, and again — one more chip each time. That is the row-growth
        // shape, in chips, and it is why this asks a different question: does
        // the page already hold anything for this term?
        const already = [...want].filter((w) => this.holding(f, w).length > 1);
        if (already.length) {
            // Over-answered. Semantic, so it is remembered and never repeated;
            // nothing here removes a chip, because a chip may be the
            // candidate's own.
            return {
                result: RESULT.AMBIGUOUS,
                reason: `"${already[0]}" already has ${this.holding(f, already[0]).length} chips`,
                saw: this.holding(f, already[0]).slice(0, 4),
            };
        }
        const missing = [...want].filter((w) => this.holding(f, w).length === 0);
        const added = [];
        for (const term of missing) {
            const trigger = triggerOf(f);
            if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
            // THE CLICK OPENS IT, THE TYPING FILTERS IT — two acts, and this
            // used to do only the second.
            //
            // MEASURED on Skills (R-174102, 2026-08-09), by hand on the live
            // widget: focus + a written value opens NOTHING, and that is the
            // whole of the OPEN_TIMEOUT ×3 at ~8 seconds each. A plain click
            // opens the list immediately — `activeListContainer[role=listbox]`,
            // which is exactly what `visibleLists()` looks for — and the value
            // written after it filters what is inside. Enter is not part of it:
            // pressed on a real keyboard it committed nothing.
            //
            // Also measured, and the reason a refusal here is not a defect: this
            // tenant's Skills catalogue answers "No Items." to every term tried,
            // including plain ones like "Sales", typed on a REAL keyboard. So
            // the honest outcome is OPTION_NOT_FOUND — semantic, remembered
            // once, never retried — rather than an interaction failure the
            // scheduler pays for again on every pass.
            //
            // The Enter stays, and is deliberately last. It is what opens a
            // search prompt that answers to typing alone (v1 measured that shape
            // on SmartRecruiters, and the harness models it); on the Mondelez
            // widget above it is inert — pressed on a real keyboard it neither
            // opened, filtered nor committed anything. Two measured shapes, one
            // activation, and neither rung undoes the other.
            const activate = (t) => {
                t.focus?.();
                t.click?.();
                setNativeValue(t, term);
                try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
                catch { /* a box that answers to the click alone is already open */ }
            };
            const r = await withList(trigger, async (lease) => {
                const choice = chooseOption(lease.options(), term);
                if (!choice.option) return { result: choice.why, term, saw: choice.saw };
                // Re-read by LABEL and click that, never the node found a moment
                // ago: the virtualiser recycles row nodes, and the measured cost
                // was chips for "Agentforce" and "Agile Systems" nobody asked for.
                const again = chooseOption(lease.options(), choice.matched);
                if (!again.option) return { result: RESULT.OPEN_TIMEOUT, term, reason: 'the row moved under us' };

                // WHAT THE PAGE GAINED IS THE VERDICT — not what we meant to
                // click. Re-reading by label narrows the window in which the
                // virtualiser can swap a row out from under us; it does not
                // close it, and nothing downstream would ever notice. `added`
                // used to record our INTENTION, and the only check afterwards
                // asked whether the wanted terms had chips — never whether
                // anything else had arrived with them.
                const before = this.chipsNow(f);
                again.option.click();
                await until(() => this.chipsNow(f).length !== before.length,
                    { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
                const fresh = freshOnes(before, this.chipsNow(f));

                if (fresh.length === 0) {
                    // Nothing landed. Nothing was added either, so this is safe
                    // to try again — unlike every branch below it.
                    return { result: RESULT.COMMIT_FAILED, term, reason: 'the click added no chip' };
                }
                if (fresh.length > 1) {
                    // One click, several answers — a parent row, or a group.
                    // Semantic: it will do the same thing next pass.
                    return { result: RESULT.AMBIGUOUS, term, reason: `one click added ${fresh.length} chips`, saw: fresh.slice(0, 4) };
                }
                const got = fold(fresh[0]);
                const meant = fold(choice.matched);
                if (got !== meant && !got.includes(fold(term))) {
                    // A chip arrived that is neither what we picked nor an
                    // answer to what was asked: the row moved under the click.
                    return { result: RESULT.AMBIGUOUS, term, reason: `clicked "${choice.matched}" but got "${fresh[0]}"`, saw: fresh };
                }
                added.push(fresh[0]);
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


/**
 * A radio group — three defects' worth of rules, each already paid for.
 *
 * The recipe had no radio support at all, which is why My Information stalled:
 * Mondelez marks "Have you previously worked for this organization?" REQUIRED
 * and renders it as radios, so eleven fields were filled, that one was left, and
 * the advance is withheld while anything required is empty.
 *
 * What this does NOT do, each learned from a real defect:
 *   · It does not set `.checked`. An earlier version did, dispatched `change`,
 *     and reported success even when the policy had REFUSED the click — a
 *     refusal that silently became a mutation.
 *   · It does not match by substring alone. "No" is inside "Not applicable" and
 *     "None of the above", so an exact label wins first and a substring counts
 *     only when exactly one option has it.
 *   · It does not believe the click. Workday's radios sit under overlays; the
 *     only proof is re-reading `checked` afterwards.
 *
 * And it clicks the LABEL: the input itself is commonly invisible under a
 * styled control, so it is not a thing a click can land on.
 */
const radio = {
    options(f) {
        const wrap = f.find();
        return f.controls().radios.map((r) => {
            const byFor = r.id && wrap ? wrap.querySelector(`label[for="${r.id}"]`) : null;
            const label = byFor || r.closest?.('label') || null;
            return { input: r, label, text: (label?.textContent || '').replace(/\s+/g, ' ').trim() };
        });
    },
    pick(f, want) {
        const rows = this.options(f);
        const w = fold(want);
        const exact = rows.filter((r) => fold(r.text) === w);
        if (exact.length === 1) return exact[0];
        const loose = rows.filter((r) => fold(r.text).includes(w));
        return loose.length === 1 ? loose[0] : null;
    },
    satisfied(f, want) {
        const hit = this.pick(f, want);
        return !!hit && !!hit.input.checked;
    },
    async commit(f, want) {
        const hit = this.pick(f, want);
        if (!hit) {
            const shown = this.options(f).map((r) => r.text).filter(Boolean);
            return shown.length
                ? { result: RESULT.AMBIGUOUS, reason: `no single option matches "${want}"`, saw: shown.slice(0, 4) }
                : { result: RESULT.WAITING_HYDRATION, reason: 'the group has no options yet' };
        }
        const target = hit.label || hit.input;
        try { target.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        target.click();
        return { result: RESULT.COMMITTED };
    },
    async verify(f, want, ctx = {}) {
        // Re-read, always: the click may have been swallowed by whatever was
        // over it, and `checked` is the only thing that knows.
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: 'the click did not select it' };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

/**
 * A searchable single-select — the widget that commits into its own box.
 *
 * Measured on Province or City (R-174262): a search-pick commits FOR REAL — the
 * next pass read the field as done and Workday never objected — but it leaves
 * no chip and no button text, only the value sitting in the input. A verifier
 * looking for a chip records a working click as no-commit.
 *
 * The catch is that the text we TYPED also sits in that input. What separates a
 * commit from our own typing is the popup: it closes on a pick. So the signal
 * is "the input holds the value AND no list is open" — both halves, or neither
 * means anything.
 */
const searchSingle = {
    shown: (f) => String(f.controls().text?.value || '').trim(),
    satisfied(f, want) {
        return fold(this.shown(f)) === fold(want) && visibleOptions().length === 0;
    },
    async commit(f, want, ctx = {}) {
        const trigger = f.controls().text;
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
        let picked = null;
        const r = await withList(trigger, async (lease) => {
            const choice = chooseOption(lease.options(), want);
            if (!choice.option) {
                return { result: choice.why, saw: choice.saw, want: choice.want, shown: choice.shown, sample: choice.sample };
            }
            picked = choice.matched;
            choice.option.click();
            return { result: RESULT.COMMITTED };
        }, {
            sleep: ctx.sleep,
            label: f.name,
            // Typing IS the activation here, exactly as for the chip search.
            activate: (t) => {
                t.focus?.();
                setNativeValue(t, String(want));
                try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
                catch { /* a box that answers to typing alone has already opened */ }
            },
        });
        if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
        return { ...r.value, picked };
    },
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
        if (!ok) {
            return {
                result: RESULT.COMMIT_FAILED,
                reason: `box reads "${this.shown(f) || 'empty'}"${visibleOptions().length ? ' with its list still open' : ''}`,
            };
        }
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

/**
 * A prompt answered by walking a ladder against the options it really offers.
 *
 * ONE lease: the options cannot be read without opening the list, and the rung
 * cannot be chosen without the options. Lives here, beside the capabilities,
 * because two pages now need it — My Information's "How Did You Hear About Us"
 * and My Experience's Degree — and a second copy would be a second answer to
 * "what counts as already answered".
 *
 * ALREADY ANSWERED WINS. A ladder is a DEFAULT: a value already on the page is
 * either what the ATS parsed out of the résumé or what the candidate chose, and
 * both outrank anything we would pick for them.
 */
export async function answerFromLadder(f, ladder, ctx = {}) {
    const shown = readNow(f);
    if (shown && !/^\((select one|no chips|empty)\)$/i.test(shown)) {
        return { result: RESULT.SATISFIED, detail: { picked: shown } };
    }
    const trigger = triggerOf(f);
    if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };

    let rung = null;
    const opened = await withList(trigger, async (lease) => {
        const choice = chooseFromLadder(lease.options(), ladder);
        if (!choice.option) return { result: choice.why, want: choice.want, shown: choice.shown, sample: choice.sample };
        rung = choice.rung;
        choice.option.click();
        return { result: RESULT.COMMITTED, picked: choice.matched };
    }, { sleep: ctx.sleep, label: f.name });

    if (!opened.ok) return { result: opened.result || RESULT.COMMIT_FAILED, reason: opened.reason };
    if (opened.value?.result !== RESULT.COMMITTED) return { ...opened.value };
    const proof = await CAPABILITY[f.kind].verify(f, opened.value.picked, ctx);
    return { ...proof, picked: opened.value.picked, rung };
}

export const CAPABILITY = {
    [WIDGET.TEXT]: text,
    [WIDGET.TEXTAREA]: text,
    [WIDGET.CHECKBOX]: checkbox,
    [WIDGET.LISTBOX]: listbox,
    [WIDGET.SEARCH_MULTI]: searchMulti,
    [WIDGET.DATE]: date,
    [WIDGET.RADIO]: radio,
    [WIDGET.SEARCH_SINGLE]: searchSingle,
};

/**
 * Add a row to a section, and prove one arrived.
 *
 * The commit signal is the row COUNT, read through the same finder the planner
 * uses — not the click returning, and not a fixed wait. "Add clicked, no row
 * appeared" was measured twice, and both times the click had hit-tested into
 * whatever was covering the button because it sat below the fold; so the scroll
 * is part of the action, and a row that never appears is an INTERACTION failure
 * that may be retried, not a semantic one that should reach anybody.
 */
export async function addRow(button, { sleep, anchor, root = null, budgetMs } = {}) {
    const budget = budgetMs || 4000;
    if (!button) return { result: RESULT.USER_REQUIRED, reason: 'no add button for this section' };
    const before = rowsOf(anchor, { root }).length;
    try { button.scrollIntoView?.({ block: 'center' }); } catch { /* no layout in a test DOM */ }
    button.click();
    const grew = await until(() => rowsOf(anchor, { root }).length > before, { sleep, budgetMs: budget });
    trace('mdlz.row.add', { anchor, before, after: rowsOf(anchor, { root }).length, grew });
    return grew
        ? { result: RESULT.COMMITTED, rows: rowsOf(anchor, { root }).length }
        : { result: RESULT.OPEN_TIMEOUT, reason: `the section still has ${before} row(s)` };
}

/**
 * Semantic failures this document has already had, so they happen ONCE.
 *
 * Measured on a live run: Country came back OPTION_NOT_FOUND on a 249-row list,
 * three passes in a row, identically — the same list opened, the same 249 rows
 * read, the same verdict, three times. Nothing about the page or the answer had
 * changed between them, so the second and third attempts could not have gone
 * differently; they were pure cost and pure noise, and they kept a popup opening
 * over a page that was otherwise clean.
 *
 * An INTERACTION failure is worth retrying — the page was busy, a list was in
 * the way. A SEMANTIC one is not: the catalogue does not hold the answer, and it
 * will not hold it next pass either. So it is recorded and reported as a gap
 * until the WANT changes or the page does.
 *
 * On `window`, like every other claim here: two copies of the content script
 * must not each learn this the expensive way.
 */
const REFUSED = '__copoV2Refused';
const refusalKey = (f, want) => `${f.name}::${describeWant(want)}`;

const refusedBefore = (f, want) => {
    try { return !!(win()[REFUSED] || {})[refusalKey(f, want)]; } catch { return false; }
};

const rememberRefusal = (f, want, why) => {
    try {
        const all = win()[REFUSED] || (win()[REFUSED] = {});
        all[refusalKey(f, want)] = { why, at: Date.now() };
    } catch { /* nothing to remember with */ }
};

/** A page change clears them: a new catalogue is a new question. */
export const forgetRefusals = () => { try { win()[REFUSED] = {}; } catch { /* noop */ } };

const win = () => (typeof window !== 'undefined' ? window : globalThis);


/** Widgets whose current value can be read without opening anything. */
const HOLDS_A_VALUE = new Set([
    WIDGET.LISTBOX, WIDGET.SEARCH_SINGLE, WIDGET.SEARCH_MULTI, WIDGET.TEXT, WIDGET.TEXTAREA, WIDGET.DATE,
]);

/** A want, in one short readable string, whatever shape it arrived in. */
const describeWant = (want) => {
    if (want === null || want === undefined) return '—';
    if (Array.isArray(want)) return want.join(' | ').slice(0, 60);
    if (typeof want === 'object') return `${want.month}/${want.year}`;
    return String(want).slice(0, 60);
};

/** What each verify actually reads, spelled out for the trace. */
const SIGNAL = {
    [WIDGET.DATE]: 'aria-valuenow',
    [WIDGET.RADIO]: 'checked, re-read after the click',
    [WIDGET.SEARCH_SINGLE]: 'the value in its own box, with the list closed',
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

    // ASKED AND ANSWERED. The same want, the same field, already refused on this
    // page — re-opening the list cannot produce a different catalogue.
    if (refusedBefore(f, want)) {
        trace('mdlz.field.refusedBefore', { field: f.name, want: describeWant(want) });
        return { result: RESULT.USER_REQUIRED, reason: 'already refused on this page', repeat: true };
    }

    // A DEFAULT NEVER OVERWRITES A VALUE THAT IS ALREADY THERE.
    //
    // Measured on a live run: Country read "Vietnam" on the page while the want
    // was the profile's NATIONALITY ("Vietnamese"), so `satisfied` said no and
    // the field was re-opened — 249 options, OPTION_NOT_FOUND, every pass, on a
    // field that was already correct and required no work at all.
    //
    // The rule generalises past that bug. When our value is an agent default
    // rather than something the candidate stated, a committed field on the page
    // is better evidence than our guess: it is either what the ATS pre-filled or
    // what the candidate chose, and both outrank a default.
    if (ctx.isDefault && HOLDS_A_VALUE.has(f.kind)) {
        const shown = readNow(f);
        const empty = !shown || /^\((select one|no chips|empty)\)$/i.test(shown) || shown === '—/—';
        if (!empty) {
            trace('mdlz.field.keep', { field: f.name, kind: f.kind, keeping: shown, ratherThan: describeWant(want) });
            return { result: RESULT.SATISFIED, detail: { picked: shown, kept: true } };
        }
    }

    const wrote = await cap.commit(f, want, ctx);
    if (wrote.result !== RESULT.COMMITTED) {
        if (SEMANTIC.has(wrote.result)) rememberRefusal(f, want, wrote.result);
        trace('mdlz.field.commit', {
            field: f.name,
            kind: f.kind,
            result: wrote.result,
            reason: wrote.reason || '',
            // The three columns whose absence made a live failure unreadable.
            want: wrote.want ?? describeWant(want),
            shown: wrote.shown ?? '(n/a)',
            sample: (wrote.sample || wrote.saw || []).join(' | ') || '(none)',
        });
        return wrote;
    }

    const proof = await cap.verify(f, want, ctx);
    trace('mdlz.field.verify', {
        field: f.name, kind: f.kind, result: proof.result, reason: proof.reason || '',
        signal: SIGNAL[f.kind] || 'n/a',
    });
    return { ...proof, picked: wrote.picked, added: wrote.added };
}
