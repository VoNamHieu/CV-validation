/**
 * My Information, built from what was measured on it.
 *
 *  · COUNTRY RE-RENDERS the region and postal fields. Here it really does:
 *    picking a country replaces those nodes, so anything holding one is holding
 *    a corpse — which is the whole reason the controller re-resolves at run time
 *    and the whole reason Country goes first.
 *  · PROVINCE IS TWO WIDGETS behind one automation id: a button listbox on 3M,
 *    a searchable input (placeholder "Search") on Mondelez. Both are built here,
 *    switchable, because the capability has to be resolved from the shape.
 *  · THE RADIO'S INPUT IS INVISIBLE under a styled control, so the click has to
 *    land on the label. An executor that clicks the input clicks nothing.
 *  · COUNTRY PHONE CODE commits as a CHIP. Typing into it without committing
 *    leaves "0 items selected", which blocks Next silently.
 *  · THE EMAIL BOX is read-only and holds the account's address. Nothing should
 *    touch it; the harness records it if anything does.
 */

const OPT = 'promptOption';

export const COUNTRIES = ['Vietnam', 'Thailand', 'Singapore', 'United States'];
export const PROVINCES = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng'];
export const PHONE_TYPES = ['Mobile - Personal', 'Mobile - Work', 'Telephone - Office', 'Telephone - Personal'];
export const PHONE_CODES = ['Vietnam (+84)', 'Thailand (+66)', 'Singapore (+65)'];

