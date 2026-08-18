// DOM safety invariants for safeActivate (node --test, no deps).
//
// policy.test.js pins the VOCABULARY; this pins the MECHANISM. Every bug the
// re-review found lived in the gap between them: the policy said no and the DOM
// layer clicked anyway, or the policy was asked about one element while a
// different one received the click. Those are not expressible as descriptor
// tests, so they need a DOM — a small hand-built one rather than a jsdom
// dependency, because the surface safeActivate touches is tiny and explicit.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── minimal DOM ────────────────────────────────────────────────────────────
class FakeEl {
    constructor(tag = 'button', props = {}) {
        this.tagName = tag.toUpperCase();
        this.attrs = {};
        this.children = [];
        this.parentNode = null;
        this.clicks = 0;
        this.events = [];
        this.checked = false;
        this.box = { left: 0, top: 0, width: 100, height: 20, bottom: 20, right: 100 };
        Object.assign(this, props);
    }
    getBoundingClientRect() { return this.box; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    dispatchEvent(e) { this.events.push(e.type); return true; }
    click() { this.clicks++; this.events.push('click'); }
    scrollIntoView() { }
    contains(other) {
        if (other === this) return true;
        return this.children.some(c => c.contains && c.contains(other));
    }
    closest() { return null; }
    append(child) { child.parentNode = this; this.children.push(child); return child; }
    get textContent() { return this._text ?? ''; }
    set textContent(v) { this._text = v; }
}

/** Install a document whose elementsFromPoint returns `stack` (topmost first). */
function installDom(stack = [], { formFields = [], url = 'https://boards.example.com/job/123' } = {}) {
    globalThis.window = { innerHeight: 800 };
    globalThis.innerHeight = 800;
    globalThis.location = { href: url };
    globalThis.document = {
        elementsFromPoint: () => stack,
        elementFromPoint: () => stack[0] || null,
        querySelector: () => null,
        // isApplicationFormPage() counts visible fillable fields through this.
        querySelectorAll: () => formFields,
        getElementById: () => null,
    };
    // safeActivate builds these; they only need to carry a `type`.
    globalThis.PointerEvent = class { constructor(type) { this.type = type; } };
    globalThis.MouseEvent = class { constructor(type) { this.type = type; } };
    globalThis.CSS = { escape: (s) => s };
}

const { safeActivate } = await import('../src/content-agent/dom.js');

const planner = { source: 'planner' };

beforeEach(() => installDom([]));

// ── exactly one activation ─────────────────────────────────────────────────
describe('safeActivate fires once', () => {
    test('a permitted click produces exactly one click', () => {
        const btn = new FakeEl('button'); btn.textContent = 'Next';
        installDom([btn]);
        assert.equal(safeActivate(btn, planner), true);
        assert.equal(btn.clicks, 1, 'dispatching a synthetic click AND .click() ran page handlers twice');
        assert.equal(btn.events.filter(e => e === 'click').length, 1);
    });

    test('the pointer preamble still runs, in order, before the click', () => {
        const btn = new FakeEl('button'); btn.textContent = 'Continue';
        installDom([btn]);
        safeActivate(btn, planner);
        assert.deepEqual(btn.events, [
            'pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
        ]);
    });
});

// ── a denial must touch nothing ────────────────────────────────────────────
describe('a denied activation is inert', () => {
    test('refusing a submit produces no events at all', () => {
        const btn = new FakeEl('button'); btn.textContent = 'Submit Application';
        installDom([btn]);
        assert.equal(safeActivate(btn, planner), false);
        assert.equal(btn.clicks, 0);
        assert.deepEqual(btn.events, [], 'a refused action must leave zero trace on the page');
    });

    test('nothing is clickable at the final step', () => {
        const opt = new FakeEl('div'); opt.textContent = 'Vietnam';
        installDom([opt]);
        assert.equal(safeActivate(opt, { ...planner, atFinalStep: true }), false);
        assert.equal(opt.clicks, 0);
    });
});

// ── the misclassification bypass ───────────────────────────────────────────
describe('the exact submit control cannot be reached by mislabelling it', () => {
    test('submitSelector wins even when the text and componentType look harmless', () => {
        // The re-review's scenario: the planner types the submit button as a
        // `custom-dropdown`, so it arrives via a widget handler with innocuous
        // text. The ONLY thing that still identifies it is the selector the
        // planner named — which is why safeActivate has to be given it.
        const submit = new FakeEl('button'); submit.textContent = 'Continue';
        installDom([submit]);
        const ctx = { ...planner, submitSelector: '[data-automation-id="pageFooterSubmitButton"]' };

        assert.equal(
            safeActivate(submit, ctx, '[data-automation-id="pageFooterSubmitButton"]'), false,
            'origin selector must be consulted');
        assert.equal(submit.clicks, 0);
    });

    test('the same selector carried on ctx (as handlers do) also blocks it', () => {
        const submit = new FakeEl('button'); submit.textContent = 'Continue';
        installDom([submit]);
        const ctx = {
            ...planner,
            submitSelector: '[data-automation-id="pageFooterSubmitButton"]',
            originSelector: '[data-automation-id="pageFooterSubmitButton"]',
        };
        assert.equal(safeActivate(submit, ctx), false);
        assert.equal(submit.clicks, 0);
    });
});

// ── the element actually clicked is the one judged ─────────────────────────
describe('the topmost element is judged, not just the intended one', () => {
    test('an overlay that is itself a submit is refused', () => {
        // We aim at a harmless control; a Submit overlay sits on top and would
        // receive the click. Approving the element underneath is not enough.
        const intended = new FakeEl('button'); intended.textContent = 'Next';
        const overlay = new FakeEl('div'); overlay.textContent = 'Submit Application';
        overlay.append(intended);            // overlay contains it → same path
        installDom([overlay, intended]);

        assert.equal(safeActivate(intended, planner), false);
        assert.equal(overlay.clicks, 0);
        assert.equal(intended.clicks, 0);
    });

    test('a benign overlay on the same path still activates, once', () => {
        // Workday's click_filter: a transparent div that owns the handler. This
        // is the case the coordinate-based click exists for, so it must work.
        const intended = new FakeEl('button'); intended.textContent = 'Save and Continue';
        const filter = new FakeEl('div'); filter.textContent = '';
        filter.append(intended);
        installDom([filter, intended]);

        assert.equal(safeActivate(intended, planner), true);
        assert.equal(filter.clicks, 1, 'the overlay owns the handler, so it receives the click');
        assert.equal(intended.clicks, 0);
    });

    test('an unrelated topmost element is never the one clicked', () => {
        // Nothing links the two: a backdrop or focus trap sits over the control.
        // Clicking IT would be acting on something the caller never asked for —
        // so the activation goes to the intended element, which has already been
        // judged. (Refusing outright was the first attempt, and it made Workday's
        // apply modal unclickable, since its overlay is a sibling of the button.)
        const intended = new FakeEl('button'); intended.textContent = 'Next';
        const stranger = new FakeEl('div'); stranger.textContent = 'Cookie settings';
        installDom([stranger]);   // intended is NOT in the stack

        assert.equal(safeActivate(intended, planner), true);
        assert.equal(intended.clicks, 1);
        assert.equal(stranger.clicks, 0, 'the unrelated overlay is never activated');
    });
});

// ── a missing element is not an activation ─────────────────────────────────
describe('degenerate inputs', () => {
    test('null element returns false without throwing', () => {
        assert.equal(safeActivate(null, planner), false);
    });
});

// ── the caller may narrow `openingApplication`, never widen it ─────────────
describe('openingApplication is re-derived, not trusted', () => {
    test('an apply-verb button is clickable while no form is on screen', () => {
        const btn = new FakeEl('button'); btn.textContent = 'Nộp hồ sơ';
        installDom([btn], { formFields: [] });
        assert.equal(
            safeActivate(btn, { source: 'gateway', openingApplication: true }), true,
            'on a job ad this opens the application');
    });

    test('…and refused once the form is actually there, even if the caller still claims otherwise', () => {
        // The stale-claim case: a gateway re-runs after the form rendered, or a
        // caller passes the flag by habit. The word is identical; only the page
        // has changed, so the check has to look at the page.
        const btn = new FakeEl('button'); btn.textContent = 'Nộp hồ sơ';
        const field = () => Object.assign(new FakeEl('input'), { offsetParent: {} });
        installDom([btn], { formFields: [field(), field(), field()] });
        assert.equal(safeActivate(btn, { source: 'gateway', openingApplication: true }), false);
        assert.equal(btn.clicks, 0);
    });
});

// ── the 3M regression: Apply refused on a job-description page ─────────────
// Live log, 3m.wd1.myworkdayjobs.com:
//   iter 1 · fields=0 · LLM plan action=CLICK "I need to click 'Apply'"
//   [Copo Policy] ✋ submit_application (planner)
//   result: ✅ outcome=filled          ← nothing had been filled
// The flag that permits an apply verb was something the CALLER had to claim, so
// step 0 had it and the planner did not — same button, same page, two verdicts.
describe('apply verb is decided by the page, not by the caller', () => {
    const applyBtn = () => { const b = new FakeEl('button'); b.textContent = 'Apply'; return b; };
    const field = () => Object.assign(new FakeEl('input'), { offsetParent: {} });

    test('the planner may click Apply on a job-description page', () => {
        const btn = applyBtn();
        installDom([btn], { formFields: [] });        // no form on screen
        assert.equal(safeActivate(btn, { source: 'planner' }), true);
        assert.equal(btn.clicks, 1);
    });

    test('…and may not once a form is on screen', () => {
        const btn = applyBtn();
        installDom([btn], { formFields: [field(), field(), field()] });
        assert.equal(safeActivate(btn, { source: 'planner' }), false);
        assert.equal(btn.clicks, 0);
    });

    test('a caller may force it off, but never on', () => {
        const btn = applyBtn();
        installDom([btn], { formFields: [] });
        assert.equal(safeActivate(btn, { source: 'planner', openingApplication: false }), false,
            'an explicit refusal is still honoured');

        const btn2 = applyBtn();
        installDom([btn2], { formFields: [field(), field(), field()] });
        assert.equal(safeActivate(btn2, { source: 'gateway', openingApplication: true }), false,
            'claiming it while a form exists must not grant it');
    });

    test('an unambiguous submit is still refused with no form on screen', () => {
        // The exemption covers the AMBIGUOUS verbs only. "Submit Application"
        // never means "open the application".
        const btn = new FakeEl('button'); btn.textContent = 'Submit Application';
        installDom([btn], { formFields: [] });
        assert.equal(safeActivate(btn, { source: 'planner' }), false);
    });
});

// ── Workday's apply modal: the overlay is a SIBLING, not an ancestor ───────
// Reported live: the "Start Your Application" modal opened and "Autofill with
// Resume" was never clicked. Requiring the topmost element to be on the intended
// control's path refused the exact overlay shape the coordinate click exists for.
describe('an unrelated overlay falls back to the judged element', () => {
    test('the intended control is activated when the overlay is unrelated', () => {
        const btn = new FakeEl('a'); btn.textContent = 'Autofill with Resume';
        const backdrop = new FakeEl('div'); backdrop.textContent = '';   // sibling, contains nothing
        installDom([backdrop], { formFields: [] });   // btn is NOT in the stack

        assert.equal(safeActivate(btn, { source: 'gateway', openingApplication: true }), true);
        assert.equal(btn.clicks, 1, 'the element we judged is the one activated');
        assert.equal(backdrop.clicks, 0, 'the unrelated overlay is never clicked');
    });

    test('an unrelated overlay is never clicked, whatever its label — the judged element is', () => {
        // The overlay receives no events either way, so its policy verdict must
        // not veto the element we were actually asked about. The old rule judged
        // the unrelated cover FIRST and a refusal there blocked everything —
        // measured on Mondelez skills: a selected-skill pill ("Remove …" reads
        // as destructive) overlapped a legit result row and every attempt on the
        // row was denied. The safety property that matters is asserted below:
        // the cover itself is never activated.
        const btn = new FakeEl('a'); btn.textContent = 'Autofill with Resume';
        const overlay = new FakeEl('div'); overlay.textContent = 'Submit Application';
        installDom([overlay], { formFields: [] });

        assert.equal(safeActivate(btn, { source: 'gateway', openingApplication: true }), true);
        assert.equal(btn.clicks, 1, 'the element we judged is the one activated');
        assert.equal(overlay.clicks, 0, 'the submit-looking overlay is never clicked');
    });
});

// ── a hidden file input is not "a form is present" ─────────────────────────
describe('form-presence detection', () => {
    test('a hidden résumé input does not make every page a form', () => {
        // `file.type === 'file'` is true of every file input, so the old check
        // was unconditional: any page carrying one refused the apply verb.
        const btn = new FakeEl('button'); btn.textContent = 'Apply';
        const hiddenFile = Object.assign(new FakeEl('input'), { type: 'file', offsetParent: null });
        globalThis.__hiddenFile = hiddenFile;
        installDom([btn], { formFields: [] });
        const realQS = document.querySelector;
        document.querySelector = (sel) => (sel === 'input[type="file"]' ? hiddenFile : realQS(sel));

        assert.equal(safeActivate(btn, { source: 'planner' }), true);
        assert.equal(btn.clicks, 1);
    });
});
