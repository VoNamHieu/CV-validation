/**
 * My Experience, rebuilt out of its own pathologies.
 *
 * Every behavior below is one that was READ OFF A LIVE RUN, and the page is
 * assembled so that a manager which only works on a polite widget fails here:
 *
 *  · STICKY — a list stays up after the field is done with it. This is the one
 *    the gate is about: clicking Degree found 39 options, 20 of them Skills'.
 *  · UNCLAIMED — Skills' list carries no aria-expanded trigger and no
 *    aria-controls, which is why those 20 counted as ORPHANS rather than as
 *    somebody's open list. The button prompts (Degree, Language) do stamp their
 *    trigger, as measured on the same tenant, so the census has both shapes to
 *    tell apart.
 *  · PORTALLED — the list is appended to the body, with no formField ancestor
 *    to disown it by. Ownership cannot be read here, only established.
 *  · SCOPED ESCAPE — a key aimed at the body is not heard by a widget that
 *    listens inside its own subtree. Not a Workday measurement: the pessimistic
 *    case, because a sweep that works only when focus happens to be in the right
 *    place is not a sweep.
 *  · LATE — opens, commits and closes land after the call that caused them
 *    (~550ms on the live form; milliseconds here). An unverified sweep reports a
 *    clear page over an open list in exactly this window.
 *  · CHIPS THAT READ AS OPTIONS — a committed chip carries the option id too
 *    (measured on Mondelez's countryPhoneCode), and clicking one DESELECTS it.
 *    A census that counts chips would report a page that can never be cleared,
 *    and a manager that clicked them would erase answers.
 *  · A LIST THAT REFUSES KEYS — Language ignores Escape and closes only on an
 *    outside click, so the ladder has to escalate rather than repeat.
 *
 * And, for the field layer:
 *
 *  · A DATE THAT CANNOT BE TYPED — a synthetic write into a date section does
 *    NOTHING (measured: value stays "", aria-valuenow stays null; only the
 *    picker or a trusted keydown commits). The spinbuttons here revert every
 *    write, so an executor that types is not "unlucky", it is wrong.
 *  · A COMMIT THAT .value DENIES — the picker writes aria-valuenow and leaves
 *    .value empty, exactly as the live form does. A verifier reading .value
 *    calls a committed date empty; that false verdict is reproduced here.
 *  · A TEXT BOX THAT HANDS BACK THE OLD TEXT — the React-controlled shape, where
 *    a value goes in and the next render puts the previous one back. The other
 *    false verdict: reported done, actually empty.
 *  · A CONDITIONAL FIELD — ticking "I currently work here" removes To from the
 *    DOM, so page-wide checkbox[i] and endDate[i] stop describing the same row
 *    (measured: 3 boxes, 2 To's). Rows here are unnamed on purpose: a row must
 *    be found by structure, not by an id the next tenant will not have.
 */

const OPT_ID = 'promptOption';

let listSeq = 0;

/** The catalogues. Sizes chosen so a bleed is unmistakable in a count. */
export const SKILLS = [
    'Product Roadmapping', 'Backlog Prioritization', 'Agile Methodologies',
    'Stakeholder Management', 'Go-to-Market Strategy', 'Data Analysis',
    'A/B Testing', 'Customer Discovery', 'Roadmap Communication',
    'Cross-functional Leadership', 'Pricing Strategy', 'User Research',
    'SQL', 'Figma', 'Jira', 'Confluence', 'Amplitude', 'Looker', 'Mixpanel',
    'Segmentation',
];

export const DEGREES = [
    'B.B.A. - Bachelor of Business Administration or equivalent',
    'B.Sc. - Bachelor of Science or equivalent',
    'B.A. - Bachelor of Arts or equivalent',
    'M.B.A. - Master of Business Administration or equivalent',
    'M.Sc. - Master of Science or equivalent',
];

export const LANGUAGES = ['English', 'Vietnamese', 'French', 'Japanese', 'Mandarin'];

