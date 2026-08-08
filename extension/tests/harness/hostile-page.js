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

    // A Work Experience row, so the step reads as MY_EXPERIENCE and the
    // fingerprint has something real to count.
    const row = el('div', { 'data-automation-id': 'workExperienceRow' }, page);
    el('div', { 'data-automation-id': 'formField-jobTitle' }, row);
    el('div', { 'data-automation-id': 'formField-companyName' }, row);

    const fields = {};
    const openLists = new Map();      // field name → list node
    const opening = new Set();        // a list whose open is scheduled but not landed

    function closeList(name, { after = cfg.closeMs } = {}) {
        const f = fields[name];
        const list = openLists.get(name);
        if (!list) return;
        openLists.delete(name);
        setTimeout(() => {
            list.remove();
            f.trigger.removeAttribute('aria-expanded');
            f.trigger.removeAttribute('aria-controls');
        }, after);
    }

    const closeEveryList = () => [...openLists.keys()].forEach((n) => closeList(n, { after: 0 }));

    function openFor(name) {
        const f = fields[name];
        if (openLists.has(name) || opening.has(name)) return;
        if (!cfg.sticky) closeEveryList();
        opening.add(name);
        setTimeout(() => {
            opening.delete(name);
            const list = el('div', {
                'data-automation-id': 'activeListContainer',
                role: 'listbox',
                id: `hostile-list-${++listSeq}`,
            });
            // Portalled: the body, never the field's own wrapper.
            doc.body.appendChild(list);
            for (const label of f.catalogue) {
                const o = el('div', { role: 'option', 'data-automation-id': OPT_ID }, list);
                o.textContent = label;
                o.addEventListener('click', () => commit(name, label));
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
                const onKey = (e) => { if (e.key === 'Escape') closeList(name); };
                list.addEventListener('keydown', onKey);
                f.trigger.addEventListener('keydown', onKey);
                if (!cfg.scopedEscape) doc.addEventListener('keydown', onKey);
            }
            if (f.outsideClickCloses) {
                doc.addEventListener('click', (e) => {
                    if (e.target === list || list.contains(e.target) || e.target === f.trigger) return;
                    closeList(name);
                });
            }
            openLists.set(name, list);
        }, cfg.openMs);
    }

    function commit(name, label) {
        const f = fields[name];
        setTimeout(() => {
            if (f.multi) {
                // A chip that also answers the option selector — and the list
                // stays open, as a multi-select does.
                const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, f.chips);
                chip.textContent = label;
            } else {
                f.trigger.textContent = label;
                closeList(name, { after: 0 });
            }
            f.committed.push(label);
        }, cfg.commitMs);
    }

    function addField(name, { automationId, tag, catalogue, stamps, multi = false, escapeCloses = true, outsideClickCloses = false }) {
        const wrap = el('div', { 'data-automation-id': automationId }, page);
        const chips = multi ? el('div', { 'data-automation-id': 'selectedItemList' }, wrap) : null;
        const trigger = el(tag, tag === 'button' ? { 'aria-haspopup': 'listbox' } : { type: 'text' }, wrap);
        if (tag === 'button') trigger.textContent = 'Select One';
        fields[name] = {
            name, wrap, trigger, chips, catalogue, stamps, multi,
            escapeCloses, outsideClickCloses, committed: [],
        };
        trigger.addEventListener('click', () => {
            if (openLists.has(name) && fields[name].stamps) { closeList(name); return; }   // a stamped trigger toggles
            openFor(name);
        });
        if (tag === 'input') {
            // Measured on SmartRecruiters: a search list gives itself up when the
            // box loses focus. Used here as the rung it is.
            trigger.addEventListener('focusout', () => closeList(name));
        }
        return fields[name];
    }

    // Skills: the search box whose leftovers were the 20 orphans.
    addField('skills', { automationId: 'formField-skills', tag: 'input', catalogue: SKILLS, stamps: false, multi: true });
    // Degree: a button prompt, and it stamps its trigger.
    addField('degree', { automationId: 'formField-degree', tag: 'button', catalogue: DEGREES, stamps: true });
    // Language: stamps, but its list is deaf to Escape — only an outside click.
    addField('language', {
        automationId: 'formField-language', tag: 'button', catalogue: LANGUAGES,
        stamps: true, escapeCloses: false, outsideClickCloses: true,
    });

    return {
        cfg,
        fields,
        page,
        /** The list a field currently has open, if any. */
        listFor: (name) => openLists.get(name) || null,
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
