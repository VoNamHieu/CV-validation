/**
 * MDLZ v2 — the entry, and the decision to take a page or hand it back.
 *
 * Ownership rule, unchanged since Milestone 0: on a given page instance either
 * v1 or v2 owns the DOM, never both. Two owners writing the same widget, each
 * verifying against state the other had just changed, is the disorder v2 exists
 * to end — so this file's most important job is not filling anything. It is
 * DECLINING clearly: v2 takes a page only when it can finish the step, and
 * anything it cannot finish stays with v1, whole.
 *
 * What it takes, today: My Experience, and only once the résumé is attached
 * (v1 owns the upload, and a pass that filled fields while the parser was still
 * to run would be filling a page about to be re-rendered underneath it).
 *
 * One CALL is one PASS. After a row is added the plan stops for that section and
 * the next pass re-derives it against the page the click produced — a plan that
 * assumes what a click will render is the plan that filled rows which did not
 * exist yet.
 */

import { FLAG_KEY, RESULT, SEL, STEP, isMdlzPage } from './config.js';
import { openPopups, orphanOptionCount, pageFingerprint, waitPageReady } from './page-observer.js';
import { census } from './popup-manager.js';
import { addRow, runField } from './executors.js';
import { fingerprintOf } from './fingerprint.js';
import { SECTIONS, addButtonFor, planStep, resolveRow, resolveTarget } from './planner.js';
import { preflightReport } from './preflight.js';
import { rowsOf } from './row.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';

/**
 * Three settings, not two.
 *
 * `dry` is the one that matters before a first live run: v2 reads the page,
 * says what it would have done, and hands it straight back to v1 — so the first
 * contact with somebody's real application is a measurement and not a write.
 */
export const MODE = { OFF: 'off', DRY: 'dry', ON: 'on' };

export async function flagMode() {
    if (!isMdlzPage()) return MODE.OFF;
    try {
        const d = await new Promise((r) => chrome.storage.local.get(FLAG_KEY, r));
        const v = d?.[FLAG_KEY];
        if (v === true || v === 'on') return MODE.ON;
        if (v === 'dry' || v === 'preflight') return MODE.DRY;
        return MODE.OFF;
    } catch {
        return MODE.OFF;
    }
}

/** Is v2 allowed to WRITE here? The strongest setting, and only that one. */
export const mdlzV2Enabled = async () => (await flagMode()) === MODE.ON;

/**
 * One observation pass. Returns what v2 believes about this page.
 *
 * The popup figures are the ones that matter first: `orphanOptions` above zero
 * means a previous field left its list open, which measured on the live form
 * as a Degree that "would not open" and a calendar that "did not open" while
 * twenty Skills options sat over them.
 */
export async function observeOnly({ sleep } = {}) {
    const ready = await waitPageReady({ sleep });
    const popups = openPopups();
    const now = census();
    const report = {
        step: ready.step,
        ready: ready.ready,
        fingerprint: pageFingerprint(),
        openPopups: popups.length,
        popupOwners: popups.map((p) => p.ownerField || '(portal)').join(',') || '(none)',
        orphanOptions: orphanOptionCount(),
        // Lists nobody has closed, counted separately from the options in them:
        // one leftover list is one blocked widget, whatever its row count.
        openLists: now.lists,
    };
    trace('mdlz.page.observe', report);
    return report;
}

/**
 * Has the résumé already been attached?
 *
 * v1 owns the upload, and v2 must not take a page where it is still to happen —
 * Workday re-renders every section it parses the CV into, and a pass filling
 * fields underneath that is a pass writing into a page that is about to be
 * replaced.
 *
 * The conservative direction on purpose: when this cannot be read, v2 declines
 * and v1 keeps the page it has always had.
 */
export function resumeAttached() {
    try {
        const input = document.querySelector(SEL.fileInput);
        if (!input) return true;                       // nothing to upload here
        return !!(input.files && input.files.length);
    } catch { return false; }
}

/** Turn one planned descriptor into something the scheduler can run. */
function runnable(task, ctx) {
    if (task.kind === 'addRow') {
        return {
            id: task.id,
            run: async () => {
                const spec = SECTIONS.find((s) => s.name === task.section);
                const rows = rowsOf(spec.anchor, { root: ctx.root });
                return addRow(addButtonFor(spec, rows), {
                    sleep: ctx.sleep, anchor: spec.anchor, root: ctx.root, budgetMs: ctx.addMs,
                });
            },
        };
    }
    return {
        id: task.id,
        run: async () => {
            // Resolved HERE, not at planning time: the row may have been
            // re-rendered, and for a row an Add produced it did not exist then.
            const wrap = resolveTarget(task, { root: ctx.root });
            if (!wrap) return { result: RESULT.WAITING_HYDRATION, reason: 'the field is not on the page' };
            const f = fingerprintOf(() => resolveTarget(task, { root: ctx.root }), { name: task.field || task.id });
            return runField(f, task.want, { ...ctx, row: resolveRow(task, { root: ctx.root }) });
        },
    };
}

