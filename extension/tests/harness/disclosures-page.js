/**
 * Voluntary Disclosures, with the wordings that each cost a run.
 *
 *  · GENDER offers Female / Male / "Not Specified" / Other — Mondelez's list,
 *    measured. Visa's says "Not Declared" instead, and that phrasing alone
 *    stalled two runs, so it is a switch here.
 *  · RACE/ETHNICITY on a VN tenant is the country's ethnic-group catalogue and
 *    carries NO decline row at all. That is the case where the right answer is
 *    to leave the field alone.
 *  · THE TERMS BOX is ticked; the MARKETING box beside it must not be. The
 *    wording is the only thing telling them apart, which is why the marketing
 *    exclusion is checked first.
 */

const OPT = 'promptOption';

export const GENDER_MDLZ = ['Female', 'Male', 'Not Specified', 'Other'];
export const GENDER_VISA = ['Female', 'Male', 'Not Declared'];
/** A VN ethnic-group catalogue: no decline row anywhere in it. */
export const ETHNICITY_VN = ['Kinh', 'Hoa', 'Tày', 'Thái', 'Mường', 'Khmer', 'Nùng'];
/**
 * Primary Nationality as Maersk renders it: a listbox of COUNTRY names, all in
 * the DOM at once (measured R192834: 251 options, not virtualised), so the value
 * is a country noun ("Vietnam"), never a demonym. No decline row.
 */
export const NATIONALITY_COUNTRIES = ['Afghanistan', 'Albania', 'United States of America', 'United Kingdom', 'Vietnam'];

export function buildDisclosuresPage(doc, opts = {}) {
    const cfg = {
        genders: GENDER_MDLZ,
        ethnicities: ETHNICITY_VN,
        marketingBox: true,
        openMs: 5,
        commitMs: 15,
        navMs: 20,
        nextPageId: 'applyFlowReviewPage',
        ...opts,
    };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowVoluntaryDisclosuresPage' }, doc.body);
    const nav = { clicks: 0 };
    const next = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page);
    next.textContent = 'Save and Continue';
    next.addEventListener('click', () => {
        nav.clicks += 1;
        setTimeout(() => { page.remove(); el('div', { 'data-automation-id': cfg.nextPageId }, doc.body); }, cfg.navMs);
    });

    const state = { picked: {} };
    const open = new Map();
    const closeFor = (owner) => {
        const list = open.get(owner);
        if (!list) return;
        open.delete(owner);
        list.remove();
        owner.removeAttribute('aria-expanded');
    };

    function prompt(id, label, items) {
        const wrap = el('div', { 'data-automation-id': id }, page);
        el('label', {}, wrap).textContent = label;
        const btn = el('button', { 'aria-haspopup': 'listbox' }, wrap);
        btn.textContent = 'Select One';
        btn.addEventListener('click', () => {
            if (open.has(btn)) { closeFor(btn); return; }
            setTimeout(() => {
                const list = el('div', { 'data-automation-id': 'activeListContainer', role: 'listbox' }, doc.body);
                for (const text of items) {
                    const o = el('div', { role: 'option', 'data-automation-id': OPT }, list);
                    o.textContent = text;
                    o.addEventListener('click', () => setTimeout(() => {
                        btn.textContent = text;
                        state.picked[id] = text;
                        closeFor(btn);
                    }, cfg.commitMs));
                }
                btn.setAttribute('aria-expanded', 'true');
                const onKey = (e) => { if (e.key === 'Escape') closeFor(btn); };
                list.addEventListener('keydown', onKey);
                btn.addEventListener('keydown', onKey);
                open.set(btn, list);
            }, cfg.openMs);
        });
        return btn;
    }

    function checkbox(id, text) {
        const wrap = el('div', { 'data-automation-id': id }, page);
        el('label', {}, wrap).textContent = text;
        const box = el('input', { type: 'checkbox' }, wrap);
        box.addEventListener('click', () => { box.checked = !box.checked; });
        return box;
    }

    /**
     * Date of Birth, as measured on Maersk: three role=spinbutton inputs that are
     * CONTROLLED — a React-style write (native value setter, what setNativeValue
     * does) is ACCEPTED and reflected in aria-valuenow. This is the opposite of
     * the month/year picker's spinbuttons, which refuse every synthetic write.
     * `initial` pre-fills it, the way a resumed draft carries the candidate's own.
     */
    function dobField(id, initial) {
        const wrap = el('div', { 'data-automation-id': id }, page);
        el('label', {}, wrap).textContent = 'Date of Birth';
        const mk = (segId, label, init) => {
            const input = el('input', { 'data-automation-id': segId, role: 'spinbutton', type: 'text', 'aria-label': label }, wrap);
            let held = '';
            if (init != null) { held = String(init); input.setAttribute('aria-valuenow', String(init)); }
            Object.defineProperty(input, 'value', {
                get: () => held,
                set: (v) => {
                    held = String(v);
                    const num = held.trim();
                    if (num === '') input.removeAttribute('aria-valuenow');
                    else input.setAttribute('aria-valuenow', String(Number(num)));
                },
                configurable: true,
            });
            return input;
        };
        return {
            month: mk('dateSectionMonth-input', 'Month', initial?.month),
            day: mk('dateSectionDay-input', 'Day', initial?.day),
            year: mk('dateSectionYear-input', 'Year', initial?.year),
        };
    }

    const gender = prompt('formField-gender', 'Gender', cfg.genders);
    const ethnicity = prompt('formField-ethnicity', 'Race/Ethnicity', cfg.ethnicities);
    // Opt-in, like dob: only the tenants that render a required Primary
    // Nationality (Maersk) build one, so every existing test's page is unchanged.
    const nationality = cfg.nationality ? prompt('formField-nationality', 'Primary Nationality', cfg.nationality) : null;
    // Opt-in, so the tenants that do not render a DOB (every existing test) still
    // build the page they measured. cfg.dob === true → an empty required field;
    // cfg.dob === { month, day, year } → a resumed draft that already carries it.
    const dob = cfg.dob ? dobField('formField-dateOfBirth', cfg.dob === true ? null : cfg.dob) : null;
    const terms = checkbox('formField-acceptTermsAndAgreements',
        'I have read and agree to the Terms and Conditions and the Privacy Notice');
    const marketing = cfg.marketingBox
        ? checkbox('formField-marketingOptIn',
            'I would like to receive marketing updates and job alerts from Mondelēz')
        : null;

    return {
        cfg, page, nav, state,
        gender, ethnicity, nationality, dob, terms, marketing,
        picked: () => state.picked,
    };
}
