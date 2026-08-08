/**
 * What this page still needs, decided fresh every time it is asked.
 *
 * The planner answers two questions and nothing else: which rows should exist,
 * and what belongs in each field of them. It writes nothing — every descriptor
 * it returns is data, and the executors are what touch the page.
 *
 * THE MEASUREMENT THIS FILE IS BUILT AROUND: a form ended up with three
 * "Vietnamese" rows under a red "Duplicate language entries are not allowed."
 * Two independent defects met there. The grow loop read its work list ONCE and
 * never recomputed it, so every pass acted on a page that had already changed;
 * and the planner behind it skipped empty rows entirely, so a blank row already
 * on the page counted for nothing and "Add" kept being clicked until the section
 * hit its cap. Those blanks were then somewhere to put a language, and each
 * concurrent pass put the same one in a different one.
 *
 * So, three rules, and they are the whole design:
 *
 *   1. THE PLAN IS RE-DERIVED FROM THE PAGE, never remembered. It is cheap, and
 *      a remembered plan is a plan about a page that no longer exists.
 *   2. A ROW IS CLAIMED BY CONTENT, never by index. An entry finds its row by
 *      what the row says; only then, failing that, does it take an empty one.
 *   3. NOTHING IS ADDED WHILE AN EMPTY ROW EXISTS. An empty row is not "no row",
 *      it is somewhere to put the next entry.
 */

import { COPY, MONTHS, SEL } from './config.js';
import { fieldByLabel, fieldIn, isEmptyRow, rowsOf, valueIn } from './row.js';

const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A CV date, as month and year.
 *
 * The shapes that actually arrive: ISO (`2021-03-01`), `MM/YYYY`, and a named
 * month with a year. "Present"/"hiện tại" is not a date — it is the checkbox.
 */
