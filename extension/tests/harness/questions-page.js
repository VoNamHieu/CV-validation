/**
 * Application Questions, with the property that defines it.
 *
 * MEASURED: every field on this step has a PER-JOB DYNAMIC automation id. So the
 * harness generates ids nothing could hard-code, and a controller that reaches
 * for one finds nothing — a question is found by its own text or not at all.
 *
 * The three Mondelez asks on every job are here with the phrasings measured on
 * R-173278, plus the two text questions and a CONDITIONAL detail box: answering
 * "Yes" to the relatives question renders it, answering "No" leaves it absent.
 * That branch is why the question list is discovered every pass instead of
 * planned once.
 */

const OPT = 'promptOption';
let seq = 0;

export const YES_NO = ['Yes', 'No'];

export function buildQuestionsPage(doc, opts = {}) {
    const cfg = { openMs: 5, commitMs: 15, navMs: 20, nextPageId: 'applyFlowVoluntaryDisclosuresPage', ...opts };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowPrimaryQuestionsPage' }, doc.body);
    const nav = { clicks: 0 };
    const next = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page);
    next.textContent = 'Save and Continue';
    next.addEventListener('click', () => {
        nav.clicks += 1;
        setTimeout(() => { page.remove(); el('div', { 'data-automation-id': cfg.nextPageId }, doc.body); }, cfg.navMs);
    });

    /** A per-job id nothing can hard-code. */
    const dynamicId = () => `formField-${(++seq).toString(16)}f4a1-b7${seq}`;
    const open = new Map();
    const closeFor = (owner) => {
        const list = open.get(owner);
        if (!list) return;
        open.delete(owner);
        list.remove();
        owner.removeAttribute('aria-expanded');
    };

    const state = { committed: {}, conditional: null };

    function prompt(question, items, onPick) {
        const wrap = el('div', { 'data-automation-id': dynamicId() }, page);
        el('label', {}, wrap).textContent = question;
        const btn = el('button', { 'aria-haspopup': 'listbox' }, wrap);
        btn.textContent = 'Select One';
        btn.addEventListener('click', () => {
            if (open.has(btn)) { closeFor(btn); return; }
            setTimeout(() => {
                const list = el('div', { 'data-automation-id': 'activeListContainer', role: 'listbox' }, doc.body);
                for (const label of items) {
                    const o = el('div', { role: 'option', 'data-automation-id': OPT }, list);
                    o.textContent = label;
                    o.addEventListener('click', () => setTimeout(() => {
                        btn.textContent = label;
                        state.committed[question] = label;
                        closeFor(btn);
                        onPick?.(label);
                    }, cfg.commitMs));
                }
                btn.setAttribute('aria-expanded', 'true');
                const onKey = (e) => { if (e.key === 'Escape') closeFor(btn); };
                list.addEventListener('keydown', onKey);
                btn.addEventListener('keydown', onKey);
                open.set(btn, list);
            }, cfg.openMs);
        });
        return { wrap, btn, question };
    }

    function textQuestion(question) {
        const wrap = el('div', { 'data-automation-id': dynamicId() }, page);
        el('label', {}, wrap).textContent = question;
        const input = el('input', { type: 'text' }, wrap);
        return { wrap, input, question };
    }

    const notice = textQuestion('What is your notice period?');
    const salary = textQuestion('What are your salary expectations?');
    const conflict = prompt('Do you have a conflict of interest with Mondelēz?', YES_NO);
    const relatives = prompt('Do you have relatives currently employed by Mondelēz?', YES_NO, (label) => {
        // The conditional branch: "Yes" asks for the detail, and it renders
        // AFTER the answer — which is why the question list is discovered every
        // pass rather than planned once.
        if (label === 'Yes' && !state.conditional) {
            setTimeout(() => { state.conditional = textQuestion('Please provide the name and relationship'); }, cfg.commitMs);
        }
    });
    const visa = prompt('Will you now or in the future require Mondelēz to sponsor a work visa?', YES_NO);

    /** Answer a prompt the way the page itself would, for a test that needs a
     *  branch taken without driving five events to take it. */
    function answerAs(prompt, label) {
        prompt.btn.textContent = label;
        state.committed[prompt.question] = label;
        if (prompt === relatives && label === 'Yes' && !state.conditional) {
            state.conditional = textQuestion('Please provide the name and relationship');
        }
    }

    return {
        cfg, page, nav, state, answerAs,
        notice, salary, conflict, relatives, visa,
        committed: () => state.committed,
        conditional: () => state.conditional,
        /** The ids really are unguessable — a test can prove it. */
        ids: () => [...page.querySelectorAll('[data-automation-id^="formField-"]')]
            .map((w) => w.getAttribute('data-automation-id')),
    };
}
