/**
 * What v2 WOULD do here — read off a real page, without touching one.
 *
 * Everything v2 knows was measured on a form nobody was applying to twice.
 * Three milestones of it were then proven against a harness built from those
 * measurements, which is a good way to be right about what was measured and no
 * way at all to discover what was not. Two things in particular are assumptions
 * that only a live page can settle:
 *
 *   · that the résumé is attached — asked three ways now, and every answer
 *     reported, because one signal that could be wrong with nothing to notice
 *     it is how v2 would decline forever in silence;
 *   · that a section's Add button can be told from the other three, either
 *     through a row the section already has or through the heading Workday's
 *     own copy gives it. The second has never met a real page.
 *
 * So the first contact with a real application is a READ. This produces the
 * table that answers both, plus the verdict v2 would have reached and the row
 * of every field it would have written — and it writes nothing, takes nothing,
 * and leaves the page to v1 exactly as it is today.
 */

import { COPY, SEL, STEP } from './config.js';
import { readFileCommitState } from '../dom.js';
import { CAPABILITY, readNow } from './executors.js';
import { WIDGET, fingerprintOf } from './fingerprint.js';
import { census } from './popup-manager.js';
import { SECTIONS, addButtonFound, resolveRow, resolveTarget } from './planner.js';
import { errorsIn, rowsOf } from './row.js';
import { trace } from '../trace.js';

const short = (v) => {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.join(' | ').slice(0, 60);
    if (typeof v === 'object') return `${v.month}/${v.year}`;
    return String(v).slice(0, 60);
};

/**
 * Has the résumé landed?
 *
 * ONE DEFINITION, and it is not v2's. `readFileCommitState` in dom.js is the
 * shared answer the recipe and the observer already use, and the reason it is
 * shared is a measured freeze: the two of them once answered differently — the
 * recipe read uploadedRows=2 and skipped the upload while the observer read the
 * input, which WORKDAY CLEARS AFTER INGESTING — so the same upload was reported
 * as an unfilled required field, advance was withheld, and the planner was
 * consulted about a page that was finished. A third module with its own
 * definition is that bug again with more steps.
 *
 * That also settles a guess of mine: `input.files` cannot be the signal here,
 * because Workday empties it. What testifies is Workday's own row markers —
 * `file-upload-item` / `file-upload-successful` — the ids the recipe's
 * advanceWhen already trusts, and the same measurement records what re-uploading
 * on a false negative costs: 5+ duplicate rows in one run.
 *
 * The two readings below the line are NOT part of the answer. They are carried
 * so a live run can say whether they are worth anything: the CV's filename on
 * the page, and Workday's "Successfully Uploaded!" (APPLY.FILE.Virus_Scan_Successful,
 * out of the shipped language bundle — a key that reads like a moment, not a
 * state). Neither has been measured on this tenant. The filename is reported as
 * a yes/no: it is somebody's name in a file name, and a report meant to be
 * pasted has no business carrying it.
 */
export function resumeEvidence(cvData) {
    try {
        const input = document.querySelector(SEL.fileInput);
        const state = readFileCommitState(input, document);

        // Unmeasured, and reported only so the live run can judge them.
        const pageText = (document.body?.textContent || '');
        const stem = String(cvData?.fileName || '').trim().replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
        const filenameOnPage = !!stem && pageText.includes(stem);
        const banner = pageText.includes(COPY.uploadedBanner);

        if (!input && !state.uploadedRows) {
            return {
                present: false, attached: true, signals: [], uploadedRows: 0,
                unmeasured: { filenameOnPage, banner },
                note: 'no upload target on this page',
            };
        }
        return {
            present: !!input,
            files: input?.files?.length ?? null,
            uploadedRows: state.uploadedRows,
            scoped: state.scoped,
            attached: state.committed,
            signals: [
                state.nativeFiles > 0 && 'input.files',
                state.uploadedRows > 0 && `upload-rows(${state.uploadedRows})`,
            ].filter(Boolean),
            unmeasured: { filenameOnPage, banner, knewFileName: !!stem },
            note: state.committed ? '' : 'no upload row and no file on the input',
        };
    } catch (e) {
        return { present: null, attached: false, signals: [], note: `unreadable: ${e?.message || e}` };
    }
}

/** Kept as the old name, because the report reads better as one word. */
export const resumeReport = resumeEvidence;

/** Where each section's Add button is, and whether it can be told from the others. */
export function sectionReport(cv, { root = null, addVia = 'any' } = {}) {
    const everyAdd = (() => {
        try { return [...document.querySelectorAll(SEL.addButton)].length; } catch { return 0; }
    })();
    return {
        addButtonsOnPage: everyAdd,
        sections: SECTIONS.map((spec) => {
            const rows = rowsOf(spec.anchor, { root });
            const { button, via } = addButtonFound(spec, rows, addVia);
            return {
                section: spec.name,
                heading: COPY.sections[spec.name] || '',
                rows: rows.length,
                entries: spec.entries(cv).length,
                addFound: !!button,
                // WHICH way found it is the interesting half on a live page: by
                // a row this section already has, or by the heading Workday's own
                // copy gives it. The second has never been tried on a real page.
                addVia: via || '(none)',
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
export function preflightReport(cv, decision, { root = null, cvData = null, addVia = 'any' } = {}) {
    const { tasks = [], gaps = [] } = decision.plan || {};
    const report = {
        verdict: decision.take ? 'WOULD TAKE' : 'WOULD HAND BACK',
        reason: decision.reason || '',
        step: decision.seen?.step || STEP.UNKNOWN,
        ready: !!decision.seen?.ready,
        resume: resumeEvidence(cvData),
        ...sectionReport(cv, { root, addVia }),
        addVia,
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
        resume: `${report.resume.attached ? 'attached' : 'NOT attached'} via [${report.resume.signals.join(',') || 'nothing'}]`
            + ` (input=${report.resume.present ? `yes, files=${report.resume.files}` : 'absent'},`
            + ` rows=${report.resume.uploadedRows})`,
        // Carried separately because neither has been measured on this tenant —
        // the live run is what decides whether they are worth anything.
        resumeUnmeasured: `filenameOnPage=${report.resume.unmeasured?.filenameOnPage} banner=${report.resume.unmeasured?.banner}`,
        sections: report.sections.map((s) => `${s.section}:${s.rows}r/${s.entries}e/add=${s.addFound ? s.addVia : 'NO'}`).join(' '),
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