export function monthYear(value) {
    const t = String(value || '').trim();
    if (!t || /^(hiện tại|hien tai|present|current|now|nay)$/i.test(t)) return null;
    const iso = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (iso) return { month: Number(iso[2]), year: Number(iso[1]) };
    const year = (t.match(/\b(19|20)\d{2}\b/) || [])[0];
    if (!year) return null;
    const named = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}`, 'i').test(t));
    const numeric = (t.match(/\b(0?[1-9]|1[0-2])\b(?!\d)/) || [])[0];
    const month = named >= 0 ? named + 1 : (numeric ? Number(numeric) : null);
    return month ? { month, year: Number(year) } : null;
}

/** Is this experience still going? The CV says so in words, or by omission. */
const isCurrent = (e) => /^(hiện tại|hien tai|present|current|now|nay)$/i.test(String(e?.end_date || '').trim())
    || (!!e?.start_date && !e?.end_date);

/**
 * The sections of My Experience, as specifications.
 *
 * A section is its anchor, the fields a row of it carries, and the key that
 * says which entry a row already holds. Adding Education and Languages is
 * therefore data, not another copy of the loop that fills Work Experience.
 */
export const SECTIONS = [
    {
        name: 'work',
        anchor: SEL.row.jobTitle,
        entries: (cv) => (cv?.experience || []),
        /** What identifies a row of this section, read off the page. */
        keyOf: (row) => fold(`${valueIn(row, 'formField-jobTitle')}@${valueIn(row, 'formField-companyName')}`),
        keyOfEntry: (e) => fold(`${e.title || ''}@${e.company || ''}`),
        /** A looser match, for a row half-written by an earlier pass. */
        partialOf: (row) => fold(valueIn(row, 'formField-jobTitle')),
        partialOfEntry: (e) => fold(e.title || ''),
        emptyWhen: ['formField-jobTitle', 'formField-companyName'],
        fields: (e) => [
            { id: 'formField-jobTitle', want: e.title },
            { id: 'formField-companyName', want: e.company },
            { id: 'formField-roleDescription', want: e.description, optional: true },
            { id: 'formField-currentlyWorkHere', want: isCurrent(e), when: () => isCurrent(e) },
            { id: 'formField-startDate', want: monthYear(e.start_date) },
            { id: 'formField-endDate', want: monthYear(e.end_date), when: () => !isCurrent(e) },
        ],
    },
    {
        name: 'education',
        anchor: SEL.row.schoolName,
        entries: (cv) => (cv?.education || []),
        keyOf: (row) => fold(valueIn(row, 'formField-schoolName')),
        keyOfEntry: (e) => fold(e.institution || e.school || ''),
        emptyWhen: ['formField-schoolName'],
        fields: (e) => [
            { id: 'formField-schoolName', want: e.institution || e.school },
            { id: 'formField-degree', want: e.degree, optional: true },
        ],
    },
    {
        name: 'languages',
        anchor: SEL.row.language,
        entries: (cv) => dedupeLanguages(cv?.languages || []),
        keyOf: (row) => fold(valueIn(row, 'formField-language')),
        keyOfEntry: (e) => fold(e.language || ''),
        emptyWhen: ['formField-language'],
        fields: (e) => [
            { id: 'formField-language', want: e.language },
            // Overall proficiency has a per-tenant GUID for an id, so it is
            // reached by its label INSIDE the row — never page-wide.
            { byLabel: /overall/i, want: e.level, optional: !e.level, name: 'Overall' },
        ],
    },
];

/**
 * One row per language, whatever the CV called it.
 *
 * The duplicate-row incident started here: two spellings of one language rode
 * through as two entries and the form refused them both.
 */
export function dedupeLanguages(list) {
    const out = [];
    for (const raw of list) {
        const name = String(raw?.language || '').trim();
        if (!name) continue;
        const key = fold(name).replace(/\s*[-(].*$/, '');
        const seen = out.find((o) => o.key === key);
        if (!seen) { out.push({ key, language: name, level: raw.level || '' }); continue; }
        // The entry that states a level is the one worth keeping.
        if (!seen.level && raw.level) seen.level = raw.level;
    }
    return out;
}

/**
 * Which row holds this entry — by what the page says, then by what is free.
 *
 * Never by index: append order stops describing anything the moment Workday
 * re-renders, a row is deleted, or a previous pass half-filled one.
 */
export function claimRow(spec, entry, rows, taken) {
    const free = rows.filter((r) => !taken.has(r));
    const want = spec.keyOfEntry(entry);
    const exact = free.find((r) => spec.keyOf(r) === want);
    if (exact) return { row: exact, how: 'key' };
    if (spec.partialOf) {
        const partial = free.find((r) => spec.partialOf(r) && spec.partialOf(r) === spec.partialOfEntry(entry));
        if (partial) return { row: partial, how: 'partial-key' };
    }
    const blank = free.find((r) => isEmptyRow(r, spec.emptyWhen));
    if (blank) return { row: blank, how: 'empty-row' };
    return { row: null, how: 'needs-add' };
}

/**
 * The container a section's HEADING belongs to.
 *
 * The headings are Workday's own copy, from the language bundle the apply flow
 * loads ("Work Experience", "Education", "Languages", "Skills") — the same
 * words a human uses to tell one Add button from the next, and the only thing
 * on the page that distinguishes them when a section has no rows yet.
 *
 * The climb stops where the ancestor would take in ANOTHER section's heading:
 * one heading, one section, exactly the rule rows are found by.
 */
export function sectionByHeading(title) {
    if (typeof document === 'undefined' || !title) return null;
    const others = Object.values(COPY.sections).filter((t) => t !== title);
    const holds = (node, text) => [...(node.querySelectorAll?.('h1,h2,h3,h4,h5,label,div,span') || [])]
        .some((el) => (el.textContent || '').trim() === text);

    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,label,div,span')]
        .filter((el) => (el.textContent || '').trim() === title)
        .filter((el) => el.offsetParent !== null);
    for (const head of heads) {
        let node = head;
        while (node.parentNode && node.parentNode !== document.documentElement) {
            const parent = node.parentNode;
            if (others.some((t) => holds(parent, t))) break;      // the next section starts here
            node = parent;
            if (node.querySelector?.(SEL.addButton)) return node; // its own Add, and nobody else's
        }
    }
    return null;
}

/**
 * The section container, and the Add button that belongs to IT.
 *
 * Four Add buttons are visible at once on this step, so a page-wide query adds
 * a row to whichever section comes first in the document. Two ways to be sure
 * which is which, in order of how much they rely on: the section a row already
 * sits in, and failing that the section its HEADING names. Returns which one
 * answered, because on a live page that is the interesting half.
 */
export function addButtonFound(spec, rows, addVia = 'any') {
    if (rows.length) {
        const section = rows.length > 1 ? rows[0].parentNode : rows[0];
        const byRows = section?.querySelector?.(SEL.addButton);
        if (byRows) return { button: byRows, via: 'rows' };
    }
    // The heading strategy is grounded in Workday's own copy and has never met a
    // real page. `addVia: 'rows'` is the switch that turns it off from a console
    // if a live run puts a row in the wrong section.
    if (addVia === 'rows') return { button: null, via: null };
    const heading = sectionByHeading(COPY.sections[spec.name]);
    const byHeading = heading?.querySelector?.(SEL.addButton);
    if (byHeading) return { button: byHeading, via: 'heading' };
    return { button: null, via: null };
}

/** Just the button, for callers that only want to click it. */
export const addButtonFor = (spec, rows, addVia) => addButtonFound(spec, rows, addVia).button;

/**
 * Everything this page still needs, in the order it should be done.
 *
 * Rows before their fields, fields of one entry together, and the whole thing
 * derived from the page as it is right now.
 */
export function planStep(cv, { root = null, maxRows = 8, addVia = 'any' } = {}) {
    const tasks = [];
    const gaps = [];

    for (const spec of SECTIONS) {
        const entries = spec.entries(cv).slice(0, maxRows);
        if (!entries.length) continue;
        const rows = rowsOf(spec.anchor, { root });
        const taken = new Set();

        for (const entry of entries) {
            const { row, how } = claimRow(spec, entry, rows, taken);
            if (!row) {
                const { button: add, via } = addButtonFound(spec, rows, addVia);
                if (!add) {
                    // Neither a row nor a heading names this section's button,
                    // and four of them are on the page: say so, and let something
                    // that can see the page decide. Guessing which Add to click
                    // writes an entry into another section.
                    gaps.push({ section: spec.name, why: 'no row and no add button we can identify' });
                    break;
                }
                tasks.push({
                    kind: 'addRow', section: spec.name, id: `${spec.name}.add`,
                    entryKey: spec.keyOfEntry(entry),
                    // How the button was identified — worth carrying, because on
                    // a live page "by heading" is the claim that has never been
                    // tested against a real one.
                    via,
                });
                // Everything after an add is planned on the NEXT pass, against
                // the page the add produced. A plan that assumes what the click
                // will render is the plan that filled rows that did not exist.
                break;
            }
            taken.add(row);
            for (const f of spec.fields(entry)) {
                if (f.when && !f.when()) continue;
                if (f.want === null || f.want === undefined || f.want === '') {
                    if (!f.optional) gaps.push({ section: spec.name, field: f.id || f.name, why: 'the CV does not say' });
                    continue;
                }
                tasks.push({
                    kind: 'field',
                    section: spec.name,
                    id: `${spec.name}[${spec.keyOfEntry(entry)}].${f.id || f.name}`,
                    rowKey: spec.keyOfEntry(entry),
                    anchor: spec.anchor,
                    field: f.id || null,
                    byLabel: f.byLabel || null,
                    want: f.want,
                    optional: !!f.optional,
                });
            }
        }
    }

    // Skills is one field with many values — no rows, no adds, and the chips
    // already on the page are the candidate's own.
    const skills = normaliseSkills(cv?.skills);
    if (skills.length) {
        tasks.push({ kind: 'field', section: 'skills', id: 'skills', field: 'formField-skills', want: skills });
    }

    return { tasks, gaps };
}

/** A CV may hold skills as a list or as one comma-separated line. */
export function normaliseSkills(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
    return [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
}

/**
 * Find the wrapper a task points at, at the moment it runs.
 *
 * Re-resolved from the key every time, because between planning and running the
 * row may have been re-rendered, moved, or (for the row an Add just produced)
 * come into existence.
 */
export function resolveTarget(task, { root = null } = {}) {
    if (!task.rowKey) {
        return task.field && typeof document !== 'undefined'
            ? document.querySelector(`[data-automation-id="${task.field}"]`)
            : null;
    }
    const spec = SECTIONS.find((s) => s.name === task.section);
    const rows = rowsOf(task.anchor, { root });
    const row = rows.find((r) => spec.keyOf(r) === task.rowKey)
        || (spec.partialOf ? rows.find((r) => spec.partialOf(r) && spec.partialOf(r) === task.rowKey.split('@')[0]) : null)
        || rows.find((r) => isEmptyRow(r, spec.emptyWhen))
        || null;
    if (!row) return null;
    return task.byLabel ? fieldByLabel(row, task.byLabel) : fieldIn(row, task.field);
}

/** The row a task belongs to — what an error has to be attributed to. */
export function resolveRow(task, { root = null } = {}) {
    if (!task.rowKey) return null;
    const spec = SECTIONS.find((s) => s.name === task.section);
    const rows = rowsOf(task.anchor, { root });
    return rows.find((r) => spec.keyOf(r) === task.rowKey)
        || rows.find((r) => spec.partialOf && spec.partialOf(r) === task.rowKey.split('@')[0])
        || null;
}
