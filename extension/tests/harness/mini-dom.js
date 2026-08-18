/**
 * A DOM small enough to read, real enough to lie the way Workday lies.
 *
 * The popup manager cannot be tested against the stub the smoke test uses —
 * that one answers "nothing on the page" to every query, which is precisely the
 * page on which a popup manager has nothing to do. What it needs is a document
 * where a list can be OPEN: a node portalled to the body, options that are
 * visible until something closes them, an Escape that only some targets hear,
 * and a close that lands later than the call that asked for it.
 *
 * So: a few hundred lines of DOM, not a dependency. Everything the modules
 * under test actually touch, and nothing else — and an UNSUPPORTED SELECTOR
 * THROWS rather than quietly matching nothing, because a query that silently
 * returns [] is how a test proves a page is clean when it never looked.
 */

// ── selectors ────────────────────────────────────────────────────────────

const TOKEN = /^\s*(?:([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)\s*"([^"]*)"\s*(i)?)?\])/;

/** One compound selector — `div[a="b"]#id`. No combinators: nothing here needs them. */
function parseCompound(text) {
    const spec = { tag: null, id: null, classes: [], attrs: [] };
    let rest = text.trim();
    if (!rest) throw new Error('mini-dom: empty selector');
    while (rest) {
        const m = TOKEN.exec(rest);
        if (!m) {
            throw new Error(`mini-dom: unsupported selector syntax near "${rest}" `
                + '(supported: tag, #id, .class, [attr], [attr="v"], [attr^="v"], [attr*="v" i])');
        }
        if (m[1]) spec.tag = m[1].toUpperCase();
        else if (m[2]) spec.id = m[2];
        else if (m[3]) spec.classes.push(m[3]);
        else spec.attrs.push({ name: m[4], op: m[5] || null, value: m[6] ?? null, ci: !!m[7] });
        rest = rest.slice(m[0].length);
        if (rest.startsWith(' ') || rest.startsWith('>')) {
            throw new Error(`mini-dom: combinators are not supported ("${text}")`);
        }
    }
    return spec;
}

const parseSelector = (sel) => String(sel).split(',').map(parseCompound);

function attrMatches(el, a) {
    const raw = el.getAttribute(a.name);
    if (raw === null) return false;
    if (!a.op) return true;
    const have = a.ci ? raw.toLowerCase() : raw;
    const want = a.ci ? String(a.value).toLowerCase() : String(a.value);
    if (a.op === '=') return have === want;
    if (a.op === '^=') return have.startsWith(want);
    if (a.op === '$=') return have.endsWith(want);
    if (a.op === '*=') return have.includes(want);
    throw new Error(`mini-dom: unsupported attribute operator "${a.op}"`);
}

function matchesCompound(el, spec) {
    if (spec.tag && el.tagName !== spec.tag) return false;
    if (spec.id && el.id !== spec.id) return false;
    if (spec.classes.some((c) => !el.classList.contains(c))) return false;
    return spec.attrs.every((a) => attrMatches(el, a));
}

// ── nodes ────────────────────────────────────────────────────────────────

let seq = 0;

export class MiniElement {
    constructor(tag, doc) {
        this.tagName = String(tag).toUpperCase();
        this.ownerDocument = doc;
        this._attrs = new Map();
        this.children = [];
        this.parentNode = null;
        this._listeners = new Map();
        this._text = '';
        /** The harness's own switch: a hidden node is invisible to every reader. */
        this.hidden = false;
        this.style = {};
        this.value = '';
        this.checked = false;
        this.scrollIntoViewCount = 0;
        this.clickCount = 0;
        this._uid = ++seq;
        this.classList = {
            add: (c) => { const s = new Set(this._classes()); s.add(c); this.setAttribute('class', [...s].join(' ')); },
            remove: (c) => { const s = new Set(this._classes()); s.delete(c); this.setAttribute('class', [...s].join(' ')); },
            contains: (c) => this._classes().includes(c),
        };
    }

    _classes() { return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); }

    get id() { return this._attrs.get('id') || ''; }
    set id(v) { this._attrs.set('id', String(v)); }

    setAttribute(name, value) { this._attrs.set(name, String(value)); }
    getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
    removeAttribute(name) { this._attrs.delete(name); }
    hasAttribute(name) { return this._attrs.has(name); }

    get textContent() {
        return this._text + this.children.map((c) => c.textContent).join('');
    }

    set textContent(v) {
        this.children.forEach((c) => { c.parentNode = null; });
        this.children = [];
        this._text = String(v);
    }

    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
        return child;
    }

    remove() { if (this.parentNode) this.parentNode.removeChild(this); }

    contains(node) {
        for (let p = node; p; p = p.parentNode) if (p === this) return true;
        return false;
    }

    /** Attached, and nothing in the chain hidden — the only definition `vis()` needs. */
    get offsetParent() {
        if (this.hidden) return null;
        let p = this.parentNode;
        let attached = false;
        while (p) {
            if (p.hidden) return null;
            if (p === this.ownerDocument.documentElement) attached = true;
            p = p.parentNode;
        }
        if (!attached) return null;
        if (this === this.ownerDocument.body) return null;   // as in a real document
        return this.parentNode;
    }

    matches(sel) { return parseSelector(sel).some((spec) => matchesCompound(this, spec)); }

    closest(sel) {
        const specs = parseSelector(sel);
        for (let p = this; p; p = p.parentNode) {
            if (p.tagName && specs.some((spec) => matchesCompound(p, spec))) return p;
        }
        return null;
    }

    _walk(out) {
        for (const c of this.children) { out.push(c); c._walk(out); }
        return out;
    }

    querySelectorAll(sel) {
        const specs = parseSelector(sel);
        return this._walk([]).filter((el) => specs.some((spec) => matchesCompound(el, spec)));
    }

    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }

    removeEventListener(type, fn) {
        const l = this._listeners.get(type) || [];
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
    }

    /** Bubbles to the document, like the real thing — Escape depends on it. */
    dispatchEvent(ev) {
        ev.target = ev.target || this;
        const path = [];
        for (let p = this; p; p = p.parentNode) path.push(p);
        if (this.ownerDocument) path.push(this.ownerDocument);
        for (const node of path) {
            const fns = node._listeners ? node._listeners.get(ev.type) : null;
            if (fns) for (const fn of [...fns]) { ev.currentTarget = node; fn.call(node, ev); }
            if (!ev.bubbles) break;
        }
        return !ev.defaultPrevented;
    }

    focus() { this.ownerDocument.activeElement = this; this.dispatchEvent(new MiniEvent('focus', { bubbles: false })); }
    blur() {
        if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
        this.dispatchEvent(new MiniEvent('blur', { bubbles: false }));
        this.dispatchEvent(new MiniEvent('focusout', { bubbles: true }));
    }

    click() {
        this.clickCount += 1;
        this.dispatchEvent(new MiniMouseEvent('click', { bubbles: true, cancelable: true }));
    }

    scrollIntoView() { this.scrollIntoViewCount += 1; }
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 20 }; }
}