/**
 * Would v2 take this page, and why not?
 *
 * ONE decision, used by the pass and by the dry run alike — a preflight that
 * decided separately could report "would take" about a page the controller
 * declines, which is the one thing a preflight must never do.
 */
export async function decideTake(ctx = {}) {
    const seen = await observeOnly(ctx);
    const no = (reason, extra = {}) => ({ take: false, reason, seen, ...extra });

    if (seen.step !== STEP.MY_EXPERIENCE) return no(`v2 does not own ${seen.step}`);
    if (!seen.ready) return no('page still settling');
    if (!resumeAttached()) return no('résumé not attached yet — v1 owns the upload');

    const plan = planStep(ctx.cv, { root: ctx.root });
    const blocking = plan.gaps.filter((g) => /add button/.test(g.why));
    if (blocking.length) {
        return no(`cannot finish ${blocking.map((g) => g.section).join(', ')}`, { plan });
    }
    if (!plan.tasks.length) return no('nothing planned for this page', { plan });
    return { take: true, reason: '', seen, plan };
}

/**
 * The controller. Takes the page, or says why it did not.
 *
 * Everything that makes it decline is a REASON, not a silence: a step v2 does
 * not own, a résumé still to upload, a section whose Add button cannot be told
 * from the other three on the page. v1 then runs exactly as it did before.
 */
export async function runMdlzV2(ctx = {}) {
    const mode = await flagMode();
    if (mode === MODE.OFF) return { took: false, reason: 'flag off' };

    const decision = await decideTake(ctx);

    // Dry run: report and stand down, whatever the decision was. v1 fills this
    // page exactly as it does today, and what comes back is a table.
    if (mode === MODE.DRY) {
        const preflight = preflightReport(ctx.cv, decision, { root: ctx.root });
        return { took: false, reason: `dry run — ${preflight.verdict}`, preflight, dry: true };
    }

    if (!decision.take) {
        if (decision.plan) {
            trace('mdlz.plan.declined', { reason: decision.reason, gaps: decision.plan.gaps.length });
        }
        return { took: false, reason: decision.reason, gaps: decision.plan?.gaps, result: RESULT.SKIPPED_OPTIONAL };
    }
    const { tasks, gaps } = decision.plan;

    trace('mdlz.plan', {
        tasks: tasks.length,
        adds: tasks.filter((t) => t.kind === 'addRow').length,
        gaps: gaps.length,
        first: tasks.slice(0, 3).map((t) => t.id).join(' · '),
    });

    const ledger = await runSequential(tasks.map((t) => runnable(t, ctx)), { sleep: ctx.sleep });
    if (ledger.busy) return { took: false, reason: 'another pass owns this page', report: { matched: false, filled: 0, busy: true } };

    // v1's report shape, because v1's caller is what reads it: how many fields
    // moved, which step, and the answers that were actually committed.
    const done = ledger.tasks.filter((t) => t.result === RESULT.COMMITTED);
    const report = {
        matched: true,
        filled: done.length,
        step: 'My Experience',
        answers: done.map((t) => ({ field: t.id, value: t.detail?.picked || '', source: 'mdlz-v2' })),
        v2: true,
        ledger,
        gaps,
    };
    trace('mdlz.pass', {
        filled: report.filled,
        satisfied: ledger.tasks.filter((t) => t.result === RESULT.SATISFIED).length,
        failed: ledger.tasks.filter((t) => ![RESULT.COMMITTED, RESULT.SATISFIED].includes(t.result)).length,
        halted: ledger.halted || '(none)',
        leaks: ledger.leaks,
        gaps: gaps.length,
    });
    return { took: true, report, ledger, gaps };
}

/**
 * The last CV the router handed in, kept for the console hook alone.
 *
 * A dry run is worth most when it can be asked for at a moment somebody chose —
 * mid-draft, on the row that looks wrong — and not only when the loop happens
 * to come round. The value is already in this page's memory; nothing is stored,
 * sent, or written down.
 */
let _lastCv = null;
export const rememberCv = (cv) => { if (cv) _lastCv = cv; };

/** `copoMdlzPreflight()` in the extension's console context, any time. */
export async function preflightNow(cv) {
    const decision = await decideTake({ cv: cv || _lastCv });
    return preflightReport(cv || _lastCv, decision, {});
}

try {
    if (isMdlzPage() && typeof globalThis !== 'undefined') {
        globalThis.copoMdlzPreflight = preflightNow;
    }
} catch { /* not a browser, or a page v2 has no business on */ }
