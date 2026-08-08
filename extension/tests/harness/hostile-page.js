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
        ...opts,
    };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowMyExpPage' }, doc.body);
    el('button', { 'data-automation-id': 'pageFooterNextButton' }, page).textContent = 'Save and Continue';

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
    const workSection = section(opts.headings === false ? null : 'Work Experience');
    const eduSection = section(opts.headings === false ? null : 'Education');
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
                const node = el('div', { 'data-automation-id': 'errorMessage' }, row);
                node.textContent = text;
                return node;
            },
            clearErrors() {
                row.querySelectorAll('[data-automation-id="errorMessage"]').forEach((e) => e.remove());
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

    function openFor(f, { filter = null } = {}) {
        if (openLists.has(f) || opening.has(f)) return;
        if (!cfg.sticky) closeEveryList();
        // A search prompt answers a TERM. Typing nothing shows nothing, which is
        // what makes the employer's taxonomy searchable rather than browsable.
        const shown = filter === null
            ? f.catalogue
            : f.catalogue.filter((s) => s.toLowerCase().includes(String(filter).toLowerCase()));
        if (filter !== null && !String(filter).trim()) return;
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
            for (const label of shown) {
                const o = el('div', { role: 'option', 'data-automation-id': OPT_ID }, list);
                o.textContent = label;
                o.addEventListener('click', () => commit(f, label));
            }
            // The placeholder is a real option that answers nothing.
            const ph = el('div', { role: 'option', 'data-automation-id': OPT_ID, id: 'select-one' }, list);
            ph.textContent = 'Select One';

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

    function commit(f, label) {
        setTimeout(() => {
            if (f.multi) {
                // A chip that also answers the option selector — and the list
                // stays open, as a multi-select does.
                const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, f.chips);
                chip.textContent = label;
            } else {
                f.trigger.textContent = label;
                closeList(f, { after: 0 });
            }
            f.committed.push(label);
        }, cfg.commitMs);
    }

    /** One prompt widget, wherever it lives: the page, or a row of a section. */
    function makeField({
        automationId, tag, catalogue, stamps, label = null, parent = page,
        multi = false, escapeCloses = true, outsideClickCloses = false,
    }) {
        const wrap = el('div', { 'data-automation-id': automationId }, parent);
        if (label) el('label', {}, wrap).textContent = label;
        const chips = multi ? el('div', { 'data-automation-id': 'selectedItemList' }, wrap) : null;
        const trigger = el(tag, tag === 'button' ? { 'aria-haspopup': 'listbox' } : { type: 'text' }, wrap);
        if (tag === 'button') trigger.textContent = 'Select One';
        const f = {
            wrap, trigger, chips, catalogue, stamps, multi,
            escapeCloses, outsideClickCloses, committed: [],
        };
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

    function addEducationRow({ school = '', degree = null } = {}) {
        const row = el('div', {}, eduSection);
        const schoolInput = textControl(el('div', { 'data-automation-id': 'formField-schoolName' }, row));
        schoolInput.value = school;
        const degreeField = makeField({
            automationId: 'formField-degree', tag: 'button', catalogue: DEGREES,
            stamps: true, label: 'Degree', parent: row,
        });
        if (degree) degreeField.trigger.textContent = degree;
        const model = { row, schoolInput, degree: degreeField };
        eduRows.push(model);
        return model;
    }

    function addLanguageRow({ language = null, fluent = false, overall = null } = {}) {
        const row = el('div', {}, langSection);
        const langField = makeField({
            automationId: 'formField-language', tag: 'button', catalogue: LANGUAGES,
            stamps: true, label: 'Language', parent: row,
        });
        if (language) langField.trigger.textContent = language;
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
    addButtonIn(eduSection, () => addEducationRow({}));
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
            const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, fields[name].chips);
            chip.textContent = label;
            return chip;
        },
        /** The list a page-level field currently has open, if any. */
        listFor: (name) => openLists.get(fields[name]) || null,
        openCount: () => openLists.size,
        chipsOn: (name) => [...(fields[name].chips?.children || [])].map((c) => c.textContent),
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