export class MiniEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.bubbles = !!init.bubbles;
        this.cancelable = !!init.cancelable;
        this.composed = !!init.composed;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
        this.isTrusted = false;
    }

    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { /* nothing here reads it */ }
}

export class MiniKeyboardEvent extends MiniEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.key = init.key;
        this.code = init.code;
        this.keyCode = init.keyCode;
        this.which = init.which;
    }
}

export class MiniMouseEvent extends MiniEvent { }
export class MiniPointerEvent extends MiniMouseEvent { }

/**
 * Enough DataTransfer to carry a file.
 *
 * The upload path builds one of these to hand a File to an <input type=file>,
 * because that is the only way a script can put one there. Node has no such
 * class, so without this the shared upload helper throws and every upload test
 * would be testing the catch block.
 */
export class MiniDataTransfer {
    constructor() {
        this._files = [];
        this.items = { add: (f) => this._files.push(f) };
    }

    get files() { return this._files; }
}

// ── the document ─────────────────────────────────────────────────────────

class MiniDocument {
    constructor() {
        this._listeners = new Map();
        this.documentElement = new MiniElement('html', this);
        this.body = new MiniElement('body', this);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
    }

    createElement(tag) { return new MiniElement(tag, this); }
    createTextNode(text) { const n = new MiniElement('#text', this); n.textContent = text; return n; }

    querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
    querySelector(sel) { return this.documentElement.querySelector(sel); }
    getElementById(id) { return this.documentElement.querySelectorAll(`[id="${id}"]`)[0] || null; }
    contains(node) { return this.documentElement.contains(node) || node === this.documentElement; }

    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }

    removeEventListener(type, fn) {
        const l = this._listeners.get(type) || [];
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
    }

    dispatchEvent(ev) {
        ev.target = ev.target || this;
        const fns = this._listeners.get(ev.type) || [];
        for (const fn of [...fns]) { ev.currentTarget = this; fn.call(this, ev); }
        return !ev.defaultPrevented;
    }
}

/**
 * Put a document on `globalThis` and hand back the pieces.
 *
 * The v2 modules read the globals directly, as content-script code must, so the
 * install is global too. `uninstall()` exists because the suite runs several
 * pages in one process and a leftover document is a test that passes on the
 * previous test's page.
 */
export function installDom({ href = 'https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External/job/R-1/apply' } = {}) {
    const doc = new MiniDocument();
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
        location: globalThis.location,
        Event: globalThis.Event,
        KeyboardEvent: globalThis.KeyboardEvent,
        MouseEvent: globalThis.MouseEvent,
        PointerEvent: globalThis.PointerEvent,
        DataTransfer: globalThis.DataTransfer,
        HTMLInputElement: globalThis.HTMLInputElement,
        HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
        HTMLSelectElement: globalThis.HTMLSelectElement,
        chrome: globalThis.chrome,
    };
    const url = new URL(href);
    const win = { name: 'mini-dom' };

    globalThis.document = doc;
    globalThis.window = win;
    globalThis.location = { href, hostname: url.hostname, pathname: url.pathname, origin: url.origin };
    globalThis.Event = MiniEvent;
    globalThis.KeyboardEvent = MiniKeyboardEvent;
    globalThis.MouseEvent = MiniMouseEvent;
    globalThis.PointerEvent = MiniPointerEvent;
    globalThis.DataTransfer = MiniDataTransfer;
    // Every browser has these, and production code reads them to pick the right
    // native `value` setter (calling HTMLInputElement's on a <textarea> throws
    // "Illegal invocation"). Their absence here made `setNativeValue` throw
    // "HTMLTextAreaElement is not defined" the moment anything typed — which
    // surfaced as OPEN_TIMEOUT from a widget that was never touched. A stub the
    // elements are not instances of is enough and is honest: the descriptor
    // lookup finds no setter and the assignment path is taken.
    globalThis.HTMLInputElement = class HTMLInputElement { };
    globalThis.HTMLTextAreaElement = class HTMLTextAreaElement { };
    globalThis.HTMLSelectElement = class HTMLSelectElement { };
    globalThis.chrome = globalThis.chrome || {
        storage: { local: { get: (_k, cb) => cb({}) } },
        runtime: { id: 'mini-dom' },
    };

    return {
        document: doc,
        window: win,
        uninstall() { Object.assign(globalThis, previous); },
    };
}