export function buildMyInfoPage(doc, opts = {}) {
    const cfg = {
        provinceAs: 'search',     // 'search' (Mondelez) | 'button' (3M)
        localNames: false,        // dual-script tenants render a second pair
        commitMs: 15,
        rerenderMs: 60,      // the replacement lands after the pick, not with it
        openMs: 5,
        navMs: 20,
        nextPageId: 'applyFlowMyExpPage',
        ...opts,
    };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowMyInfoPage' }, doc.body);
    const nav = { clicks: 0 };
    const next = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page);
    next.textContent = 'Save and Continue';
    next.addEventListener('click', () => {
        nav.clicks += 1;
        setTimeout(() => { page.remove(); el('div', { 'data-automation-id': cfg.nextPageId }, doc.body); }, cfg.navMs);
    });

    const state = { emailWrites: 0, rerenders: 0 };
    const field = (id, parent = page) => el('div', { 'data-automation-id': id }, parent);
    const textField = (id) => {
        const input = el('input', { type: 'text' }, field(id));
        return input;
    };

    // ── the radio, with the input hidden under a styled control ───────
    const radioWrap = field('formField-candidateIsPreviousWorker');
    el('legend', {}, radioWrap).textContent = 'Have you previously worked for this organization?';
    const radios = ['Yes', 'No', 'Not applicable'].map((label, i) => {
        const input = el('input', { type: 'radio', name: 'prev', id: `prev-${i}` }, radioWrap);
        input.hidden = true;                       // the real control is invisible
        const lab = el('label', { for: `prev-${i}` }, radioWrap);
        lab.textContent = label;
        lab.addEventListener('click', () => {
            radios.forEach((r) => { r.input.checked = false; });
            input.checked = true;
        });
        return { input, label: lab, text: label };
    });

    // ── names ─────────────────────────────────────────────────────────
    const firstName = textField('formField-legalName--firstName');
    const lastName = textField('formField-legalName--lastName');
    const firstLocal = cfg.localNames ? textField('formField-legalName--firstNameLocal') : null;
    const lastLocal = cfg.localNames ? textField('formField-legalName--lastNameLocal') : null;

    // ── the email box nothing may write to ────────────────────────────
    const email = el('input', { type: 'text', readonly: 'true' }, field('formField-email'));
    let emailHeld = 'someone@example.com';
    Object.defineProperty(email, 'value', {
        get: () => emailHeld,
        set: () => { state.emailWrites += 1; },   // recorded, never accepted
        configurable: true,
    });

    // ── list machinery, shared by the prompts here ────────────────────
    const open = new Map();
    const closeFor = (owner) => {
        const list = open.get(owner);
        if (!list) return;
        open.delete(owner);
        list.remove();
        owner.removeAttribute('aria-expanded');
    };
    function openFor(owner, items, onPick, filter = null) {
        if (open.has(owner)) return;
        const shown = filter === null ? items
            : items.filter((s) => s.toLowerCase().includes(String(filter).toLowerCase()));
        if (filter !== null && !String(filter).trim()) return;
        setTimeout(() => {
            const list = el('div', { 'data-automation-id': 'activeListContainer', role: 'listbox' }, doc.body);
            for (const label of shown) {
                const o = el('div', { role: 'option', 'data-automation-id': OPT }, list);
                o.textContent = label;
                o.addEventListener('click', () => setTimeout(() => onPick(label, owner), cfg.commitMs));
            }
            owner.setAttribute('aria-expanded', 'true');
            const onKey = (e) => { if (e.key === 'Escape') closeFor(owner); };
            list.addEventListener('keydown', onKey);
            owner.addEventListener('keydown', onKey);
            open.set(owner, list);
        }, cfg.openMs);
    }

    /** A button prompt: pick sets the button's text and closes. */
    function buttonPrompt(id, items, onCommit) {
        const btn = el('button', { 'aria-haspopup': 'listbox' }, field(id));
        btn.textContent = 'Select One';
        btn.addEventListener('click', () => {
            if (open.has(btn)) { closeFor(btn); return; }
            openFor(btn, items, (label) => { btn.textContent = label; closeFor(btn); onCommit?.(label); });
        });
        return btn;
    }

    /** A searchable single-select: commits INTO ITS OWN BOX, no chip, no button. */
    function searchPrompt(id, items) {
        const input = el('input', { type: 'text', placeholder: 'Search' }, field(id));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') openFor(input, items, (label) => { input.value = label; closeFor(input); }, input.value);
        });
        return input;
    }

    /** A token multi-select: commits as a CHIP, and only a chip counts. */
    function tokenPrompt(id, items) {
        const wrap = field(id);
        const chips = el('div', { 'data-automation-id': 'selectedItemList' }, wrap);
        const input = el('input', { type: 'text', placeholder: 'Search' }, wrap);
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            openFor(input, items, (label) => {
                const chip = el('div', { 'data-automation-id': 'selectedItem', role: 'option' }, chips);
                chip.textContent = label;
                closeFor(input);
            }, input.value);
        });
        return { input, chips };
    }

    // ── the address block, which Country replaces ─────────────────────
    let addressLine1 = textField('formField-addressLine1');
    let city = textField('formField-city');
    let postal = textField('formField-postalCode');
    let province = cfg.provinceAs === 'button'
        ? buttonPrompt('formField-countryRegion', PROVINCES)
        : searchPrompt('formField-countryRegion', PROVINCES);

    const country = buttonPrompt('formField-country', COUNTRIES, () => {
        // MEASURED: picking a country re-renders the region and postal fields.
        // Every node below is replaced — anything holding one is holding a
        // corpse.
        // MEASURED: picking a country re-renders THE REGION AND POSTAL fields.
        // Not the whole page — that would be a different (easier) problem, and
        // modelling more than was measured proves nothing.
        setTimeout(() => {
            [postal, province].forEach((n) => n?.parentNode?.remove());
            province = cfg.provinceAs === 'button'
                ? buttonPrompt('formField-countryRegion', PROVINCES)
                : searchPrompt('formField-countryRegion', PROVINCES);
            postal = textField('formField-postalCode');
            state.rerenders += 1;
        }, cfg.rerenderMs);
    });

    const phoneType = buttonPrompt('formField-phoneType', PHONE_TYPES);
    const phoneCode = tokenPrompt('formField-countryPhoneCode', PHONE_CODES);
    const phoneNumber = textField('formField-phoneNumber');

    return {
        cfg, page, nav, state,
        radios,
        firstName, lastName, firstLocal, lastLocal,
        email,
        country,
        phoneType,
        phoneCode,
        phoneNumber,
        rerenders: () => state.rerenders,
        emailWrites: () => state.emailWrites,
        /** Re-read, because Country replaces these. */
        addressLine1: () => page.querySelector('[data-automation-id="formField-addressLine1"]')?.querySelector('input'),
        city: () => page.querySelector('[data-automation-id="formField-city"]')?.querySelector('input'),
        postal: () => page.querySelector('[data-automation-id="formField-postalCode"]')?.querySelector('input'),
        province: () => page.querySelector('[data-automation-id="formField-countryRegion"]')
            ?.querySelector(cfg.provinceAs === 'button' ? 'button' : 'input'),
        chipsOnPhoneCode: () => [...phoneCode.chips.children].map((c) => c.textContent),
    };
}