/** Measured on this tenant: there is no "Native" row. A native speaker is fluent. */
export const LEVELS = ['1 - Beginner', '2 - Intermediate', '3 - Fluent'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Build the page.
 *
 * `opts` are the pathology switches. The defaults are the measured form; a test
 * turns one OFF to show what the manager is actually buying.
 */
export function buildHostilePage(doc, opts = {}) {
    const cfg = {
        sticky: true,            // a new list does not close the old one
        scopedEscape: true,      // Escape at the body is ignored
        openMs: 5,
        commitMs: 15,
        closeMs: 15,
        pickerYear: 2026,        // where an empty picker opens
        nextLabel: 'Save and Continue',
        nextPageId: 'applyFlowPrimaryQuestionsPage',
        navMs: 20,               // the click lands, the page changes later
        navHydrateMs: 25,        // and the new one arrives busy
        blockAdvance: false,     // a page that refuses to be left
        ...opts,
    };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowMyExpPage' }, doc.body);

    // ── the wizard ───────────────────────────────────────────────────
    // Advancing is the one action that cannot be undone from inside the flow,
    // so the harness models what it really does: the page NODE is replaced, the
    // URL never moves, the new page arrives hydrating, and a page that is not
    // finished answers with an error instead of going anywhere.
    const nav = { clicks: 0, advancedTo: null };
    const next = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page);
    next.textContent = cfg.nextLabel;
    next.addEventListener('click', () => {
        nav.clicks += 1;
        if (cfg.blockAdvance) {
            // Validation: the page stays, and says why.
            if (!page.querySelector('[data-automation-id="inputAlert"]')) {
                el('div', { 'data-automation-id': 'inputAlert' }, page).textContent = 'The field From is required';
            }
            return;
        }
        setTimeout(() => {
            page.remove();
            const arrived = el('div', { 'data-automation-id': cfg.nextPageId }, doc.body);
            // The next page renders busy before it renders itself.
            const spinner = el('div', { 'data-automation-id': 'loadingPanel' }, arrived);
            setTimeout(() => spinner.remove(), cfg.navHydrateMs);
            nav.advancedTo = cfg.nextPageId;
        }, cfg.navMs);
    });

    // ── Work Experience ──────────────────────────────────────────────
    // The section holds the rows; a row is an unnamed DIV, because on the live
    // form there is no "row id" to hang identity on and a finder that needs one
    // is a finder that works on this tenant only.
    // The headings are Workday's own copy, from the language bundle the apply
    // flow loads (APPLY.MY_EXPERIENCE.Work_Experience and its siblings). On a
    // page whose section has no rows yet, they are the only thing that says
    // which of the Add buttons belongs to which section.
    const section = (title) => {
        const box = el('div', {}, page);
        if (title !== null) el('h3', {}, box).textContent = title;
        return box;
    };
    // A section the tenant does not render at all — no heading, no Add button.
    // The Maersk intern form has no Education (measured R192834), so this is how
    // a page proves "absent section" as distinct from "headings stripped".
    const omit = new Set(opts.omit || []);
    const workSection = section(opts.headings === false ? null : 'Work Experience');
    const eduSection = omit.has('education') ? null : section(opts.headings === false ? null : 'Education');
    const langSection = section(opts.headings === false ? null : 'Languages');
    const rows = [];
    const pickerFor = new Map();   // date wrapper → its open panel
    const dateKeys = [];           // every keydown a spinbutton was sent
    const dateWrites = [];         // every .value a spinbutton refused

    /** A text box that can be told to hand the old value back, React-style. */
    function textControl(wrap, { reverts = false, tag = 'input' } = {}) {
        const input = el(tag, tag === 'input' ? { type: 'text' } : {}, wrap);
        if (!reverts) return input;
        let held = '';
        Object.defineProperty(input, 'value', {
            get: () => held,
            set: (v) => {
                // Accepted for a moment, then the next render puts back what
                // the component's own state still says.
                held = String(v);
                setTimeout(() => { held = ''; }, cfg.commitMs);
            },
            configurable: true,
        });
        return input;
    }

    /**
     * A date, as measured: two spinbuttons that REFUSE every synthetic write,
     * a calendar icon, and a commit that shows up in aria-valuenow only.
     */
    function dateControl(wrap, name) {
        const icon = el('button', { 'data-automation-id': 'dateIcon' }, wrap);
        icon.textContent = 'Calendar';
        const mk = (id) => {
            const input = el('input', { 'data-automation-id': id, role: 'spinbutton', type: 'text' }, wrap);
            let refused = '';
            Object.defineProperty(input, 'value', {
                get: () => refused,
                set: () => { dateWrites.push(name); },   // written to, never written
                configurable: true,
            });
            input.addEventListener('keydown', () => dateKeys.push(name));
            return input;
        };
        const month = mk('dateSectionMonth-input');
        const year = mk('dateSectionYear-input');
        icon.addEventListener('click', () => openPicker(wrap, month, year));
        return { icon, month, year };
    }

    /**
     * The picker: a UL of twelve cells labelled "May 2026", the selected one
     * prefixed, and the year arrows in the UL's parent. Portalled to the body,
     * like every other popup here.
     */
    function openPicker(wrap, month, year) {
        if (pickerFor.has(wrap)) return;
        let shownYear = Number(year.getAttribute('aria-valuenow')) || cfg.pickerYear;
        const panel = el('div', {}, doc.body);
        const back = el('button', { 'aria-label': 'Previous Year' }, panel);
        const fwd = el('button', { 'aria-label': 'Next Year' }, panel);
        const ul = el('ul', {}, panel);
        const paint = () => {
            ul.children.forEach((c) => { c.parentNode = null; });
            ul.children = [];
            MONTHS.forEach((m, i) => {
                const li = el('li', {}, ul);
                const cell = el('div', { role: 'button' }, li);
                const selected = Number(month.getAttribute('aria-valuenow')) === i + 1
                    && Number(year.getAttribute('aria-valuenow')) === shownYear;
                cell.setAttribute('aria-label', `${selected ? 'Selected ' : ''}${m} ${shownYear}`);
                cell.textContent = m;
                cell.addEventListener('click', () => {
                    setTimeout(() => {
                        // The commit the live form makes: aria-valuenow, and
                        // nothing in .value.
                        month.setAttribute('aria-valuenow', String(i + 1));
                        year.setAttribute('aria-valuenow', String(shownYear));
                        closePicker(wrap);
                    }, cfg.commitMs);
                });
            });
        };
        back.addEventListener('click', () => { shownYear -= 1; paint(); });
        fwd.addEventListener('click', () => { shownYear += 1; paint(); });
        panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(wrap); });
        pickerFor.set(wrap, panel);
        paint();
    }

    function closePicker(wrap) {
        const p = pickerFor.get(wrap);
        if (!p) return;
        pickerFor.delete(wrap);
        p.remove();
    }

    /**
     * One Work Experience row. `current: true` ticks the box and takes To out of
     * the DOM, which is the shape that breaks index pairing.
     */
    function addWorkRow({ title = '', company = '', current = false, revertsTitle = false } = {}) {
        const row = el('div', {}, workSection);
        const field = (id) => el('div', { 'data-automation-id': id }, row);

        const titleInput = textControl(field('formField-jobTitle'), { reverts: revertsTitle });
        titleInput.value = title;
        const companyInput = textControl(field('formField-companyName'));
        companyInput.value = company;

        const box = el('input', { type: 'checkbox' }, field('formField-currentlyWorkHere'));
        const start = dateControl(field('formField-startDate'), 'startDate');
        let endWrap = field('formField-endDate');
        let end = dateControl(endWrap, 'endDate');
        const desc = textControl(field('formField-roleDescription'), { tag: 'textarea' });

        const applyCurrent = () => {
            if (box.checked && endWrap) { endWrap.remove(); endWrap = null; end = null; }
            else if (!box.checked && !endWrap) {
                endWrap = field('formField-endDate');
                end = dateControl(endWrap, 'endDate');
            }
        };
        box.addEventListener('click', () => { box.checked = !box.checked; applyCurrent(); });
        if (current) { box.checked = true; applyCurrent(); }

        const model = {
            row, titleInput, companyInput, box, desc,
            start: () => start,
            end: () => end,
            /** Workday says only "The field From is required" — the row is the
             *  only thing that says WHICH one. */
            raiseError(text = 'The field From is required') {
                // MEASURED on mdlz 2026-08-03: the per-field error is
                // `inputAlert`. errorMessage and formFieldError never appeared —
                // a verify reading only those two saw "0 errors" beside a red
                // "The field From is required and must have a value."
                const node = el('div', { 'data-automation-id': 'inputAlert' }, row);
                node.textContent = text;
                return node;
            },
            clearErrors() {
                row.querySelectorAll('[data-automation-id="inputAlert"]').forEach((e) => e.remove());
            },
        };
        rows.push(model);
        return model;
    }

    // ── widgets, keyed by the widget and not by a name ────────────────
    // Every row of a repeating section owns its own listbox, so the machinery
    // cannot be keyed on "the degree field" — there are as many as there are
    // rows, and they hold different answers.
    const fields = {};                // page-level widgets, by a friendly name
    const openLists = new Map();      // widget spec → its open list node
    const opening = new Set();        // a list whose open is scheduled but not landed

    function closeList(f, { after = cfg.closeMs } = {}) {
        const list = openLists.get(f);
        if (!list) return;
        openLists.delete(f);
        setTimeout(() => {
            list.remove();
            f.trigger.removeAttribute('aria-expanded');
            f.trigger.removeAttribute('aria-controls');
        }, after);
    }

    const closeEveryList = () => [...openLists.keys()].forEach((f) => closeList(f, { after: 0 }));

    /** The option rows of a list, rebuilt for one result set. */
    function fillList(f, list, shown) {
        [...(list.children || [])].forEach((c) => c.remove());
        // A VIRTUALISED list paints only a WINDOW of its results (measured on the
        // live PwC fieldOfStudy: 21 results, ~11 painted, the exact match below
        // the window never rendered). `renderCap` models that: the DOM carries
        // only the first N rows, so an exact match past N cannot be clicked — the
        // engine must reach it through the fiber item array instead.
        const rendered = f.renderCap ? shown.slice(0, f.renderCap) : shown;
        for (const label of rendered) {
            const o = el('div', { role: 'option', 'data-automation-id': OPT_ID }, list);
            o.textContent = label;
            o.addEventListener('click', () => commit(f, label));
        }
        // The placeholder is a real option that answers nothing.
        const ph = el('div', { role: 'option', 'data-automation-id': OPT_ID, id: 'select-one' }, list);
        ph.textContent = 'Select One';
        // The widget's OWN item array on the list fiber — the WHOLE result set,
        // each item carrying an `onSelect` whose length-bearing branch commits it
        // (item.onSelect([item]), measured live 2026-08-15). readVirtualItems
        // walks to this; fiberCommit writes through it without a paint.
        if (f.virtual) {
            const items = shown.map((label, i) => ({
                label, ariaLabel: label, index: i, id: label,
                isSelected: false,
                onSelect: (arg) => { if (Array.isArray(arg) && arg[0]) commit(f, String(arg[0].label)); },
            }));
            list['__reactFiber$harness'] = { return: null, alternate: null, memoizedProps: { items }, memoizedState: null };
        }
    }

    // How the search decides a row is a hit. A plain field matches by SUBSTRING,
    // all the DOM-filter ever modelled. A VIRTUAL field matches by shared WORD —
    // the way a real server search does — so a reordered name ("Management and
    // Marketing") surfaces for a candidate's "Marketing and Management", which is
    // exactly the reorder case sameConcept has to answer.
    const searchHit = (f, entry, filter) => {
        const q = String(filter).toLowerCase();
        if (!f.virtual) return entry.toLowerCase().includes(q);
        const toks = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
        const qt = new Set(toks(q));
        return toks(entry).some((t) => qt.has(t));
    };

    function openFor(f, { filter = null } = {}) {
        // An Enter that lands while the click's open is still in flight is a
        // search all the same — the live widget queues it, so the harness does.
        if (opening.has(f)) {
            if (filter !== null && String(filter).trim()) setTimeout(() => openFor(f, { filter }), cfg.openMs + 2);
            return;
        }
        // ENTER RE-RUNS THE SEARCH, IN PLACE — measured on the live form: the
        // click opens the list, typing filters nothing by itself, and Enter
        // replaces the list's contents with the new results. The old guard
        // swallowed that second call entirely, so a harness field opened by a
        // click could never receive search results at all — which hid the whole
        // free-text path from every test.
        if (openLists.has(f)) {
            if (filter === null || !String(filter).trim()) return;
            let shown = f.catalogue.filter((s) => searchHit(f, s, filter));
            if (f.multi) shown = [...shown, String(filter)];
            const list = openLists.get(f);
            setTimeout(() => {
                fillList(f, list, shown);
                // SINGLE-select: a search that finds exactly one row commits it on
                // Enter alone (measured, Field of Study R-172558). Several rows
                // filter but commit nothing — the exact row must be clicked.
                if (f.singleChip && shown.length === 1) commit(f, shown[0]);
                // A slow server: the filtered rows land AFTER the list the click
                // opened has been on the page a while — so a reader that settles
                // on the initial list would mistake it for the search result.
            }, cfg.openMs + (f.searchDelayMs || 0));
            return;
        }
        if (!cfg.sticky) closeEveryList();
        // A search prompt answers a TERM. Typing nothing shows nothing, which is
        // what makes the employer's taxonomy searchable rather than browsable.
        let shown = filter === null
            ? (f.initialSet || f.catalogue)   // a click can open an initial list (decoy/window) unlike the search
            : f.catalogue.filter((s) => searchHit(f, s, filter));
        if (filter !== null && !String(filter).trim()) return;
        // A MULTI-SELECT SEARCH ENDS WITH A CREATE ROW — measured on the live
        // form (R-170139, 2026-08-10): the last item of every result list is
        // the typed text verbatim, and picking it commits the candidate's own
        // words as a free-text skill. The harness mirrors it so the free-text
        // path is testable; single-selects (Degree, Language) have no such row.
        if (f.multi && filter !== null && String(filter).trim()) shown = [...shown, String(filter)];
        opening.add(f);
        setTimeout(() => {
            opening.delete(f);
            const list = el('div', {
                'data-automation-id': 'activeListContainer',
                role: 'listbox',
                id: `hostile-list-${++listSeq}`,
            });
            // Portalled: the body, never the field's own wrapper.
            doc.body.appendChild(list);
            fillList(f, list, shown);
            // Same one-result Enter-commit as the re-run branch, for the case the
            // term's search opens the list fresh rather than re-running an open one.
            if (f.singleChip && filter !== null && shown.length === 1) commit(f, shown[0]);

            if (f.stamps) {
                f.trigger.setAttribute('aria-expanded', 'true');
                f.trigger.setAttribute('aria-controls', list.id);
            }
            if (f.escapeCloses) {
                // Scoped: the handler lives on the widget, so a key aimed at the
                // body never reaches it.
                const onKey = (e) => { if (e.key === 'Escape') closeList(f); };
                list.addEventListener('keydown', onKey);
                f.trigger.addEventListener('keydown', onKey);
                if (!cfg.scopedEscape) doc.addEventListener('keydown', onKey);
            }
            if (f.outsideClickCloses) {
                doc.addEventListener('click', (e) => {
                    if (e.target === list || list.contains(e.target) || e.target === f.trigger) return;
                    closeList(f);
                });
            }
            openLists.set(f, list);
        }, cfg.openMs);
    }

    /** A stable 32-hex id for an option label — same answer, same string. */
    function fakeGuid(label) {
        let h = 0x811c9dc5;
        for (let i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(16).padStart(8, '0').repeat(4);
    }

    /** The chip list, created the moment there is a chip to put in it. */
    function chipListOf(f) {
        if (!f.chips) f.chips = el('div', { 'data-automation-id': 'selectedItemList' }, f.wrap);
        return f.chips;
    }

    function commit(f, label) {
        setTimeout(() => {
            if (f.singleChip) {
                // SINGLE-select chip-search: the new chip REPLACES the old one
                // (never accumulates), and the list closes on the pick — the
                // measured Field of Study behavior. `keepOpenOnCommit` holds it
                // open so a test can prove the commit is read from the CHIP, not
                // from the list having closed.
                const listEl = chipListOf(f);
                [...(listEl.children || [])].forEach((c) => c.remove());
                const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, listEl);
                chip.textContent = label;
                if (!f.keepOpenOnCommit) closeList(f, { after: 0 });
                f.committed.push(label);
                return;
            }
            if (f.multi) {
                // A chip that also answers the option selector — and the list
                // stays open, as a multi-select does. The chip LIST arrives with
                // the first chip, which is when the live form creates it.
                //
                // `misbehave` is how the two ways a pick can go wrong are made
                // reproducible: a catalogue row that answers for a GROUP (one
                // click, several chips), and a virtualiser that swaps the row
                // out between reading it and clicking it (a chip nobody asked
                // for — measured once as "Agentforce" / "Agile Systems").
                for (const text of (f.instead ? [f.instead] : [label, ...(f.alsoAdds || [])])) {
                    const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, chipListOf(f));
                    chip.textContent = text;
                    // Every live chip carries its delete charm; the engine's
                    // rollback (its own misfire only) removes through it.
                    const charm = el('div', { 'data-automation-id': 'DELETE_charm' }, chip);
                    charm.addEventListener('click', () => chip.remove());
                }
            } else {
                f.trigger.textContent = label;
                // Workday's bookkeeping, written alongside the visible answer:
                // one GUID per OPTION, so two rows holding the same choice hold
                // the same string.
                if (f.guid) f.guid.value = fakeGuid(label);
                closeList(f, { after: 0 });
            }
            f.committed.push(label);
        }, cfg.commitMs);
    }

    /** One prompt widget, wherever it lives: the page, or a row of a section. */
    function makeField({
        automationId, tag, catalogue, stamps, label = null, parent = page,
        multi = false, singleChip = false, keepOpenOnCommit = false,
        initialSet = null, searchDelayMs = 0, virtual = false, renderCap = 0,
        escapeCloses = true, outsideClickCloses = false,
    }) {
        const wrap = el('div', { 'data-automation-id': automationId }, parent);
        if (label) el('label', {}, wrap).textContent = label;
        // A MULTI-SELECT IS ONE BEFORE IT HAS AN ANSWER.
        //
        // This harness used to render the chip list up front, which made an
        // empty multi-select look like an answered one — and the fixture is why
        // the real defect passed every test. MEASURED on the live form
        // (R-174102, My Experience, 2026-08-09): an empty Skills field carries
        // `multiSelectContainer` / data-uxi-widget-type="multiselect" and NO
        // selectedItemList at all; Workday creates the chip list with the first
        // chip. So the container is rendered here from the start and the chip
        // list is created on the first commit, exactly as the page does it.
        // A single-select chip-search (Field of Study) renders the SAME
        // container as a multi-select — measured byte-identical, R-172558 vs
        // R-173186 — which is the whole reason its capability is routed by the
        // plan's contract and not by the fingerprint.
        if (multi || singleChip) {
            el('div', {
                'data-automation-id': 'multiSelectContainer',
                'data-uxi-widget-type': 'multiselect',
            }, wrap);
        }
        const chips = null;
        const trigger = el(tag, tag === 'button' ? { 'aria-haspopup': 'listbox' } : { type: 'text' }, wrap);
        if (tag === 'button') trigger.textContent = 'Select One';
        // A PROMPT'S HIDDEN INPUT HOLDS A GUID, NOT THE ANSWER.
        //
        // MEASURED (R-174102, My Experience, 2026-08-09): three Language rows
        // each displayed "Vietnamese" on their button while every one of their
        // inputs read `05fb736b3afb01d98f0cecaeb500d269` — the GUID of the
        // OPTION, so rows holding the same answer are indistinguishable by it.
        // The harness had no such input at all, which is why a planner keyed on
        // it looked correct here and grew a row per pass on the real form.
        const guid = tag === 'button' ? el('input', { type: 'text' }, wrap) : null;
        const f = {
            wrap, trigger, chips, catalogue, stamps, multi, singleChip, keepOpenOnCommit, guid,
            initialSet, searchDelayMs, virtual, renderCap,
            escapeCloses, outsideClickCloses, committed: [],
        };
        // THE WIDGET'S OWN COMMIT HANDLER, on the trigger's fiber — the shape
        // readSkillsOnSelect walks to on the live form (measured 2026-08-13:
        // props with onSelect(valuesArray) + values, each value {label, id}).
        // The data-write path is real engine surface now — same-text twins and
        // unpaintable rows commit through it — so the harness models the
        // handler the way it models the checkbox: a write lands in the same
        // commit() a click lands in, misbehaviour and all. The values getter
        // reads f.chips WITHOUT creating it (an empty multi has no chip list,
        // and making one on a read is the exact fixture bug this file fixed).
        if (multi) {
            trigger['__reactFiber$harness'] = {
                return: null,
                memoizedProps: {
                    get values() {
                        return [...((f.chips && f.chips.children) || [])]
                            .map((c) => ({ label: c.textContent, id: c.textContent }));
                    },
                    onSelect: (vals) => {
                        const it = Array.isArray(vals) ? vals[vals.length - 1] : null;
                        if (it) commit(f, String(it.label));
                    },
                },
            };
        }
        trigger.addEventListener('click', () => {
            if (openLists.has(f) && f.stamps) { closeList(f); return; }   // a stamped trigger toggles
            openFor(f);
        });
        if (tag === 'input') {
            // Typing a term and pressing Enter is how a search prompt is opened;
            // the results are what the term found, not the catalogue.
            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') openFor(f, { filter: trigger.value });
            });
            // Measured on SmartRecruiters: a search list gives itself up when the
            // box loses focus. Used here as the rung it is.
            trigger.addEventListener('focusout', () => closeList(f));
        }
        return f;
    }

    const addField = (name, opts) => { fields[name] = makeField(opts); return fields[name]; };

    // ── Education and Languages, the other two repeating sections ─────
    const eduRows = [];
    const langRows = [];
    let guidSeq = 0;

    function addEducationRow({ school = '', degree = null, withGpa = false } = {}) {
        const row = el('div', {}, eduSection);
        const schoolInput = textControl(el('div', { 'data-automation-id': 'formField-schoolName' }, row));
        schoolInput.value = school;
        const degreeField = makeField({
            automationId: 'formField-degree', tag: 'button', catalogue: DEGREES,
            stamps: true, label: 'Degree', parent: row,
        });
        if (degree) { degreeField.trigger.textContent = degree; degreeField.guid.value = fakeGuid(degree); }
        const model = { row, schoolInput, degree: degreeField };
        // "Overall Result (GPA)" renders on the intern postings and not the
        // executive ones — opt-in here so a test can exercise both.
        if (withGpa) {
            const w = el('div', { 'data-automation-id': 'formField-gradeAverage' }, row);
            el('label', {}, w).textContent = 'Overall Result (GPA)';
            model.gpa = textControl(w);
        }
        eduRows.push(model);
        return model;
    }

    function addLanguageRow({ language = null, fluent = false, overall = null } = {}) {
        const row = el('div', {}, langSection);
        const langField = makeField({
            automationId: 'formField-language', tag: 'button', catalogue: LANGUAGES,
            stamps: true, label: 'Language', parent: row,
        });
        // Seeded the way a commit leaves it: the answer on the button, the
        // option's GUID in the hidden input.
        if (language) { langField.trigger.textContent = language; langField.guid.value = fakeGuid(language); }
        const nativeWrap = el('div', { 'data-automation-id': 'formField-native' }, row);
        el('label', {}, nativeWrap).textContent = 'I am fluent in this language';
        const box = el('input', { type: 'checkbox' }, nativeWrap);
        box.checked = fluent;
        box.addEventListener('click', () => { box.checked = !box.checked; });
        // Overall proficiency: a per-tenant GUID instead of an id, so the only
        // way in is its label, inside this row.
        const overallField = makeField({
            automationId: `formField-${(++guidSeq).toString(16)}c41e9a-${guidSeq}`,
            tag: 'button', catalogue: LEVELS, stamps: true, label: 'Overall', parent: row,
        });
        if (overall) overallField.trigger.textContent = overall;
        const model = { row, language: langField, box, overall: overallField };
        langRows.push(model);
        return model;
    }

    // ── the Add buttons, one per section ─────────────────────────────
    const ignoredAdds = [];

    /**
     * "Add Another", with the measured failure built in: a click aimed at a
     * control below the fold hit-tests as whatever covers that point, and the
     * row never appears. Scroll it into view first or nothing happens.
     */
    function addButtonIn(section, make) {
        const btn = el('button', { 'data-automation-id': 'add-button' }, section);
        btn.textContent = 'Add Another';
        btn.addEventListener('click', () => {
            if (!btn.scrollIntoViewCount) { ignoredAdds.push(section); return; }
            setTimeout(() => make(), cfg.openMs);
        });
        return btn;
    }
    addButtonIn(workSection, () => addWorkRow({}));
    if (eduSection) addButtonIn(eduSection, () => addEducationRow({}));
    addButtonIn(langSection, () => addLanguageRow({}));

    // Skills: the search box whose leftovers were the 20 orphans.
    addField('skills', { automationId: 'formField-skills', tag: 'input', catalogue: SKILLS, stamps: false, multi: true });
    // Degree: a button prompt, and it stamps its trigger.
    addField('degree', { automationId: 'formField-degree', tag: 'button', catalogue: DEGREES, stamps: true });
    // "How did you hear about us" — stamps, but its list is deaf to Escape and
    // gives up only on an outside click.
    addField('source', {
        automationId: 'formField-source', tag: 'button', catalogue: LANGUAGES,
        stamps: true, escapeCloses: false, outsideClickCloses: true,
    });

    return {
        cfg,
        fields,
        page,
        addWorkRow,
        addEducationRow,
        /** How many times Next was pressed, and where it went. */
        nav,
        addLanguageRow,
        workRows: () => rows,
        eduRows: () => eduRows,
        langRows: () => langRows,
        sections: { work: workSection, education: eduSection, languages: langSection },
        /** Adds that hit-tested into whatever was covering the button. */
        ignoredAdds,
        /** Everything a date section was sent and refused — the FORBIDDEN proof. */
        dateKeys,
        dateWrites,
        pickerOpen: () => pickerFor.size,
        /** A chip that was already there — the candidate's own, not ours to touch. */
        seedChip(name, label) {
            const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, chipListOf(fields[name]));
            chip.textContent = label;
            return chip;
        },
        /** The list a page-level field currently has open, if any. */
        listFor: (name) => openLists.get(fields[name]) || null,
        openCount: () => openLists.size,
        chipsOn: (name) => [...(fields[name].chips?.children || [])].map((c) => c.textContent),
        /**
         * A single-select chip-search (Field of Study), added on demand. Same
         * container/placeholder DOM as Skills — the fingerprint cannot tell them
         * apart — but single-select: one result commits on Enter, several must be
         * clicked, and a new chip REPLACES the old. `keepOpenOnCommit` leaves the
         * list open after the pick so a test can prove the commit is read from the
         * chip, not from the list closing.
         */
        addFieldOfStudy(catalogue, { keepOpenOnCommit = false, initialSet = null, searchDelayMs = 0, virtual = false, renderCap = 0 } = {}) {
            return addField('fieldOfStudy', {
                automationId: 'formField-fieldOfStudy', tag: 'input',
                catalogue, stamps: false, singleChip: true, keepOpenOnCommit,
                initialSet, searchDelayMs, virtual, renderCap,
            });
        },
        /**
         * Make a multi-select pick badly, on purpose.
         *
         * `alsoAdds` — one click, several chips (a group row).
         * `instead`  — the row moved under the click, so a different chip lands.
         */
        misbehave(name, { alsoAdds = null, instead = null } = {}) {
            fields[name].alsoAdds = alsoAdds;
            fields[name].instead = instead;
        },
        /**
         * A list nobody owns, left over from a field that is gone.
         *
         * With no options it is closeable only by `outsideClick`, which is the
         * shape that reaches the bottom rung of the ladder: no expanded trigger
         * to Escape at or collapse, and a list that ignores keys. Default —
         * nothing closes it at all — is for proving the scheduler stops instead
         * of opening the next widget underneath it.
         */
        wedgeOpenList(count = 4, { outsideClick = false } = {}) {
            const list = el('div', {
                'data-automation-id': 'activeListContainer', role: 'listbox', id: `hostile-wedge-${++listSeq}`,
            });
            doc.body.appendChild(list);
            for (let i = 0; i < count; i++) {
                el('div', { role: 'option', 'data-automation-id': OPT_ID }, list).textContent = `Wedged ${i + 1}`;
            }
            if (outsideClick) {
                doc.addEventListener('click', (e) => {
                    if (e.target === list || list.contains(e.target)) return;
                    setTimeout(() => list.remove(), cfg.closeMs);
                });
            }
            return list;
        },
    };
}
