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

    const gender = prompt('formField-gender', 'Gender', cfg.genders);
    const ethnicity = prompt('formField-ethnicity', 'Race/Ethnicity', cfg.ethnicities);
    const terms = checkbox('formField-acceptTermsAndAgreements',
        'I have read and agree to the Terms and Conditions and the Privacy Notice');
    const marketing = cfg.marketingBox
        ? checkbox('formField-marketingOptIn',
            'I would like to receive marketing updates and job alerts from Mondelēz')
        : null;

    return {
        cfg, page, nav, state,
        gender, ethnicity, terms, marketing,
        picked: () => state.picked,
    };
}
