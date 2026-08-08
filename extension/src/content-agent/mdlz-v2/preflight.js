/**
 * What v2 WOULD do here — read off a real page, without touching one.
 *
 * Everything v2 knows was measured on a form nobody was applying to twice.
 * Three milestones of it were then proven against a harness built from those
 * measurements, which is a good way to be right about what was measured and no
 * way at all to discover what was not. Two things in particular are assumptions
 * that only a live page can settle:
 *
 *   · that `input.files.length` is what "the résumé is attached" looks like —
 *     if it is not, v2 declines forever and v1 keeps the page, which is the
 *     safe direction but a silent one;
 *   · that a section's Add button sits inside the container its rows live in —
 *     four of them are visible at once on this step, and picking the wrong one
 *     writes an entry into another section.
 *
 * So the first contact with a real application is a READ. This produces the
 * table that answers both, plus the verdict v2 would have reached and the row
 * of every field it would have written — and it writes nothing, takes nothing,
 * and leaves the page to v1 exactly as it is today.
 */

import { SEL, STEP } from './config.js';
import { CAPABILITY, readNow } from './executors.js';
import { WIDGET, fingerprintOf } from './fingerprint.js';
import { census } from './popup-manager.js';
import { SECTIONS, addButtonFor, resolveRow, resolveTarget } from './planner.js';
import { errorsIn, rowsOf } from './row.js';
import { trace } from '../trace.js';

const short = (v) => {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.join(' | ').slice(0, 60);
    if (typeof v === 'object') return `${v.month}/${v.year}`;
    return String(v).slice(0, 60);
};

/**
 * The résumé question, answered in full rather than as a boolean.
 *
 * `attached` is what the take decision uses; the rest is what says whether that
 * reading is even meaningful on this page — an input with no `files` property at
 * all would mean the signal is wrong, not that nothing was uploaded.
 */
export function resumeReport() {
    try {
        const input = document.querySelector(SEL.fileInput);
        if (!input) return { present: false, attached: true, note: 'no upload target on this page' };
        const hasFilesApi = 'files' in input;
        const count = input.files ? input.files.length : null;
        return {
            present: true,
            hasFilesApi,
            files: count,
            attached: !!count,
            note: hasFilesApi ? '' : 'input exposes no .files — the attach signal needs re-measuring',
        };
    } catch (e) {
        return { present: null, attached: false, note: `unreadable: ${e?.message || e}` };
    }
}

/** Where each section's Add button is, and whether it can be told from the others. */
export function sectionReport(cv, { root = null } = {}) {
    const everyAdd = (() => {
        try { return [...document.querySelectorAll(SEL.addButton)].length; } catch { return 0; }
    })();
    return {
        addButtonsOnPage: everyAdd,
        sections: SECTIONS.map((spec) => {
            const rows = rowsOf(spec.anchor, { root });
            const add = addButtonFor(spec, rows);
            return {
                section: spec.name,
                rows: rows.length,
                entries: spec.entries(cv).length,
                addFound: !!add,
                // The point of the whole check: the button we would click has to
                // be the one this section owns, and with no rows there is nothing
                // that says which of the four it is.
                addIsScopedToSection: !!add && rows.length > 0,
                rowErrors: rows.map((r) => errorsIn(r).length).reduce((a, b) => a + b, 0),
            };
        }),
    };
}

/**
 * Every field the plan names, as it stands on the page right now.
 *
 * The columns that matter on a live run: what v2 thinks the widget IS, what is
 * in it, what would go in, and whether v2 has a capability for it at all. A
 * widget with no capability is the discovery this run exists to make — better
 * found in a table than by a pass that improvises on a real application.
 */
export function fieldReport(tasks, { root = null } = {}) {
    return tasks.filter((t) => t.kind === 'field').map((t) => {
        const wrap = resolveTarget(t, { root });
        if (!wrap) return { id: t.id, kind: '(not on the page)', now: '—', want: short(t.want), capable: false };
        const f = fingerprintOf(() => resolveTarget(t, { root }), { name: t.field || t.id });
        const cap = CAPABILITY[f.kind];
        let satisfied = null;
        try { satisfied = cap ? !!cap.satisfied(f, t.want) : null; } catch { satisfied = null; }
        return {
            id: t.id,
            kind: f.kind,
            label: f.label.slice(0, 40),
            now: readNow(f),
            want: short(t.want),
            satisfied,
            capable: !!cap && f.kind !== WIDGET.UNKNOWN,
            rowFound: !t.rowKey || !!resolveRow(t, { root }),
        };
    });
}

/**
 * The whole dry run. Reads the page, reports, changes nothing.
 *
 * `decide` is the SAME decision the controller makes — passed in rather than
 * re-implemented, so a preflight can never say "would take" about a page the
 * controller would decline.
 */
export function preflightReport(cv, decision, { root = null } = {}) {
    const { tasks = [], gaps = [] } = decision.plan || {};
    const report = {
        verdict: decision.take ? 'WOULD TAKE' : 'WOULD HAND BACK',
        reason: decision.reason || '',
        step: decision.seen?.step || STEP.UNKNOWN,
        ready: !!decision.seen?.ready,
        resume: resumeReport(),
        ...sectionReport(cv, { root }),
        adds: tasks.filter((t) => t.kind === 'addRow').map((t) => t.section),
        fields: fieldReport(tasks, { root }),
        gaps,
        popups: (() => { const c = census(); return { orphans: c.orphans, lists: c.lists, panels: c.panels }; })(),
    };

    // One line per field, because the point of this run is that it gets PASTED.
    trace('mdlz.preflight', {
        verdict: report.verdict,
        reason: report.reason,
        step: report.step,
        resume: `${report.resume.present ? `present, files=${report.resume.files}` : 'absent'}`,
        sections: report.sections.map((s) => `${s.section}:${s.rows}r/${s.entries}e/add=${s.addFound ? 'y' : 'n'}`).join(' '),
        addButtonsOnPage: report.addButtonsOnPage,
        adds: report.adds.join(',') || '(none)',
        unknownWidgets: report.fields.filter((f) => !f.capable).map((f) => f.id).join(',') || '(none)',
        wouldWrite: report.fields.filter((f) => f.satisfied === false).length,
        alreadyRight: report.fields.filter((f) => f.satisfied === true).length,
        gaps: gaps.map((g) => `${g.section}:${g.why}`).join(' · ') || '(none)',
        orphans: report.popups.orphans,
    });
    for (const f of report.fields) {
        trace('mdlz.preflight.field', {
            field: f.id, kind: f.kind, now: f.now, want: f.want,
            state: f.satisfied === true ? 'already right' : f.satisfied === false ? 'would write' : 'unknown',
            capable: f.capable, rowFound: f.rowFound,
        });
    }
    return report;
}
