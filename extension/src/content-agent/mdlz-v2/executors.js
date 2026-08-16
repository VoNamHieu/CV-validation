/**
 * Filling one field: is it already right, how is it written, and how do we KNOW.
 *
 * Every capability here answers those three questions separately, and the third
 * one is the reason the file exists. v1's two failure modes were both verdicts,
 * not fills:
 *
 *   · IT REPORTED FAILED FOR A FIELD THAT WAS CORRECT — a committed date reads
 *     `.value === ""` while aria-valuenow carries the number, so every date the
 *     picker had just written came back "not committed".
 *   · IT REPORTED DONE FOR A FIELD THAT WAS EMPTY — a value painted into a
 *     React-controlled input survives in `.value` until the next render hands
 *     the old one back, and a verifier that read it immediately never saw the
 *     revert.
 *
 * So each widget declares its own commit signal, none of them is `.value` alone,
 * and every verify RE-READS the node (Workday replaces it) and then waits long
 * enough to catch a value that does not stick.
 *
 * What no capability does: guess. An option list that offers three plausible
 * rows for one term returns AMBIGUOUS and stops — putting a skill the candidate
 * never claimed onto a real application is worse than leaving a field empty.
 */

import { MONTHS, MONTH_LABEL, RESULT, SEL, SEMANTIC, deriveTenant } from './config.js';
import { WIDGET, triggerOf } from './fingerprint.js';
import { sleep as domSleep } from '../dom.js';
import { errorsIn, rowsOf } from './row.js';
import { visibleMonthCells, visibleOptions, visiblePanels } from './page-observer.js';
import { withList } from './popup-manager.js';
import { fold, sameConcept } from './text.js';
import { trace } from '../trace.js';

// The fallback is dom.js's `sleep`, not a bare setTimeout: a hidden tab's own
// timers are throttled to ~1/minute, and every wait in this file would inherit
// that. `sleep` borrows the background worker's clock, which is exempt.
const napper = (sleep) => sleep || domSleep;
const txt = (el) => (el?.textContent || '').trim();
const isPlaceholder = (s) => /^select one$/i.test(String(s || '').trim());

/** Poll a condition to a deadline. Cheap, and never a fixed sleep. */
async function until(fn, { sleep, budgetMs = 1200, pollMs = 60 } = {}) {
    const nap = napper(sleep);
    const by = Date.now() + budgetMs;
    for (;;) {
        if (fn()) return true;
        if (Date.now() >= by) return false;
        await nap(pollMs);
    }
}

/**
 * Write into a React-controlled input the way the page's own code would.
 *
 * The prototype setter is what React's change tracker listens through; a plain
 * assignment can be swallowed whole. Falls back when there is no prototype
 * descriptor to borrow.
 */
export function setNativeValue(el, value) {
    try {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
    } catch { try { el.value = value; } catch { /* the control refuses; verify will say so */ } }
    for (const type of ['input', 'change']) {
        try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch { /* noop */ }
    }
}

/**
 * Choose one option, or choose none.
 *
 * Exact wins outright. A single distinct row containing the term is taken — that
 * is what a search field is for. Several different rows containing it is
 * AMBIGUOUS, because "SQL" offering SQL Server, MySQL and PL/SQL is three
 * answers the candidate never gave.
 */
/**
 * Rows a list renders that are not choices.
 *
 * MEASURED on Skills (R-174102): an empty catalogue answers "No Items." — as
 * THREE nested nodes (menuItem / promptLeafNode / promptOption) that all answer
 * the option selector. They are counted as options on purpose, so the list still
 * registers as OPEN and the field reports a semantic refusal rather than a
 * timeout; but they are never something a click may land on.
 */
const NOT_A_CHOICE = /^(select one|no items\.?)$/i;

export function chooseOption(options, want) {
    const all = options.map((o) => ({ node: o, text: txt(o) })).filter((r) => r.text);
    // Placeholders are counted in the evidence and excluded from the choosing.
    const rows = all.filter((r) => !NOT_A_CHOICE.test(r.text));
    const w = fold(want);
    // EVERY refusal carries its evidence. A live run came back
    // `OPTION_NOT_FOUND, reason: ""` about a list of 249 countries, and there
    // was no way to tell from it what had been wanted, what was on the list, or
    // why 249 rows held no match — so the cause had to be guessed at. v1 logs
    // tried/shown/sample for exactly this; this returns the same.
    const evidence = { want: String(want ?? ''), shown: all.length, sample: all.slice(0, 4).map((r) => r.text) };
    if (!w) return { option: null, why: RESULT.OPTION_NOT_FOUND, ...evidence };
    // sameConcept, not fold-equal: the shared exact predicate — widened only by
    // the accidents fold/foldTokens erase (case, spacing, punctuation, word
    // order), never a near-match. The `includes` tier below stays the near tier.
    const exact = rows.filter((r) => sameConcept(r.text, want));
    if (exact.length) return { option: exact[0].node, matched: exact[0].text };
    const partial = rows.filter((r) => fold(r.text).includes(w));
    const distinct = [...new Set(partial.map((r) => fold(r.text)))];
    if (distinct.length === 1) return { option: partial[0].node, matched: partial[0].text };
    if (distinct.length > 1) return { option: null, why: RESULT.AMBIGUOUS, ...evidence, saw: distinct.slice(0, 4) };
    return { option: null, why: RESULT.OPTION_NOT_FOUND, ...evidence };
}

/**
 * Walk a ladder of candidate answers against the options a page really offers.
 *
 * The rungs are measured, in order, and the ANCHOR matters: a rung written
 * '=Other' matches exactly or by prefix only, because "other" lives inside
 * "another" and a substring hit on "Another job board" is a wrong claim about
 * how somebody found the job, not a fallback.
 *
 * Nothing is invented: a ladder that ends without a hit returns nothing, and the
 * field is left for the person whose answer it is.
 */
export function chooseFromLadder(options, ladder) {
    const rows = options.map((o) => ({ node: o, text: txt(o) }))
        .filter((r) => r.text && !NOT_A_CHOICE.test(r.text));
    for (const raw of ladder) {
        const anchored = raw.startsWith('=');
        const term = anchored ? raw.slice(1) : raw;
        const cand = fold(term);
        // Exact tier is the shared sameConcept (so "=BA" also meets "B.A.", and a
        // reordered ladder label meets its option); the prefix/substring fallback
        // stays exactly as measured — anchored rungs by prefix, others by
        // substring ("=Other" never claims "Another job board").
        const hit = rows.find((r) => sameConcept(r.text, term))
            || rows.find((r) => (anchored ? fold(r.text).startsWith(cand) : fold(r.text).includes(cand)));
        if (hit) return { option: hit.node, matched: hit.text, rung: raw };
    }
    return {
        option: null,
        why: RESULT.OPTION_NOT_FOUND,
        want: ladder.slice(0, 3).join(' → '),
        shown: rows.length,
        sample: rows.slice(0, 4).map((r) => r.text),
    };
}

/** The row a field sits in, if the caller gave us one — errors live there. */
const rowClean = (ctx) => !ctx?.row || errorsIn(ctx.row).length === 0;

/**
 * ENTER IS WHAT RUNS THE SEARCH — and the list says "No Items." until it does.
 *
 * v1 paid for this once and wrote it down: "Typing alone leaves the list showing
 * 'No Items.' no matter what the term is — I read that as an empty taxonomy and
 * was wrong: the query had simply never been submitted." Measured again the same
 * way on 2026-08-09 before anyone read that comment.
 *
 * So the keystroke is sent as a real one: keypress as well as keydown/keyup, and
 * keyCode 13, because a widget that listens for the legacy code hears nothing
 * from `{ key: 'Enter' }` alone.
 */
/**
 * The element that scrolls a result list.
 *
 * Ported from v1, including the reason for the second half: a lazy list can
 * read `scrollHeight === clientHeight` until it has been scrolled once, and
 * returning null there froze the walk at window one — measured on Mondelez's
 * Language prompt, where "Vietnamese" sat past the fold and every pass reported
 * option-not-found on a list that contained it.
 */
function optionScroller(opt) {
    let styled = null;
    for (let p = opt?.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 20) return p;
        if (!styled) {
            try {
                const oy = getComputedStyle(p).overflowY;
                if (oy === 'auto' || oy === 'scroll') styled = p;
            } catch { /* no layout engine here */ }
        }
    }
    return styled;
}

/**
 * The list's OWN item array, read from the widget's React internals.
 *
 * MEASURED on R-174102, 2026-08-09, and it is the difference between right and
 * wrong: the header said "Search Results (16)", the rendered window held 8, and
 * scrolling the DOM to collect the rest still only reached 12 — the virtualiser
 * renders nothing for a beat after a jump, so a scroll-and-read walk silently
 * loses rows. The exact match, "Agile/Scrum", was the 16th and was missed by
 * every DOM-based attempt. Read from the fiber it is simply there.
 *
 * Ported from v1, which needed it for the same reason. Best effort by design: if
 * React's internals move, `pickAcrossList` still has the scroll walk behind it.
 */
export function readVirtualItems(sc) {
    try {
        const key = Object.keys(sc).find((k) => /^__reactFiber\$|^__reactInternalInstance\$/.test(k));
        if (!key) return null;
        // The rows expose their text as `ariaLabel`, not always `label`. This
        // checked `label` ONLY — so on the live Skills widget (probed 2026-08-13:
        // the item array sits at props.items, len 31, elements carry ariaLabel)
        // it matched nothing, `readVirtualItems` returned null on EVERY search,
        // and the whole fiber fast-path was dead: every term fell to the
        // scroll-walk that reaches ~11/16 and OPEN_TIMEOUT-retried a below-fold
        // exact for three passes. chooseSkillTarget already reads `label ??
        // ariaLabel`; this now recognises the same shape.
        const looksLikeItems = (v) => Array.isArray(v) && v.length > 3 && v[0]
            && typeof v[0] === 'object' && ('label' in v[0] || 'ariaLabel' in v[0]);
        let f = sc[key];
        for (let d = 0; f && d < 30; d++, f = f.return) {
            for (const node of [f, f.alternate]) {
                if (!node) continue;
                for (const bag of [node.memoizedProps, node.memoizedState]) {
                    if (!bag || typeof bag !== 'object') continue;
                    for (const v of Object.values(bag)) if (looksLikeItems(v)) return v;
                }
            }
        }
    } catch { /* internals moved — the scroll walk still works */ }
    return null;
}

/**
 * The list's item array read the way the manual probe that committed live did:
 * the CURRENT `memoizedProps.items` of the REAL activeListContainer, whose items
 * carry a callable onSelect.
 *
 * readVirtualItems scans props AND memoizedState AND the `alternate` fiber (the
 * previous render) for ANY labelled array, and can hand back a STALE one whose
 * onSelect no longer commits — measured live PwC 2026-08-15: readVirtualItems
 * found an array so pickAcrossList reached its items branch, yet the write never
 * landed. This returns ONLY the live props.items whose first item has a callable
 * onSelect, so the data write is on the array the widget is actually rendering.
 * Best effort: null when the widget is shaped differently, and the caller falls
 * back to readVirtualItems / the DOM path.
 */
export function findFiberWriteItem(want) {
    const out = { item: null, containers: 0, arraysWithWrite: 0, exactHits: 0 };
    try {
        if (typeof document === 'undefined') return out;
        // ALL open list containers, not the first — a leftover skills list can
        // sit ahead of the field's own (measured live PwC 2026-08-15: the first
        // activeListContainer led to an array whose items carried NO onSelect,
        // while the field's own array, further along, had the write-able ones).
        const containers = [...document.querySelectorAll('[data-automation-id="activeListContainer"], [role="listbox"]')]
            .filter((el) => el.offsetParent !== null);
        out.containers = containers.length;
        const seen = new Set();
        const hits = [];
        for (const L of containers) {
            const key = Object.keys(L).find((k) => /^__reactFiber\$|^__reactInternalInstance\$/.test(k));
            if (!key) continue;
            let node = L[key];
            for (let h = 0; node && h < 25; h++, node = node.return) {
                const arr = node.memoizedProps && node.memoizedProps.items;
                if (Array.isArray(arr) && arr.length && arr.some((it) => typeof it?.onSelect === 'function')) {
                    out.arraysWithWrite += 1;
                    for (const it of arr) {
                        if (typeof it?.onSelect !== 'function') continue;
                        if (!sameConcept(String(it?.label ?? it?.ariaLabel ?? ''), want)) continue;
                        const lbl = fold(String(it?.label ?? it?.ariaLabel ?? ''));
                        if (!seen.has(lbl)) { seen.add(lbl); hits.push(it); }
                    }
                    break;   // this container's array handled
                }
            }
        }
        out.exactHits = hits.length;
        // Exactly one write-able exact match, or nothing: a twin or an ambiguous
        // set is never written sight-unseen.
        out.item = hits.length === 1 ? hits[0] : null;
    } catch { /* internals moved */ }
    return out;
}

/** Uniform row height, from the absolute offsets the virtualiser writes. */
function virtualRowHeight(sc) {
    const inner = sc?.firstElementChild;
    if (!inner) return 0;
    const tops = [...inner.children]
        .map((c) => parseInt(c.style?.top || '', 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) if (tops[i] > tops[i - 1]) return tops[i] - tops[i - 1];
    return 0;
}

/**
 * Which ITEM of a skills search answers the term — catalog first, then the
 * candidate's own words.
 *
 * MEASURED on R-170139 (2026-08-10), read out of the widget's own item array:
 * every search ends with a CREATE row — `label` is the typed text verbatim and
 * `id` EQUALS the label ("id":"zzcopoprobe skill" for a nonsense probe) — while
 * catalog entries carry ids like REMOTE_SKILL-1-132345, the same string that
 * later appears on the committed chip as `pill-REMOTE_SKILL-1-132345`. A chip
 * created through the create row reads `pill-<the text>` instead: that is the
 * free-text skill, and it is how "retention optimization" reached the page in
 * the candidate's own casing.
 *
 * Order of preference (2026-08-13): the create row now outranks a substring
 * cousin — the 2026-08-10 order (exact → near → create) with those two swapped,
 * for the reason in tier 2 —
 *   1. an EXACT catalog match — structured data beats free text, and when the
 *      catalog and the create row carry the same label the catalog row wins;
 *   2. the CREATE row — the CV's own words go on the application, verbatim. A
 *      term that appears only INSIDE a catalog label ("Agile" in "Agile/Scrum",
 *      "Java" in "JavaScript") is a DIFFERENT skill, and committing it would
 *      assert, silently, a skill the candidate never wrote — on the field
 *      recruiters filter by. Skills ALWAYS carry a create row, so they stop
 *      here: exact, else the candidate's own words, never a cousin.
 *   3. a SINGLE distinct catalog row CONTAINING the term — reached only where
 *      there is NO create row to prefer, e.g. countryPhoneCode ("Vietnam" →
 *      "Vietnam (+84)"), whose list shares this chooser but offers no free text.
 */
export function chooseSkillTarget(items, want) {
    const w = fold(want);
    const rows = (items || []).map((it, i) => ({
        label: String(it?.label ?? it?.ariaLabel ?? '').trim(),
        id: String(it?.id ?? ''),
        index: Number.isFinite(it?.index) ? it.index : i,
    })).filter((r) => r.label && !NOT_A_CHOICE.test(r.label));
    if (!w || !rows.length) return { kind: 'none' };

    const isCreate = (r) => r.id === r.label && !/^REMOTE_SKILL/i.test(r.id);
    const catalog = rows.filter((r) => !isCreate(r));

    // `match` is carried so a caller reading a PARTIAL list can tell the one
    // answer a longer list cannot overturn (an exact hit) from the two it can (a
    // create row a later exact catalog would beat; a near-match either would).
    // DELIBERATELY fold-strict, NOT sameConcept — the one exact tier the shared
    // widening is kept out of. Skills prefer the candidate's VERBATIM words (the
    // create row below) over any catalogue transform; sameConcept would let a
    // reordered catalogue row ("Analysis Data") count as exact and beat the CV's
    // own "Data Analysis" create row, silently rewording a skill recruiters
    // filter by. The create-row rule is the whole reason skills differ, so their
    // exact stays the strictest.
    const exact = catalog.filter((r) => fold(r.label) === w);
    if (exact.length) return { kind: 'catalog', match: 'exact', ...exact[0] };
    // The candidate's verbatim text beats a substring cousin: "Agile" must not
    // silently become "Agile/Scrum". Skills always carry a create row, so they
    // stop here — at the CV's own words — and never reach the near branch below.
    const create = rows.find((r) => isCreate(r) && fold(r.label) === w);
    if (create) return { kind: 'free', match: 'create', ...create };
    // Only where there is NO verbatim option (countryPhoneCode: "Vietnam" →
    // "Vietnam (+84)") does a single distinct cousin become the intended pick.
    const near = catalog.filter((r) => fold(r.label).includes(w));
    if (near.length && new Set(near.map((r) => fold(r.label))).size === 1) {
        return { kind: 'catalog', match: 'near', ...near[0] };
    }
    return { kind: 'none', sample: rows.slice(0, 4).map((r) => r.label), shown: rows.length };
}

/**
 * Exact wins; a single distinct near-match counts; several do not.
 *
 * `exactOnly` is set when the list read is known to be PARTIAL: a near-match on
 * a short list can be shadowed by the exact row still below the fold, so only an
 * exact hit may be trusted until the whole list is in. Skills lean on this: a
 * partial read refuses the cousin, and a complete one carries the create row
 * (its label IS the term) so exact takes it — the cousin is reached only by a
 * widget with no create row (countryPhoneCode), which is exactly when it is
 * wanted.
 */
function pickLabel(labels, want, { exactOnly = false } = {}) {
    const w = fold(want);
    if (!w) return null;
    // fold-strict on purpose: pickLabel backs pickAcrossList, which drives SKILLS
    // as well as the field-of-study fallback, so it keeps the same verbatim-first
    // rule chooseSkillTarget does — the shared sameConcept widening lives in the
    // callers that are NOT skills (chooseOption, chooseFromLadder, radio, and
    // searchSelect's own fiber path).
    const exact = labels.filter((l) => fold(l) === w);
    if (exact.length) return exact[0];
    if (exactOnly) return null;
    const near = labels.filter((l) => fold(l).includes(w));
    if (!near.length) return null;
    return new Set(near.map(fold)).size === 1 ? near[0] : null;
}

/**
 * The skills result list, read from the tenant's own `skillsearch` endpoint —
 * the ONE source of the list that a hidden tab cannot defer (network, unlike a
 * React render, is not throttled by visibility). The shape is measured
 * (2026-08-13): an array of `{id, descriptor}`, a catalog row's id is
 * `REMOTE_SKILL-…` and the LAST row is the create/free-text one whose id EQUALS
 * its descriptor — the same discriminator chooseSkillTarget already uses. Mapped
 * to `{label, id, index}` so it drops straight into that decision. Best effort:
 * any failure returns null and the caller keeps whatever the DOM gave it.
 */
async function fetchSkillOptions(term) {
    try {
        const t = String(term ?? '').trim();
        if (!t || typeof fetch !== 'function' || typeof location === 'undefined') return null;
        const tenant = deriveTenant();
        if (!tenant) return null;   // an un-derivable tenant is not a page this reads
        const url = `${location.origin}/wday/cxs/${tenant}/skillsearch?search=${encodeURIComponent(t)}`;
        const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        const data = await res.json();
        if (!Array.isArray(data)) return null;
        return data
            .map((it, i) => ({ label: String(it?.descriptor ?? it?.label ?? '').trim(), id: String(it?.id ?? ''), index: i }))
            .filter((r) => r.label);
    } catch { return null; }
}

/**
 * The multiselect's own commit handler, read off the search input's fiber.
 *
 * MEASURED live (2026-08-13, tenant mdlz, 4/4 runs incl. one through
 * chrome.scripting on a covered tab): a dozen levels above the input sit props
 * with `onSelect(valuesArray)` + `values` (each value `{label, id}`). Calling
 * onSelect with the values array PLUS one more item lands the chip in ~600ms
 * even while the tab is hidden — React's state commit is plain JS and is not
 * visibility-throttled; only the virtualiser's PAINT is. This is what lets a
 * row that will never render (the create row is LAST, position 16, and a hidden
 * tab paints ~2 rows) commit anyway: the item is written by DATA, not clicked.
 *
 * Fragile by nature (React internals), so it is a FALLBACK: the click path
 * stays primary, this fires only when the chosen row cannot be materialized,
 * and the chip re-read stays the one commit signal. Returns null off-fiber
 * (the harness's plain divs), which disables the path exactly where it must be.
 */
export function readSkillsOnSelect(el) {
    try {
        const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        let f = key ? el[key] : null;
        for (let i = 0; i < 45 && f; i++) {
            const p = f.memoizedProps;
            if (p && typeof p.onSelect === 'function' && Array.isArray(p.values)) return p;
            f = f.return;
        }
    } catch { /* a torn-down fiber is a no, not a crash */ }
    return null;
}

/**
 * Choose from the WHOLE result list, not the window that happens to be drawn.
 *
 * MEASURED on R-174102, 2026-08-09: the header read "Search Results (16)", the
 * rendered window held 8, and the row that matched the term EXACTLY —
 * "Agile/Scrum" — was the last one, below the fold. Judging from the drawn rows
 * alone, the term looked absent and the taxonomy looked like it spelled things
 * differently. It did not; we were reading a third of the answer.
 *
 * v1 records the same rule: "Match on the WHOLE result set, not the rendered
 * window. These results scroll: the exact row can sit below the fold, and
 * judging ambiguity from a partial view is worse than missing it."
 *
 * Three phases, and they are separate on purpose. The list is VIRTUALISED — it
 * recycles row nodes — so a node captured while scanning may be a different
 * option by the time it is clicked. So: collect the labels, decide on the text,
 * then go find that text again and click the node that is live at that moment.
 */
async function pickAcrossList(lease, want, { sleep, maxWindows = 24, exactOnly = false } = {}) {
    const nap = napper(sleep);
    // GLOBAL reads, not lease-scoped — the structural difference between v1
    // (works) and v2 (failed), found by correlation on 2026-08-10: every
    // hand probe of this widget read visibleOptions() page-wide and found the
    // scroller and all 16 items, every time; every agent miss read through
    // lease.options() — scoped to the node captured at open — and got
    // sc=null items=null, every time. Workday does not keep this widget's
    // results inside the node the open produced.
    //
    // Attribution is not lost: the page is swept CLEAR of options before the
    // list is opened (that is the lease's own precondition), so everything
    // visible now was produced by our click. The scope was a second belt on
    // top of that sweep, and it was strangling the read.
    const labelsOf = () => visibleOptions().map(txt).filter((t) => t && !NOT_A_CHOICE.test(t));
    const seen = new Set(labelsOf());
    // The DECIDED item ({label, id, free}), kept on failure verdicts so commit
    // can fall back to writing it by DATA when its row will not render. Set only
    // once the read is complete enough for the choice to be final.
    let chose = null;
    // `let`, and re-resolved INSIDE the wait loop below. MEASURED on R-170139
    // (2026-08-10, run 02:38, the trace's own via/items columns): all five
    // misses were `via=labels items=null` — the scroller was resolved ONCE,
    // at entry, while the freshly-opened list was still too short to overflow,
    // so sc was null and the entire item path was skipped for every one of
    // them. The three terms that committed were exactly the three whose
    // catalog row sits in the first rendered window.
    let sc = optionScroller(visibleOptions()[0]);

    // THE WIDGET'S OWN ARRAY FIRST. Scrolling the DOM to collect the rest
    // reached 12 of 16 and lost the exact match; the fiber has all of them.
    //
    // And the array is WAITED FOR, against the count the widget itself
    // announces: "Search Results (16)" is on the page, so an item array
    // shorter than that is a render still in flight, not an answer. Reading
    // it early is the measured cause of every pass-1 miss — the sample of
    // each one held only the first rendered window.
    // `declared` is re-read EVERY iteration, not captured once. MEASURED on
    // R-170139 (2026-08-10, run 02:27): read once at entry it was 0 — the
    // header renders WITH the results, after this function starts — so the
    // loop accepted the first non-empty item array it saw. That array was the
    // list mid-render: the miss's sample was items[0..3] exactly, and the
    // create row (last) was not in it. Every free-text term died on that.
    // When the header cannot be read at all, the array must instead hold the
    // SAME length across two consecutive reads before it counts as an answer.
    const readDeclared = () => {
        try { return Number((document.body.textContent.match(/Search Results\s*\((\d+)\)/) || [])[1]) || 0; }
        catch { return 0; }
    };
    let declared = 0;
    let items = sc ? readVirtualItems(sc) : null;
    let sawScChange = false;   // the container was swapped mid-search (stale-sc)
    let sawHidden = false;     // the search ran in a background tab (throttled render)
    let sawApi = false;        // the item list came from the skillsearch API, not the fiber
    {
        const by = Date.now() + 4000;
        let prevLen = -1;
        while (Date.now() < by) {
            // TRACK THE CURRENT ACTIVE LIST EVERY ITERATION — not the node
            // captured at entry, and not merely "re-resolve when null/detached".
            // The list opens on its initial rows (measured: popup.open options:3);
            // when the results land Workday swaps the container, and the old node
            // can stay isConnected:true through a transition while no longer being
            // the active list — so a stale sc was read for the whole budget and
            // readVirtualItems returned null while the LIVE list held every item.
            // Re-resolving from the current visibleOptions each pass follows the
            // list wherever it moves; update ONLY when one is found, so a momentary
            // empty read never nulls a good sc.
            const cur = optionScroller(visibleOptions()[0]);
            if (cur && cur !== sc) sawScChange = true;
            if (cur) sc = cur;
            if (typeof document !== 'undefined' && document.hidden) sawHidden = true;
            declared = readDeclared();
            items = sc ? readVirtualItems(sc) : null;
            const len = items ? items.length : 0;
            if (len && declared && len >= declared) break;
            if (len && !declared && len === prevLen) break;   // stable twice, header unreadable
            prevLen = len;
            await nap(200);
        }
    }

    // ONE LAST FIBER READ on the CURRENT list before falling to the DOM scroll.
    // The array can populate a beat after the budget expires — a slow render, or
    // a BACKGROUND-THROTTLED one: measured (R-172396) the whole search ran while
    // the tab was hidden (04:35:56 hidden → 04:36:22 search → 04:36:44 visible →
    // 04:36:46 miss), so the wait ended with the fiber still empty and only then
    // did the data arrive. Reading the current container once more here catches
    // it, instead of scrolling the DOM slowly and lossily for nothing.
    if (!items || (declared > 0 && items.length < declared)) {
        const cur = optionScroller(visibleOptions()[0]);
        if (cur) { if (cur !== sc) sawScChange = true; sc = cur; items = readVirtualItems(sc); }
    }
    // Tells the two failure modes apart on the next live run: scChanged → the
    // container was swapped (stale-sc); hidden → a background-tab search. Either
    // way `items` should now be the whole list.
    trace('mdlz.skill.fiber', {
        itemsLen: items?.length ?? null,
        declared,
        scChanged: sawScChange,
        hidden: sawHidden,
        scConnected: !!sc?.isConnected,
    });

    // FIBER STILL SHORT — read the list from the API instead. Measured
    // definitively (2026-08-13, mdlz.skill.fiber): scChanged:false, hidden:true,
    // scConnected:true, itemsLen:null — the scroller is right and connected, but
    // React DEFERS the virtualiser's render/commit while the tab is HIDDEN, so
    // neither the fiber's props.items nor the tail DOM rows exist and only ~11/16
    // are readable. The `skillsearch?search=` endpoint returns the SAME list
    // ({id, descriptor}, create row last, id===descriptor) and the network is NOT
    // deferred by visibility — so it is the one complete, visibility-independent
    // read. Fed into the SAME index-based click below (the tail row still has to
    // be scrolled into view to click, best-effort while hidden).
    // `sc` gates this: the API read is the FALLBACK for a scroller-based fiber
    // read that came up short, so it only fires where a virtualised scroller
    // exists. That is also what keeps it out of the harness (plain-div lists,
    // no scroller → sc is null → the DOM label path handles it), where a live
    // `fetch` to the tenant origin would otherwise run in the test.
    if (sc && (!items || (declared > 0 && items.length < declared))) {
        const api = await fetchSkillOptions(want);
        if (api && api.length) { items = api; declared = api.length; sawApi = true; }
    }
    if (sawApi) trace('mdlz.skill.api', { itemsLen: items?.length ?? null, want: String(want ?? '') });

    // A read is only COMPLETE once the item array is at least as long as the
    // count the header declared. Below that the answer may simply not be in the
    // window yet — and the create row is LAST, so free-text terms miss here
    // first. On a short list only an EXACT catalog hit is safe; anything else is
    // an INTERACTION failure (OPEN_TIMEOUT, retried next pass), never a semantic
    // OPTION_NOT_FOUND — which is cached against the whole field and would freeze
    // Skills for the page over a slow network. Measured: itemsLen 4 / declared
    // 16 returned OPTION_NOT_FOUND with the create row not yet in the array.
    const readComplete = (n) => !declared || n >= declared;

    // The widget's own items carry the discriminator (catalog id vs the typed
    // text), so when they are readable the decision is made on them directly.
    if (items && items.length) {
        const choice = chooseSkillTarget(items, want);
        if (!readComplete(items.length) && choice.match !== 'exact') {
            return {
                option: null, why: RESULT.OPEN_TIMEOUT,
                want: String(want ?? ''), reason: `read ${items.length}/${declared} — list still filling`,
                via: 'items', itemsLen: items.length, declared,
            };
        }
        if (choice.kind === 'none') {
            return {
                option: null, why: RESULT.OPTION_NOT_FOUND,
                want: String(want ?? ''), shown: choice.shown ?? items.length,
                sample: choice.sample ?? [],
                via: 'items', itemsLen: items.length, declared,
            };
        }
        // The choice is FINAL from here (complete read, or an exact hit): keep
        // its identity so a row that will not render can still be committed by
        // DATA (fiber onSelect) instead of by a click on a node that does not
        // exist — measured 4/4 on 2026-08-13: the hidden tail never paints, but
        // the widget's own handler lands the chip in ~600ms without it.
        chose = { label: choice.label, id: choice.id, free: choice.kind === 'free' };
        // THE INDEX IS FOR SCROLLING ONLY — NEVER IDENTITY. Measured: the API's
        // order and the UI's order can disagree (API idx 6 ≠ UI idx 6), so
        // "the row at the chosen offset" can be a DIFFERENT skill, and a wrong
        // chip on a real application is worse than a miss. The row to CLICK is
        // found by its exact LABEL, and only when that label is UNIQUE in the
        // item list — a create row and a catalog row can carry the same text,
        // and a DOM row does not expose the id that tells them apart. Ambiguous
        // or unrendered → the {label, id} goes to the data write instead, which
        // is precise by construction.
        const dup = items.filter((it) => fold(String(it?.label ?? it?.ariaLabel ?? '')) === fold(choice.label)).length > 1;
        if (!dup) {
            const liveByLabel = () => {
                const m = rowsByLabel(choice.label);
                return m.length === 1 ? m[0] : null;
            };
            let node = liveByLabel();
            if (!node && sc) {
                const h = virtualRowHeight(sc);
                if (h) { try { sc.scrollTop = Math.max(0, (choice.index * h) - Math.round(sc.clientHeight / 2) + h); } catch { /* no layout */ } }
                await nap(250);
                node = liveByLabel();
            }
            if (node) return { option: node, matched: choice.label, id: choice.id, free: choice.kind === 'free' };
        }
        // Unrendered or same-text twins: no DOM node can be trusted to BE the
        // chosen item, so no DOM node is clicked. OPEN_TIMEOUT (interaction,
        // retryable) with `chose` {label,id} attached — the single-select rescue
        // (searchSelect) writes it through the multiselect's PARENT onSelect,
        // which is attached even in a hidden popup (readSkillsOnSelect), unlike a
        // per-item onSelect that the throttled tab never binds.
        return {
            option: null, why: RESULT.OPEN_TIMEOUT, chose,
            want: String(want ?? ''), via: 'items', itemsLen: items.length, declared,
            reason: dup ? `"${choice.label}" has same-text twins — only the data write can tell them apart`
                : 'the chosen row would not render',
        };
    }

    if (sc && !items) {
        // The fiber read handed back null, so the WHOLE answer has to be scrolled
        // into view — and this is where every measured `via:labels itemsLen:null`
        // miss landed: "read 11/16", the exact row (Agile/Scrum, unit economics)
        // sitting in the tail below the fold, missed for three passes. The list is
        // virtualised and draws a beat behind the scroll, so a near-full-window
        // step past a slow render skips the boundary rows. Read it densely:
        // OVERLAPPING half-window steps, a longer settle before each read, STOP the
        // moment every declared row has been seen, and one last settled read at the
        // bottom for a tail that drew late — enough to close 11/16 in one pass.
        try { sc.scrollTop = 0; } catch { /* no layout */ }
        await nap(150);
        labelsOf().forEach((l) => seen.add(l));
        const step = Math.max(40, Math.round((sc.clientHeight || 200) / 2));
        for (let i = 0; i < maxWindows; i++) {
            if (declared && seen.size >= declared) break;    // every row is in — stop early
            const before = sc.scrollTop;
            try { sc.scrollTop = Math.min(sc.scrollHeight, before + step); } catch { break; }
            await nap(180);
            labelsOf().forEach((l) => seen.add(l));
            if (sc.scrollTop === before) {                   // at the bottom
                await nap(180);                              // let a late-drawing tail land, then read once more
                labelsOf().forEach((l) => seen.add(l));
                break;
            }
        }
    }

    const all = [...seen];
    // Same rule as the item path: the scroll-walk reaches only what it drew, and
    // it was measured reaching 12 of 16. On a short read only an exact label is
    // trusted, and a miss is an interaction failure to retry, not a refusal to
    // cache — a near-match or a "not found" here can both be the tail we never
    // scrolled to.
    const complete = readComplete(all.length);
    // exactOnly forces an exact-label match even on a complete list — the
    // single-select's rule (a near-match on a closed taxonomy is a fabricated
    // claim: "Marketing" must never commit as "Marketing Management"). Skills
    // passes it false and keeps its lone-near-match convenience.
    const target = pickLabel(all, want, { exactOnly: exactOnly || !complete });
    const evidence = { want: String(want ?? ''), shown: all.length, sample: all.slice(0, 4), via: 'labels', declared, chose };
    if (!target) {
        if (!complete) {
            return { option: null, why: RESULT.OPEN_TIMEOUT, ...evidence, reason: `read ${all.length}/${declared} — list still filling` };
        }
        const near = all.filter((l) => fold(l).includes(fold(want)));
        return near.length > 1
            ? { option: null, why: RESULT.AMBIGUOUS, ...evidence, saw: [...new Set(near)].slice(0, 4) }
            : { option: null, why: RESULT.OPTION_NOT_FOUND, ...evidence };
    }

    // Bring the chosen TEXT back into view and hand back whatever node is
    // showing it now — never the one seen while scanning.
    const live = () => visibleOptions().find((o) => fold(txt(o)) === fold(target)) || null;
    if (live()) return { option: live(), matched: target };
    // Known index + known row height = one scroll, not a walk.
    if (sc && items) {
        const at = items.findIndex((it) => fold(String(it?.label ?? it?.ariaLabel ?? '')) === fold(target));
        const h = virtualRowHeight(sc);
        if (at >= 0 && h) {
            try { sc.scrollTop = Math.max(0, (at * h) - Math.round(sc.clientHeight / 2) + h); } catch { /* no layout */ }
            await nap(200);
            if (live()) return { option: live(), matched: target };
        }
    }
    if (sc) {
        try { sc.scrollTop = 0; } catch { /* no layout */ }
        await nap(80);
        for (let i = 0; i < maxWindows; i++) {
            if (live()) return { option: live(), matched: target };
            const before = sc.scrollTop;
            try { sc.scrollTop = Math.min(sc.scrollHeight, before + Math.max(60, sc.clientHeight - 40)); } catch { break; }
            await nap(100);
            if (sc.scrollTop === before) break;
        }
    }
    return live()
        ? { option: live(), matched: target }
        : { option: null, why: RESULT.OPEN_TIMEOUT, ...evidence, reason: `"${target}" would not come back into view` };
}

/**
 * Type a term the way a keyboard does — WITHOUT paying a throttled timer per
 * character.
 *
 * MEASURED in a hidden tab on 2026-08-09: `setTimeout(…, 30)` actually took
 * 989.6ms. Chrome clamps a hidden tab's timers to ≥1s (and to ~one fire a
 * minute after five hidden minutes — dom.js records the same measurement, "a
 * 30-second list walk stretched to 25 minutes"). `simulateTyping` sleeps 30ms
 * PER CHARACTER through exactly that clock, so "Agile/Scrum" cost 10.9 seconds
 * and eight skills cost 87 — before a single search had been submitted. The
 * page advanced on its optional-field rule long before the field was done, and
 * the result looked exactly like Skills being skipped.
 *
 * The pause is not what makes this work: the search does not fire until ENTER,
 * so nothing debounces between the keystrokes. What matters is that each
 * character arrives as its own keydown/value/keyup, and that is kept.
 */
export function typeInto(el, text) {
    el.focus?.();
    setNativeValue(el, '');
    let typed = '';
    for (const char of String(text)) {
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true })); } catch { /* noop */ }
        typed += char;
        setNativeValue(el, typed);
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true })); } catch { /* noop */ }
    }
}

export function pressEnter(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
        try {
            el.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true, composed: true,
            }));
        } catch { /* a control that cannot take an event will fail the verify */ }
    }
}

/**
 * A signature of what the results list is showing, so "has the search answered?"
 * is a question about the ROWS and not about elapsed time.
 *
 * "No Items." is excluded deliberately: it is the state BEFORE an answer, so a
 * key built from it would report the pre-search list as a result.
 */
export function resultsKey() {
    const rows = visibleOptions()
        .map((o) => txt(o))
        .filter((t) => t && !NOT_A_CHOICE.test(t));
    return rows.join('|');
}

/**
 * Wait for the result set to become something other than what it was.
 *
 * Not "wait for options to exist" — they already do, and they say "No Items."
 */
export async function waitForResults(before, { sleep, budgetMs = 6000 } = {}) {
    const nap = napper(sleep);
    const by = Date.now() + budgetMs;
    let candidate = null;
    for (;;) {
        const now = resultsKey();
        // SETTLED, not merely CHANGED. Returning at the first key change is
        // returning at the earliest possible moment — mid-render, before the
        // tail of the list exists. MEASURED on R-170139 (2026-08-10): the same
        // term flipped between passes in BOTH directions ("retention
        // optimization" miss→commit, "unit economics" four rows→none), and
        // every miss's sample held only the first rendered window while an
        // idle read of the same search showed all 16 rows. So an answer only
        // counts once the SAME non-empty key has been read twice in a row.
        if (now && now !== before) {
            if (now === candidate) return now;
            candidate = now;
        }
        if (Date.now() >= by) return candidate;   // one sighting beats none
        await nap(150);
    }
}

/**
 * What `after` holds that `before` did not — as a MULTISET, so a second copy of
 * a chip that was already there counts as new. Comparing sets would call a
 * duplicate "nothing happened", which is the one answer it must not give.
 */
export function freshOnes(before, after) {
    const pool = [...before];
    const out = [];
    for (const c of after) {
        const i = pool.indexOf(c);
        if (i >= 0) pool.splice(i, 1);
        else out.push(c);
    }
    return out;
}

/**
 * What this field is showing, in words, for a human reading a report.
 *
 * NOT a commit signal and never used as one: each capability's `verify` stays
 * the only authority on whether something committed. This is for the preflight
 * table, where the useful column is "what is in there right now".
 */
export function readNow(f) {
    const c = f.controls();
    if (f.kind === WIDGET.DATE) {
        const at = (el) => el?.getAttribute('aria-valuenow') || '—';
        return c.day ? `${at(c.month)}/${at(c.day)}/${at(c.year)}` : `${at(c.month)}/${at(c.year)}`;
    }
    if (f.kind === WIDGET.SEARCH_MULTI) return c.chips.map(txt).join(' | ') || '(no chips)';
    if (f.kind === WIDGET.CHECKBOX) return c.checkbox?.checked ? 'ticked' : 'unticked';
    if (f.kind === WIDGET.LISTBOX) {
        const shown = txt(c.button) || c.text?.value || '';
        return isPlaceholder(shown) || !shown ? '(Select One)' : shown;
    }
    return (c.text || c.textarea)?.value || '(empty)';
}

// ── the capabilities ─────────────────────────────────────────────────────

const text = {
    /** Idempotent: a box that already says it is not typed into again. */
    satisfied: (f, want) => fold(f.controls().text?.value || f.controls().textarea?.value) === fold(want),
    /**
     * Write it, then LET GO of it — the blur is not politeness, it is the
     * commit.
     *
     * MEASURED (R-174102, 2026-08-09), and it cost a whole run: every text
     * field on My Experience displayed its value, every verify passed, no row
     * showed an error — and Save and Continue came back "The field Job Title is
     * required and must have a value" for three titles that were plainly on the
     * screen. Workday's model had none of them. Blurring each field, changing
     * nothing else, cleared all seven errors: 3 × Job Title, 3 × Company, 1 ×
     * School.
     *
     * So `setNativeValue` paints the box and Workday takes the value on blur.
     * Without it a field is written, verified, and still empty as far as the
     * ATS is concerned — the `valueAsCommitProof` hazard in config.js, arriving
     * from the one direction nothing here was watching.
     */
    async commit(f, want) {
        const c = f.controls();
        const el = c.text || c.textarea;
        if (!el) return { result: RESULT.WAITING_HYDRATION, reason: 'no control yet' };
        try { el.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        el.focus?.();
        setNativeValue(el, String(want));
        // The order is the measurement: focusout is what Workday's own handler
        // listens through, and blur() alone does not bubble to it.
        try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }
        catch { try { el.dispatchEvent(new Event('focusout', { bubbles: true })); } catch { /* noop */ } }
        try { el.blur?.(); } catch { /* the control refuses; verify will say so */ }
        return { result: RESULT.COMMITTED };
    },
    /**
     * Read it, then read it AGAIN after the page has had a chance to change its
     * mind. The second read is the whole verify: the measured failure is a value
     * that is there and then is not.
     */
    async verify(f, want, ctx = {}) {
        const now = () => {
            const c = f.controls();
            return fold((c.text || c.textarea)?.value);
        };
        const landed = await until(() => now() === fold(want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!landed) return { result: RESULT.COMMIT_FAILED, reason: `value never read back (${now() || 'empty'})` };

        // Then WATCH it, on the wall clock rather than for one nap: the failure
        // being caught is a value that is there and then is not, and a verifier
        // whose watch shrinks with the caller's sleep would miss exactly that.
        const nap = napper(ctx.sleep);
        const watchUntil = Date.now() + (ctx.stableMs || 250);
        while (Date.now() < watchUntil) {
            // 50, NOT 40: dom.js sleep() bypasses the AGENT_SLEEP worker clock for
            // ms < 50 ("too short to matter") and hands back a bare setTimeout —
            // which a HIDDEN tab throttles to ~one fire a MINUTE. Native commits
            // dominate My Experience, so a 40ms poll here turned each into a ~60s
            // stall (measured build 9d8925a: My Experience 187s of a 251s run). At
            // 50 the wait borrows the worker clock and the poll stays ~50ms while
            // hidden, keeping this a periodic wall-clock watch, not a single 60s one.
            await nap(50);
            if (now() !== fold(want)) return { result: RESULT.COMMIT_FAILED, reason: 'value did not stick' };
        }
        // A row error is checked AFTER the field has been let go of, because
        // that is when Workday gets to disagree. Checked before the blur it says
        // nothing at all — which is exactly how seven required-field errors
        // stayed invisible until Save and Continue.
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

const checkbox = {
    satisfied: (f, want) => !!f.controls().checkbox?.checked === !!want,
    async commit(f) {
        const box = f.controls().checkbox;
        if (!box) return { result: RESULT.WAITING_HYDRATION, reason: 'no box yet' };
        // Below the fold, a click hit-tests as whatever covers that point.
        try { box.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        box.click();
        return { result: RESULT.COMMITTED };
    },
    /**
     * Checked is not enough. Measured on the language rows: Workday swallows a
     * tick during re-hydration and leaves the row's error standing, so the state
     * says yes while the form says no.
     */
    async verify(f, want, ctx = {}) {
        const ok = await until(() => !!f.controls().checkbox?.checked === !!want,
            { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: 'tick did not take' };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

const listbox = {
    satisfied(f, want) {
        const c = f.controls();
        const shown = txt(c.button) || c.text?.value || '';
        return !isPlaceholder(shown) && fold(shown) === fold(want);
    },
    async commit(f, want, ctx = {}) {
        const trigger = triggerOf(f);
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };
        let picked = null;
        const r = await withList(trigger, async (lease) => {
            const choice = chooseOption(lease.options(), want);
            if (!choice.option) {
                return { result: choice.why, saw: choice.saw, want: choice.want, shown: choice.shown, sample: choice.sample };
            }
            picked = choice.matched;
            choice.option.click();
            return { result: RESULT.COMMITTED };
        }, { sleep: ctx.sleep, label: f.name });
        if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
        return { ...r.value, picked };
    },
    async verify(f, want, ctx = {}) {
        const shown = () => {
            const c = f.controls();
            return txt(c.button) || c.chips.map(txt).join(' | ') || c.text?.value || '';
        };
        const ok = await until(() => !isPlaceholder(shown()) && fold(shown()).includes(fold(want)),
            { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: `field still reads "${shown() || 'Select One'}"` };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

/**
 * The live option rows that ARE this label — deduped down to what a click can
 * trust. Three realities page-wide reads must survive:
 *   · a row can surface as menuItem AND its inner promptOption (one row, two
 *     matching nodes) — keep the outermost, it holds the checkbox;
 *   · a committed CHIP carries a promptOption of its own — not an option;
 *   · a closing list lingers beside the new one (measured: orphansBefore 30),
 *     so the same row exists once per list INSTANCE — judge uniqueness inside
 *     the NEWEST list that shows the label, not across stale twins.
 * What remains ambiguous after all that (same-text twins in ONE list — a create
 * row beside a catalog row of the same text) is genuinely undecidable by DOM,
 * and the caller hands it to the data write, which carries the id.
 */
function rowsByLabel(label) {
    let m = visibleOptions().filter((o) => fold(txt(o)) === fold(label)
        && !o.closest?.('[data-automation-id="selectedItem"]'));
    m = m.filter((o) => !m.some((p) => p !== o && p.contains?.(o)));
    const byList = new Map();
    for (const o of m) {
        const c = o.closest?.('[data-automation-id="activeListContainer"], [role="listbox"]') || o.parentElement || o;
        const arr = byList.get(c) || [];
        arr.push(o);
        byList.set(c, arr);
    }
    const lists = [...byList.values()];
    return lists.length ? lists[lists.length - 1] : [];   // document order — the newest list wins
}

/**
 * Remove ONE chip this run just created by MISTAKE. The DELETE charm answers
 * only to a mousedown-led sequence — a bare .click() is a no-op (measured
 * 2026-08-13). Never used on pre-existing chips: those may be the candidate's
 * own, and nothing in this engine removes a chip it did not just add.
 */
async function removeFreshChip(f, text, ctx = {}) {
    const chip = f.controls().chips.find((c) => fold(txt(c)) === fold(text));
    const charm = chip?.querySelector?.('[data-automation-id="DELETE_charm"]');
    if (!charm) return false;
    for (const [name, type] of [['PointerEvent', 'pointerdown'], ['MouseEvent', 'mousedown'], ['PointerEvent', 'pointerup'], ['MouseEvent', 'mouseup'], ['MouseEvent', 'click']]) {
        try {
            const Ctor = typeof globalThis[name] === 'function' ? globalThis[name] : MouseEvent;
            charm.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
        } catch { /* keep going — a missed rung is not a crash */ }
    }
    // The VERDICT is whether the chip is actually gone — a rollback that only
    // dispatched events has not rolled anything back, and saying so is what
    // lets the caller escalate instead of reporting "rolled back" over a chip
    // still sitting on the application.
    return until(() => !f.controls().chips.some((c) => fold(txt(c)) === fold(text)), { sleep: ctx.sleep, budgetMs: 1500 });
}

const searchMulti = {
    /**
     * Chips are the truth, and they are also somebody's data.
     *
     * A chip already on the page may be the candidate's own from another
     * application, so nothing here removes one. And re-typing eight terms to
     * re-learn "already there" cost 39-44 seconds a pass, which is what this
     * check buys back.
     */
    /**
     * A chip counts when it is the ANSWER to what was asked, which is not always
     * the same string. Measured on countryPhoneCode: the value asked for is
     * "Vietnam" and the committed chip reads "Vietnam (+84)" — the catalogue's
     * own wording. So a chip is matched the way an option is chosen: exactly, or
     * as the single chip that contains it. Two chips containing it is not an
     * answer, it is two.
     */
    satisfied(f, want) {
        const chips = f.controls().chips.map((c) => fold(txt(c)));
        return [...want].every((w) => {
            const t = fold(w);
            if (chips.includes(t)) return true;
            return chips.filter((c) => c.includes(t)).length === 1;
        });
    },
    /** The chips this field is showing right now, as text. */
    chipsNow: (f) => f.controls().chips.map((c) => txt(c)),
    /**
     * The chips that could be this term's answer — read exactly as `satisfied`
     * reads them, or the two would disagree about the same page.
     *
     * An EXACT chip settles it: "Figma" answered by a chip reading "Figma" is
     * one answer, and a "Figma Design" sitting beside it is a different skill,
     * quite possibly the candidate's own. Only when nothing matches exactly do
     * the loose ones count, and then two of them is an ambiguity rather than an
     * answer.
     */
    holding(f, term) {
        const t = fold(term);
        const chips = this.chipsNow(f);
        const exact = chips.filter((c) => fold(c) === t);
        return exact.length ? exact : chips.filter((c) => fold(c).includes(t));
    },
    async commit(f, want, ctx = {}) {
        // A TERM THAT ALREADY HAS A CHIP IS NEVER CLICKED AGAIN — and that is
        // not the same question as "is it satisfied".
        //
        // `satisfied` is strict: two chips containing one term is not an answer,
        // it is two, so it reports false. Driving the click list off it meant a
        // term with two chips read as MISSING on every pass and was picked
        // again, and again — one more chip each time. That is the row-growth
        // shape, in chips, and it is why this asks a different question: does
        // the page already hold anything for this term?
        const already = [...want].filter((w) => this.holding(f, w).length > 1);
        if (already.length) {
            // Over-answered. Semantic, so it is remembered and never repeated;
            // nothing here removes a chip, because a chip may be the
            // candidate's own.
            return {
                result: RESULT.AMBIGUOUS,
                reason: `"${already[0]}" already has ${this.holding(f, already[0]).length} chips`,
                saw: this.holding(f, already[0]).slice(0, 4),
            };
        }
        const missing = [...want].filter((w) => this.holding(f, w).length === 0);
        const added = [];
        const missed = [];
        for (const term of missing) {
            // What the list showed BEFORE this term's search — the thing the
            // answer has to differ from. Read per term, because the previous
            // term's results are still on screen.
            const baseline = resultsKey();
            const trigger = triggerOf(f);
            if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
            // THE CLICK OPENS IT, THE TYPING FILTERS IT — two acts, and this
            // used to do only the second.
            //
            // MEASURED on Skills (R-174102, 2026-08-09), by hand on the live
            // widget: focus + a written value opens NOTHING, and that is the
            // whole of the OPEN_TIMEOUT ×3 at ~8 seconds each. A plain click
            // opens the list immediately — `activeListContainer[role=listbox]`,
            // which is exactly what `visibleLists()` looks for — and the value
            // written after it filters what is inside. Enter is not part of it:
            // pressed on a real keyboard it committed nothing.
            //
            // RETRACTED 2026-08-09: this comment used to say the catalogue was
            // empty because every term answered "No Items.". It is not empty —
            // the query had never been submitted. See pressEnter.
            //
            // The Enter stays, and is deliberately last. It is what opens a
            // search prompt that answers to typing alone (v1 measured that shape
            // on SmartRecruiters, and the harness models it); on the Mondelez
            // widget above it is inert — pressed on a real keyboard it neither
            // opened, filtered nor committed anything. Two measured shapes, one
            // activation, and neither rung undoes the other.
            // TYPE IT LIKE A KEYBOARD, THEN SUBMIT IT. A single setNativeValue
            // leaves the widget with a value it never saw arrive, and the search
            // never fires — measured, and measured the same way by v1 before
            // this file existed.
            const activate = async (t) => {
                t.focus?.();
                t.click?.();
                typeInto(t, term);                // clears first, then char by char
                pressEnter(t);
            };
            const r = await withList(trigger, async (lease) => {
                // ONE verifier for BOTH commit channels — the click and the
                // data write are judged by the same law, on what the page
                // GAINED:
                //   · exactly one chip that READS as the picked label → committed;
                //   · several chips → a group row: semantic, reported, kept
                //     (the term's own chip is among them and may be wanted);
                //   · one DIFFERENT chip → our misfire: rolled back, and a
                //     rollback that does not STICK is safety-fatal — wrong data
                //     is on the application and only a person removes it, so
                //     the page must not advance over it;
                //   · none → nothing to undo, the caller's verdict stands (null).
                // A near-miss is a miss: "Agile Framework" for "Agile" is a
                // different skill, and the old substring tolerance was exactly
                // how one became the other in silence.
                const judgeFresh = async (expectedLabel, before) => {
                    const fresh = freshOnes(before, this.chipsNow(f));
                    if (fresh.length === 1 && fold(fresh[0]) === fold(expectedLabel)) {
                        added.push(fresh[0]);
                        return { fresh, verdict: { result: RESULT.COMMITTED, term } };
                    }
                    if (fresh.length > 1) {
                        return { fresh, verdict: { result: RESULT.AMBIGUOUS, term, reason: `one answer added ${fresh.length} chips`, saw: fresh.slice(0, 4) } };
                    }
                    if (fresh.length === 1) {
                        const removed = await removeFreshChip(f, fresh[0], ctx);
                        if (!removed) {
                            return {
                                fresh,
                                verdict: {
                                    result: RESULT.ROLLBACK_FAILED, term,
                                    reason: `landed "${fresh[0]}" instead of "${expectedLabel}" and it could not be removed — remove that chip by hand`,
                                    saw: fresh,
                                },
                            };
                        }
                        return { fresh, verdict: { result: RESULT.COMMIT_FAILED, term, reason: `landed "${fresh[0]}", wanted "${expectedLabel}" — rolled back`, saw: fresh } };
                    }
                    return { fresh, verdict: null };
                };
                // Write the DECIDED item through the widget's own handler.
                // Serves both "the row will not render" (hidden tail) and "no
                // DOM node can be trusted to BE the item" (same-text twins,
                // vanished row).
                const fiberRescue = async (item) => {
                    const before = this.chipsNow(f);
                    const props = readSkillsOnSelect(triggerOf(f));
                    let via = 'none';
                    // The bridge (or a same-world write) reports whether the STATE
                    // commit took — values now hold the term — which is the truth a
                    // background-throttled tab hides from the DOM: the write persists
                    // to Save even while the virtualiser's paint is still deferred.
                    let stateLanded = false;
                    if (props) {
                        const already = props.values.some((v) => fold(v?.label ?? '') === fold(item.label));
                        if (!already) props.onSelect([...props.values, { label: item.label, id: item.id }]);
                        via = 'direct';
                        stateLanded = true;
                    } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        try {
                            const resp = await new Promise((resolve) => {
                                const t = setTimeout(() => resolve(null), 8000);   // a dead worker must not hang the term
                                chrome.runtime.sendMessage(
                                    { type: 'SKILL_FIBER_WRITE', label: item.label, id: item.id },
                                    (r) => { void chrome.runtime.lastError; clearTimeout(t); resolve(r); },
                                );
                            });
                            via = 'bridge';
                            stateLanded = !!(resp && resp.ok && resp.landed);
                        } catch { /* no extension context — the caller's verdict stands */ }
                    }
                    if (via === 'none') {
                        // Says WHY the rescue stood down — absence of this line
                        // cost a whole diagnostic run once.
                        trace('mdlz.skill.fiberWrite', { term, via, landed: false });
                        return null;
                    }
                    await until(() => this.holding(f, term).length > 0,
                        { sleep: ctx.sleep, budgetMs: ctx.fiberMs || 4000 });
                    const { fresh, verdict } = await judgeFresh(item.label, before);
                    trace('mdlz.skill.fiberWrite', {
                        term, via, chip: fresh[0] || '(none)', free: item.free,
                        landed: fresh.length > 0 || stateLanded, matched: verdict?.result === RESULT.COMMITTED,
                    });
                    // The write is PRECISE by construction — onSelect adds exactly
                    // {label:item.label}, never a recycled row's skill — so there is
                    // no wrong-chip to guard against here. When judgeFresh saw a
                    // fresh chip its verdict stands; when it saw NONE only because
                    // the paint is still throttled, the confirmed state commit is
                    // the COMMIT. A non-null NON-committed verdict (2 chips) still
                    // wins — it is a real anomaly, not a throttled paint.
                    if (!verdict && stateLanded) {
                        added.push(item.label);
                        return { result: RESULT.COMMITTED, term };
                    }
                    return verdict;   // null = nothing landed, caller's verdict stands
                };
                // THE LIST OPENS BEFORE THE SEARCH ANSWERS. Reading it now gets
                // the "No Items." placeholder, which is how a taxonomy that has
                // the term reports OPTION_NOT_FOUND. Wait for the ROWS to change.
                let answered = await waitForResults(baseline, { sleep: ctx.sleep, budgetMs: ctx.searchMs || 6000 });
                if (!answered) {
                    // A slow search answers after the budget, and one more Enter
                    // re-runs the same query — measured by v1: terms that
                    // committed in one run no-matched in the next, purely on
                    // server latency. Retry once before concluding anything.
                    pressEnter(trigger);
                    answered = await waitForResults(baseline, { sleep: ctx.sleep, budgetMs: 4000 });
                }
                if (!answered) return { result: RESULT.OPEN_TIMEOUT, term, reason: 'the search never answered' };

                const choice = await pickAcrossList(lease, term, { sleep: ctx.sleep });
                if (!choice.option) {
                    // THE ROW WILL NOT RENDER (or cannot be trusted), BUT THE
                    // ANSWER IS DECIDED — write it by DATA (measured 4/4,
                    // ~600ms, chip verified). Only for a FINAL choice that
                    // failed on INTERACTION (OPEN_TIMEOUT) — semantic verdicts
                    // (not-found, ambiguous) stay refusals.
                    if (choice.chose && choice.why === RESULT.OPEN_TIMEOUT) {
                        const rescued = await fiberRescue(choice.chose);
                        if (rescued) return rescued;
                    }
                    // Forward the WHOLE verdict, not a hand-picked five. pickAcrossList
                    // measures via/itemsLen/declared/reason precisely so mdlz.skill.miss
                    // can name a partial read apart from a real absence; stripping them
                    // here is what left the diagnostic columns null on every miss.
                    return { ...choice, result: choice.why, term };
                }
                // Re-read by LABEL and click THAT, never a node held from a
                // moment ago: the virtualiser recycles rows, and the measured
                // cost was chips for "Agentforce" and "Agile Systems" nobody
                // asked for. EXACTLY ONE live row may claim the label; a row
                // that vanished or multiplied goes to the data write instead —
                // never "whatever node now sits at the old offset", because the
                // API's order and the UI's order can disagree.
                const live = rowsByLabel(choice.matched);
                if (live.length !== 1) {
                    const rescued = await fiberRescue({ label: choice.matched, id: choice.id ?? choice.matched, free: !!choice.free });
                    if (rescued) return rescued;
                    return { result: RESULT.COMMIT_FAILED, term, reason: `the picked row ${live.length ? 'multiplied' : 'vanished'} before the click` };
                }
                const again = { option: live[0] };

                // WHAT THE PAGE GAINED IS THE VERDICT — not what we meant to
                // click. Re-reading by label narrows the window in which the
                // virtualiser can swap a row out from under us; it does not
                // close it, and nothing downstream would ever notice. `added`
                // used to record our INTENTION, and the only check afterwards
                // asked whether the wanted terms had chips — never whether
                // anything else had arrived with them.
                const before = this.chipsNow(f);
                // CLICK THE CHECKBOX, NOT THE ROW.
                //
                // MEASURED on R-174102, 2026-08-09, by trying both on the live
                // widget: `row.click()` on the menuItem[role=option] added
                // NOTHING; the `input[type=checkbox]` inside it added the chip
                // on the first try. This search result is a checkbox list, and
                // the row is only its label.
                //
                // That one line is the whole of "the click added no chip" —
                // four terms found their exact row and every one of them was
                // clicked somewhere that does not commit.
                const box = again.option.querySelector('input[type="checkbox"]');
                (box || again.option).click();
                await until(() => this.chipsNow(f).length !== before.length,
                    { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
                // THE SAME LAW AS THE DATA WRITE — judgeFresh. The click used to
                // keep a looser rule ("contains the term counts"), which is how
                // a wanted "Agile" could quietly become an "Agile Framework"
                // chip and be called success; and its wrong-chip verdict left
                // the wrong chip standing. One verifier, both channels.
                const { fresh, verdict } = await judgeFresh(choice.matched, before);
                if (!verdict) {
                    // THE CLICK ADDED NOTHING — try ENTER before giving up.
                    //
                    // MEASURED on Maersk (R192834, 2026-08-14) by doing it live: on
                    // its create-only Skills widget the checkbox click commits
                    // NOTHING, but typing the term, letting the search resolve, and
                    // pressing ENTER adds the create-row chip (verified for both a
                    // catalogued-looking term and a pure free-text one). The term is
                    // already typed and the list is still open here, so one Enter is
                    // the whole of it. The SAME judgeFresh guards it — a wrong result
                    // is rolled back, not kept — and a tenant where the click already
                    // worked never reaches this branch, so MDLZ is untouched.
                    pressEnter(trigger);
                    await until(() => this.chipsNow(f).length !== before.length,
                        { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
                    const byEnter = await judgeFresh(choice.matched, before);
                    if (!byEnter.verdict) {
                        // CLICK AND ENTER BOTH COMMIT THROUGH THE PAINT — and a
                        // background-throttled tab DEFERS the virtualiser's paint
                        // past any DOM-verify budget. MEASURED on Maersk (R192834,
                        // 2026-08-14, hidden:true): the chip for every skill landed
                        // only AFTER the 1.5s verify gave up, so each read as
                        // COMMIT_FAILED and the field netted ZERO skills. React's
                        // STATE commit is not throttled — the fiber onSelect write
                        // lands the chip in ~780ms even hidden (measured 4/4). This
                        // is the SAME rescue the hidden tail already uses; the bridge
                        // dedups by state, so a click/Enter that DID commit late is
                        // not written twice.
                        const rescued = await fiberRescue({ label: choice.matched, id: choice.id ?? choice.matched, free: !!choice.free });
                        if (rescued) return rescued;
                        // Nothing landed by click, Enter, or state write. Safe to try
                        // again, unlike a judged branch — nothing was added to roll back.
                        return { result: RESULT.COMMIT_FAILED, term, reason: 'neither the click, Enter, nor fiber write added a chip' };
                    }
                    if (byEnter.verdict.result === RESULT.COMMITTED) {
                        const pill = f.controls().chips.map((c) => ({ t: txt(c), id: c.id || '' }))
                            .find((c) => c.t === byEnter.fresh[0]);
                        trace('mdlz.skill.add', {
                            term, chip: byEnter.fresh[0], via: 'enter',
                            free: pill ? !/REMOTE_SKILL/i.test(pill.id) : (choice.free ?? null),
                        });
                    }
                    return byEnter.verdict;
                }
                if (verdict.result === RESULT.COMMITTED) {
                    // WHICH KIND of chip landed, read off the chip itself: a
                    // catalog pick carries pill-REMOTE_SKILL-…, the candidate's
                    // own words carry pill-<the text>. The review step is where
                    // a human checks this, so the trace must say which is which.
                    const pill = f.controls().chips.map((c) => ({ t: txt(c), id: c.id || '' }))
                        .find((c) => c.t === fresh[0]);
                    trace('mdlz.skill.add', {
                        term,
                        chip: fresh[0],
                        free: pill ? !/REMOTE_SKILL/i.test(pill.id) : (choice.free ?? null),
                    });
                }
                return verdict;
            }, { sleep: ctx.sleep, label: `${f.name}:${term}`, activate });

            // ONE TERM THAT MISSES MUST NOT TAKE THE OTHER SEVEN WITH IT.
            //
            // This used to `return` on the first term the catalogue could not
            // answer, so "Agile/Scrum" missing meant the remaining skills were
            // never even typed. A multi-value field is a list of independent
            // little transactions; one of them failing is a gap, not the end.
            const outcome = r.ok ? (r.value || {}) : { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
            if (outcome.result !== RESULT.COMMITTED) {
                missed.push({ term, ...outcome });
                trace('mdlz.skill.miss', {
                    term, why: outcome.result, reason: outcome.reason || '',
                    via: outcome.via || 'labels', itemsLen: outcome.itemsLen ?? null, declared: outcome.declared ?? null,
                    sample: (outcome.sample || outcome.saw || []).join(' | ') || '(none)',
                });
                continue;
            }
        }
        const names = missed.map((m) => m.term);
        if (added.length) return { result: RESULT.COMMITTED, added, missed: names };
        if (!missed.length) return { result: RESULT.COMMITTED, added };
        // NOTHING LANDED — report the FIRST REAL REASON, not a generic one.
        // Flattening every per-term outcome into OPTION_NOT_FOUND threw away
        // the two verdicts that actually say something went wrong with a pick
        // ("one click added 2 chips", "clicked X but got Y").
        return { ...missed[0], added, missed: names };
    },
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
        if (!ok) {
            const have = f.controls().chips.map((c) => txt(c));
            return { result: RESULT.COMMIT_FAILED, reason: `chips read ${have.join(' | ') || '(none)'}` };
        }
        return { result: RESULT.COMMITTED };
    },
};

/**
 * A SINGLE-select behind the same chip-search shape as searchMulti — a widget
 * the DOM cannot tell apart from a multi-select (probed side by side, Field of
 * Study R-172558 vs Skills R-173186, 2026-08-13: identical uxi-widget-types,
 * container, chip list, placeholder). Only the PLAN can say which one a field
 * is, so this capability is chosen by declared contract, never by fingerprint.
 *
 * MEASURED behavior (Field of Study, R-172558, 2026-08-13) — every rule below
 * is one of those measurements:
 *   · typing filters NOTHING; ENTER runs the search;
 *   · a query with exactly ONE result commits its chip on Enter alone;
 *   · a multi-result query filters but commits nothing — the exact row must be
 *     clicked;
 *   · a new commit REPLACES the existing chip (single-select), so a stale chip
 *     is never removed first;
 *   · the taxonomy is CLOSED (327 majors) — no create row, so a term the search
 *     cannot find exactly is OPTION_NOT_FOUND, never a free chip. The
 *     authoritative list lives FE-side (field-of-study-catalog.ts), where a CV
 *     value is pre-resolved to an exact label before dispatch; it is deliberately
 *     NOT in catalogs.js (that file is for small closed LISTBOXES like Degree — a
 *     search-backed field renders only its filtered subset, so a full-list
 *     snapshot there could not drift-guard anything). This engine matches the
 *     LIVE rendered options, never a local copy.
 *
 * `want` is ONE string. This is the other reason this engine exists: searchMulti
 * spreads `want` as a list, and a bare string spread into characters — Field of
 * Study was live-searched "M", "a", "r"… one letter at a time (R-173704).
 */
const searchSelect = {
    /** Exactly ONE chip, and it is the answer — the single-exact-chip invariant.
     *  sameConcept, not fold-equal: a picker commits the CATALOGUE's spelling, so
     *  "Marketing and Management" is the right answer to a CV's "Management and
     *  Marketing" — the reorder is the same field, not a mismatch to redo. It
     *  still refuses a narrower cousin, so a wrong chip never reads as satisfied. */
    satisfied(f, want) {
        const chips = f.controls().chips.map((c) => fold(txt(c)));
        return chips.length === 1 && sameConcept(chips[0], want);
    },
    chipsNow: (f) => f.controls().chips.map((c) => txt(c)),
    /**
     * Commit the EXACT item by a DATA WRITE off the list's fiber — no scroll, no
     * click, paint-independent.
     *
     * MEASURED LIVE (PwC 715624WD fieldOfStudy "Marketing", 2026-08-15): the
     * search returns 21 rows, the widget paints ~11 (indices 0–10, alphabetical),
     * and the exact "Marketing" (index 12) NEVER renders — scrolling does not
     * paint it, so there is no node to click. The list's own item array is on the
     * fiber (readVirtualItems walks to it), and each item carries an `onSelect`
     * whose commit path is `e => 'length' in e ? ee(e) : Q(e)`; calling
     * `item.onSelect([item])` takes the length-bearing branch and commits that
     * one item as the single chip in one call — verified live, no row error. This
     * is the single-select twin of the Skills fiber-write, and the same reason it
     * exists: a background popup throttles PAINT, never a React state-commit.
     *
     * Returns {done} — `avail` whether the fiber list was readable at all,
     * `committed` whether the chip stuck, `items` the labels in hand when no
     * exact matched (a DEFINITIVE miss, since the whole list is read, not a
     * painted window). EXACT ONLY: a near-match on a closed taxonomy is a
     * fabricated claim ("Marketing" must never commit as "Marketing Management").
     */
    async fiberCommit(f, term, ctx = {}) {
        // Read the item array off the fiber, trying the SAME anchor nodes
        // pickAcrossList trusts — the scroller first (the node the live widget
        // actually hangs its items on), then the list container and the first
        // option. `closest(listContainer)` alone MISSED it in a throttled popup
        // (measured live PwC 2026-08-15: pickAcrossList found the items from the
        // scroller and the exact "Marketing", but fiberCommit read null from the
        // container and fell through to the DOM path that cannot paint the row).
        // The PRECISE read — a faithful copy of the manual probe that committed
        // "Marketing" live (2026-08-15): climb from the REAL activeListContainer
        // and take `memoizedProps.items` of the CURRENT fiber ONLY, never
        // memoizedState and never `alternate` (the previous render's fiber, whose
        // item objects carry a STALE onSelect that no longer commits). The item
        // MUST carry a callable onSelect — that is the array whose write works.
        const preciseItems = () => {
            let L = null;
            try { L = document.querySelector('[data-automation-id="activeListContainer"]'); } catch { L = null; }
            if (!L) return null;
            const key = Object.keys(L).find((k) => /^__reactFiber\$|^__reactInternalInstance\$/.test(k));
            if (!key) return null;
            let node = L[key];
            for (let h = 0; node && h < 25; h++, node = node.return) {
                const it = node.memoizedProps && node.memoizedProps.items;
                if (Array.isArray(it) && it.length && it[0]
                    && ('label' in it[0] || 'ariaLabel' in it[0]) && typeof it[0].onSelect === 'function') return it;
            }
            return null;
        };
        // The precise read first (its items commit); readVirtualItems is the
        // fallback for a tenant whose list is shaped differently.
        const readItems = () => {
            const precise = preciseItems();
            if (precise) return precise;
            let opt = null;
            try { opt = visibleOptions()[0] || null; } catch { opt = null; }
            const anchors = [];
            try { if (opt) anchors.push(optionScroller(opt)); } catch { /* no layout */ }
            try { if (opt) anchors.push(opt.closest(SEL.listContainer)); } catch { /* gone */ }
            try { anchors.push(document.querySelector(SEL.listContainer)); } catch { /* gone */ }
            if (opt) anchors.push(opt);
            for (const n of anchors) {
                if (!n) continue;
                const got = readVirtualItems(n);
                if (Array.isArray(got) && got.length) return got;
            }
            return null;
        };
        // WAIT for the item array, do not read once. MEASURED live (PwC popup,
        // 2026-08-15): a single read returned null while pickAcrossList — which
        // polls the same fiber — found the items a beat later; a throttled popup
        // populates props.items after the DOM options settle. So poll it, the way
        // pickAcrossList does, before concluding the fiber is unreadable.
        let items = null;
        await until(() => { items = readItems(); return !!items; }, { sleep: ctx.sleep, budgetMs: ctx.searchMs || 6000 });
        if (!Array.isArray(items) || !items.length) {
            trace('mdlz.select.fiber', { field: f.name, term, avail: false });
            return { avail: false };
        }
        const labelOf = (it) => String(it?.label ?? it?.ariaLabel ?? '').trim();
        // sameConcept, not fold-equal: a closed catalogue that lists "Management
        // and Marketing" answers a CV's "Marketing and Management" — same words,
        // reordered — and that IS the exact field, not a near-match. It never
        // reaches a narrower cousin ("Marketing" ≠ "Digital Marketing"), so a
        // real gap still escalates. See text.js/sameConcept.
        const exact = items.find((it) => labelOf(it) && sameConcept(labelOf(it), term));
        const canWrite = exact && typeof exact.onSelect === 'function';
        trace('mdlz.select.fiber', { field: f.name, term, avail: true, itemsLen: items.length, exact: !!exact, onSelect: !!canWrite });
        if (exact) {
            if (!canWrite) return { avail: true, exact: true, committed: false };   // no handle → let the DOM path try
            try { exact.onSelect([exact]); }
            catch (e) { trace('mdlz.select.fiber', { field: f.name, term, writeError: String(e).slice(0, 60) }); return { avail: true, exact: true, committed: false }; }
            // A throttled popup can be slow to reflect the chip, so this waits
            // longer than a plain commit — the write itself is not paint-bound.
            const ok = await until(() => this.satisfied(f, term), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 2500 });
            trace('mdlz.select.fiber', { field: f.name, term, wrote: true, committed: ok });
            return { avail: true, exact: true, committed: ok };
        }
        return { avail: true, exact: false, items: items.map(labelOf).filter(Boolean) };
    },
    async commit(f, want, ctx = {}) {
        const term = String(want ?? '').trim();
        // The planner gaps an empty want before it ever becomes a task; an empty
        // term here means the plan is being bypassed, and guessing is worse.
        if (!term) return { result: RESULT.USER_REQUIRED, reason: 'nothing to search for' };
        const baseline = resultsKey();
        const trigger = triggerOf(f);
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
        // Same activation as the multi — click opens, typing writes the WHOLE
        // term, Enter (last, once) runs the search.
        const activate = (t) => {
            t.focus?.();
            t.click?.();
            typeInto(t, term);
            pressEnter(t);
        };
        const r = await withList(trigger, async (lease) => {
            // Watch the CHIP and the results in the SAME wait. A one-result query
            // commits on Enter and CLOSES the list before the results can ever
            // settle — MEASURED LIVE (R-172558, 2026-08-13: on commit the search
            // box clears and the option list closes) — so waiting only for the
            // list to settle burned the whole search budget (~searchMs) on a field
            // that had already succeeded. The chip is the truth; the results only
            // matter when NO chip arrives (several rows → click the exact one).
            // The settle rule (the same non-empty key read twice) is kept intact
            // for that click path — a half-rendered list must not be clicked.
            const nap = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((res) => setTimeout(res, ms)));
            const raceCommitOrResults = async (budgetMs, base = baseline) => {
                const by = Date.now() + budgetMs;
                let candidate = null;
                for (;;) {
                    if (this.satisfied(f, term)) return { committed: true };
                    const now = resultsKey();
                    if (now && now !== base) {
                        if (now === candidate) return { settled: now };
                        candidate = now;
                    }
                    if (Date.now() >= by) return { settled: candidate };   // one sighting beats none
                    await nap(150);
                }
            };

            let outcome = await raceCommitOrResults(ctx.searchMs || 6000);
            if (outcome.committed) {
                trace('mdlz.select.enter-commit', { field: f.name, term });
                return { result: RESULT.COMMITTED };
            }
            if (!outcome.settled) {
                pressEnter(trigger);
                outcome = await raceCommitOrResults(4000);
                if (outcome.committed) {
                    trace('mdlz.select.enter-commit', { field: f.name, term });
                    return { result: RESULT.COMMITTED };
                }
            }
            if (!outcome.settled) return { result: RESULT.OPEN_TIMEOUT, reason: 'the search never answered' };

            // Several results → filtered, nothing committed. Commit the EXACT row
            // by a DATA WRITE off the fiber (fiberCommit) — the painted window may
            // never include it. MEASURED LIVE (PwC 715624WD fieldOfStudy
            // "Marketing", 2026-08-15): 21 results, ~11 painted, "Marketing"
            // (index 12) never rendered, so the old DOM-click path — read the
            // fiber, scroll the exact row into view, click it — could never reach
            // it (scrolling does not paint the below-window rows). The item's own
            // onSelect([item]) commits it in one call, no scroll. The whole list
            // is read from the fiber, so a no-exact result here is DEFINITIVE, not
            // a painted-window artefact.
            //
            // The rows that just settled may be a PRE-SEARCH list — the one a
            // click opened before the server's filtered rows arrived (measured
            // concern, R-172558: a slow search lands after the initial list has
            // settled). So a no-exact verdict re-searches ONCE before concluding:
            // the slow filtered result surfaces the exact row; a genuine miss
            // re-settles to nothing new and concludes, one search later.
            let fib = await this.fiberCommit(f, term, ctx);
            if (fib.avail) {
                if (fib.exact && fib.committed) { trace('mdlz.select.fiber-commit', { field: f.name, term }); return { result: RESULT.COMMITTED }; }
                if (!fib.exact) {
                    // Whole list in hand, no exact — guard the pre-search race once.
                    pressEnter(trigger);
                    const again = await raceCommitOrResults(ctx.searchMs || 6000, outcome.settled);
                    if (again.committed) { trace('mdlz.select.enter-commit', { field: f.name, term }); return { result: RESULT.COMMITTED }; }
                    fib = await this.fiberCommit(f, term, ctx);
                    if (fib.avail && fib.exact && fib.committed) { trace('mdlz.select.fiber-commit', { field: f.name, term }); return { result: RESULT.COMMITTED }; }
                    if (fib.avail && !fib.exact) {
                        // exactOnly: a near-match on a closed taxonomy is fabrication.
                        const near = (fib.items || []).filter((l) => fold(l).includes(fold(term)));
                        return near.length
                            ? { result: RESULT.AMBIGUOUS, reason: 'no exact row; near-matches on a closed taxonomy', saw: [...new Set(near)].slice(0, 4) }
                            : { result: RESULT.OPTION_NOT_FOUND, reason: 'no exact row', sample: (fib.items || []).slice(0, 4) };
                    }
                }
                // fib.exact but the write did not stick → fall through to the DOM
                // path below as a last resort.
            }

            // FALLBACK — find the exact row via pickAcrossList. Its row will NOT
            // render to be clicked (measured live PwC "Marketing", below-window,
            // never paints), so commit `chose` {label,id} through the multiselect's
            // PARENT onSelect. That handler is bound even in a HIDDEN popup
            // (readSkillsOnSelect, the same write Skills use); the PER-ITEM
            // onSelect a visible tab exposes is NOT bound while throttled (measured
            // live: arraysWithWrite:0, hidden:true), which is why the item write
            // failed every attempt. exactOnly: sameConcept vs the term, never a
            // cousin — the chip is re-read after as the one commit signal.
            const writeChose = async (p) => {
                if (!(p && !p.option && p.chose && sameConcept(p.chose.label, term))) return null;
                const value = { label: p.chose.label, id: p.chose.id };
                let via = 'none';
                let stateLanded = false;
                // DIRECT (same-world) — works only if THIS context can see the
                // fiber. The content script is isolated-world and cannot, so this
                // succeeds in a test/main-world context and the bridge carries the
                // live agent, exactly as Skills' fiberRescue does.
                const props = readSkillsOnSelect(triggerOf(f));
                if (props && typeof props.onSelect === 'function') {
                    try { props.onSelect([value]); via = 'direct'; stateLanded = true; } catch { /* fall to bridge */ }
                }
                if (via === 'none' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    try {
                        const resp = await new Promise((resolve) => {
                            const t = setTimeout(() => resolve(null), 8000);
                            chrome.runtime.sendMessage(
                                { type: 'SELECT_FIBER_WRITE', field: f.name, label: value.label, id: value.id },
                                (r) => { void chrome.runtime.lastError; clearTimeout(t); resolve(r); },
                            );
                        });
                        via = 'bridge';
                        stateLanded = !!(resp && resp.ok);
                    } catch { /* no extension context */ }
                }
                if (via === 'none') return null;
                const wrote = await until(() => this.satisfied(f, term), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 4000 });
                trace('mdlz.select.parent-commit', { field: f.name, term, via, stateLanded, committed: wrote });
                // The STATE commit is the truth a throttled tab hides from the DOM:
                // when the write took but the chip has not painted, it is still
                // COMMITTED (it persists to Save) — the same rule Skills' fiber
                // write follows.
                return (wrote || stateLanded) ? { result: RESULT.COMMITTED } : null;
            };
            let pick = await pickAcrossList(lease, term, { sleep: ctx.sleep, exactOnly: true });
            // The rescue runs on the FIRST read's chose, BEFORE any re-search: an
            // exact chose from a complete read has nothing to gain from a
            // re-search, and re-searching first rebuilt the list and lost it
            // (measured PwC run 13:12). The re-search guard is for a possibly-stale
            // MISS, not a hit.
            {
                const wrote = await writeChose(pick);
                if (wrote) return wrote;
            }
            if (!pick.option && !pick.chose && pick.why !== RESULT.AMBIGUOUS) {
                pressEnter(trigger);
                const again = await raceCommitOrResults(ctx.searchMs || 6000, outcome.settled);
                if (again.committed) {
                    trace('mdlz.select.enter-commit', { field: f.name, term });
                    return { result: RESULT.COMMITTED };
                }
                pick = await pickAcrossList(lease, term, { sleep: ctx.sleep, exactOnly: true });
                const wrote = await writeChose(pick);
                if (wrote) return wrote;
            }
            if (!pick.option) {
                return { result: pick.why || RESULT.OPTION_NOT_FOUND, reason: pick.reason || 'no exact row', sample: pick.sample, saw: pick.saw };
            }
            const before = this.chipsNow(f);
            const box = pick.option.querySelector('input[type="checkbox"]');
            (box || pick.option).click();
            await until(() => this.chipsNow(f).join('|') !== before.join('|'),
                { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
            if (this.satisfied(f, term)) return { result: RESULT.COMMITTED };
            const now = this.chipsNow(f);
            return now.length
                ? { result: RESULT.AMBIGUOUS, reason: `clicked "${term}" but the field holds`, saw: now.slice(0, 4) }
                : { result: RESULT.COMMIT_FAILED, reason: 'the click added no chip' };
        }, { sleep: ctx.sleep, label: `${f.name}:${term}`, activate });
        if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
        return r.value || { result: RESULT.COMMIT_FAILED, reason: 'no verdict from the list' };
    },
    /** The single-exact-chip proof: one chip, fold-equal to the want. */
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
        if (ok) return { result: RESULT.COMMITTED };
        const have = this.chipsNow(f);
        return {
            result: RESULT.COMMIT_FAILED,
            reason: have.length > 1
                ? `a single-select holds ${have.length} chips: ${have.join(' | ')}`
                : `chips read ${have.join(' | ') || '(none)'}`,
        };
    },
};

const date = {
    read(f) {
        const c = f.controls();
        const n = (el) => Number(el?.getAttribute('aria-valuenow'));
        const out = { month: n(c.month), year: n(c.year) };
        if (c.day) out.day = n(c.day);
        return out;
    },
    satisfied(f, want) {
        const now = this.read(f);
        if (now.month !== want.month || now.year !== want.year) return false;
        // The day is only asked of a three-segment date; a month/year picker has
        // none, so a want without a day is satisfied by month+year alone.
        if (want.day != null && now.day !== want.day) return false;
        return true;
    },
    /**
     * TWO measured shapes, routed by a single structural fact: a DAY segment.
     *
     * The month/year work-date PICKER has no day and is not writable — its
     * display spinbuttons stay .value === "" no matter what a content script
     * writes, so it commits by opening the calendar and clicking the cell.
     *
     * The month/DAY/year Date-of-Birth field is the opposite (measured Maersk
     * R173118, 2026-08-14): three CONTROLLED React inputs whose onChange listens
     * through the native value setter, so setNativeValue + the input event it
     * dispatches commits — and a committed segment reads on BOTH .value and
     * aria-valuenow. v1's "date section writes nothing" was the KEYBOARD path on
     * this widget, which is not trusted and is not what this uses. Controls are
     * re-read per segment because a segment's onChange may re-render its siblings.
     */
    async commit(f, want, ctx = {}) {
        if (f.controls().day && want.day != null) {
            const nap = napper(ctx.sleep);
            const writeSeg = (key) => {
                const el = f.controls()[key];   // re-read: onChange may replace nodes
                if (!el) return false;
                try { el.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
                el.focus?.();
                setNativeValue(el, String(want[key]));
                // Let go the way the text executor does — focusout is the commit
                // Workday's own handler listens through.
                try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }
                catch { try { el.dispatchEvent(new Event('focusout', { bubbles: true })); } catch { /* noop */ } }
                try { el.blur?.(); } catch { /* the control refuses; verify will say so */ }
                return true;
            };
            // WRITE month → day → year, letting React FLUSH each segment's
            // re-render before the next is written. A segment's onChange replaces
            // its siblings' nodes; writing the next one in the SAME synchronous
            // tick lands the value on a node the re-render is about to discard.
            // MEASURED Maersk R192834 (2026-08-14): every segment's aria-valuenow
            // read the target, yet Workday kept the YEAR out of its date model and
            // validated "Invalid Date: 03/15/", because the year write hit a stale
            // node — a settle tick between segments closes that race.
            for (const key of ['month', 'day', 'year']) {
                if (!writeSeg(key)) return { result: RESULT.WAITING_HYDRATION, reason: `no ${key} segment yet` };
                await nap(120);
            }
            // aria-valuenow can read right while the model still rejects the date,
            // so the only truth is whether Workday STOPS reporting an invalid date.
            // Re-assert the year on the settled node until it clears: the field is
            // SATISFIED by aria-valuenow so nothing else re-touches it, and the
            // transient error would otherwise sit in the page's summary and hold
            // the advance for the ~16s it takes the run to give up.
            const invalidDate = () => errorsIn(f.find()).some((e) => /invalid date/i.test(e));
            for (let tries = 0; tries < 4; tries++) {
                if (await until(() => !invalidDate(), { sleep: ctx.sleep, budgetMs: 700 })) break;
                writeSeg('year');
            }
            return { result: RESULT.COMMITTED };
        }
        const icon = f.controls().icon;
        if (!icon) return { result: RESULT.WAITING_HYDRATION, reason: 'no calendar icon yet' };
        try { icon.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        icon.click();

        const cells = () => visibleMonthCells().map((c) => {
            const m = MONTH_LABEL.exec((c.getAttribute('aria-label') || '').trim());
            return m ? { node: c, month: MONTHS.indexOf(m[1]) + 1, year: Number(m[2]) } : null;
        }).filter(Boolean);

        if (!await until(() => cells().length > 0, { sleep: ctx.sleep, budgetMs: ctx.openMs || 4000 })) {
            return { result: RESULT.OPEN_TIMEOUT, reason: 'the picker did not open' };
        }

        // Walk the year with the panel's own arrows, re-reading the panel each
        // step — the year is shown by the cells, and the cells are replaced.
        for (let step = 0; step < 80; step++) {
            const shown = cells()[0]?.year;
            if (shown === want.year) break;
            // The arrows live in the panel that holds the cells, and that panel
            // is re-read every step — never the one we saw before the click.
            const panel = visiblePanels()[0];
            const arrow = panel?.querySelector(shown > want.year ? SEL.yearBack : SEL.yearForward);
            if (!arrow) return { result: RESULT.COMMIT_FAILED, reason: `no year arrow (showing ${shown})` };
            arrow.click();
            await until(() => cells()[0]?.year !== shown, { sleep: ctx.sleep, budgetMs: 600 });
        }

        const cell = cells().find((c) => c.month === want.month && c.year === want.year);
        if (!cell) return { result: RESULT.OPTION_NOT_FOUND, reason: `${MONTHS[want.month - 1]} ${want.year} not on the panel` };
        cell.node.click();
        return { result: RESULT.COMMITTED };
    },
    /**
     * aria-valuenow, NEVER .value. A committed date reads `.value === ""`, so a
     * verifier that trusts .value calls every correct date a failure — which it
     * did, for a whole run.
     */
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1500 });
        if (!ok) {
            const now = this.read(f);
            const shown = now.day != null ? `${now.month || '—'}/${now.day || '—'}/${now.year || '—'}` : `${now.month || '—'}/${now.year || '—'}`;
            return { result: RESULT.COMMIT_FAILED, reason: `aria-valuenow reads ${shown}` };
        }
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};


/**
 * A radio group — three defects' worth of rules, each already paid for.
 *
 * The recipe had no radio support at all, which is why My Information stalled:
 * Mondelez marks "Have you previously worked for this organization?" REQUIRED
 * and renders it as radios, so eleven fields were filled, that one was left, and
 * the advance is withheld while anything required is empty.
 *
 * What this does NOT do, each learned from a real defect:
 *   · It does not set `.checked`. An earlier version did, dispatched `change`,
 *     and reported success even when the policy had REFUSED the click — a
 *     refusal that silently became a mutation.
 *   · It does not match by substring alone. "No" is inside "Not applicable" and
 *     "None of the above", so an exact label wins first and a substring counts
 *     only when exactly one option has it.
 *   · It does not believe the click. Workday's radios sit under overlays; the
 *     only proof is re-reading `checked` afterwards.
 *
 * And it clicks the LABEL: the input itself is commonly invisible under a
 * styled control, so it is not a thing a click can land on.
 */
const radio = {
    options(f) {
        const wrap = f.find();
        return f.controls().radios.map((r) => {
            const byFor = r.id && wrap ? wrap.querySelector(`label[for="${r.id}"]`) : null;
            const label = byFor || r.closest?.('label') || null;
            return { input: r, label, text: (label?.textContent || '').replace(/\s+/g, ' ').trim() };
        });
    },
    pick(f, want) {
        const rows = this.options(f);
        const w = fold(want);
        // Shared exact predicate (sameConcept); the single-substring fallback is
        // unchanged.
        const exact = rows.filter((r) => sameConcept(r.text, want));
        if (exact.length === 1) return exact[0];
        const loose = rows.filter((r) => fold(r.text).includes(w));
        return loose.length === 1 ? loose[0] : null;
    },
    satisfied(f, want) {
        const hit = this.pick(f, want);
        return !!hit && !!hit.input.checked;
    },
    async commit(f, want) {
        const hit = this.pick(f, want);
        if (!hit) {
            const shown = this.options(f).map((r) => r.text).filter(Boolean);
            return shown.length
                ? { result: RESULT.AMBIGUOUS, reason: `no single option matches "${want}"`, saw: shown.slice(0, 4) }
                : { result: RESULT.WAITING_HYDRATION, reason: 'the group has no options yet' };
        }
        const target = hit.label || hit.input;
        try { target.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
        target.click();
        return { result: RESULT.COMMITTED };
    },
    async verify(f, want, ctx = {}) {
        // Re-read, always: the click may have been swallowed by whatever was
        // over it, and `checked` is the only thing that knows.
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 900 });
        if (!ok) return { result: RESULT.COMMIT_FAILED, reason: 'the click did not select it' };
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

/**
 * A searchable single-select — the widget that commits into its own box.
 *
 * Measured on Province or City (R-174262): a search-pick commits FOR REAL — the
 * next pass read the field as done and Workday never objected — but it leaves
 * no chip and no button text, only the value sitting in the input. A verifier
 * looking for a chip records a working click as no-commit.
 *
 * The catch is that the text we TYPED also sits in that input. What separates a
 * commit from our own typing is the popup: it closes on a pick. So the signal
 * is "the input holds the value AND no list is open" — both halves, or neither
 * means anything.
 */
const searchSingle = {
    shown: (f) => String(f.controls().text?.value || '').trim(),
    satisfied(f, want) {
        return fold(this.shown(f)) === fold(want) && visibleOptions().length === 0;
    },
    async commit(f, want, ctx = {}) {
        const trigger = f.controls().text;
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no search box yet' };
        let picked = null;
        const r = await withList(trigger, async (lease) => {
            const choice = chooseOption(lease.options(), want);
            if (!choice.option) {
                return { result: choice.why, saw: choice.saw, want: choice.want, shown: choice.shown, sample: choice.sample };
            }
            picked = choice.matched;
            choice.option.click();
            return { result: RESULT.COMMITTED };
        }, {
            sleep: ctx.sleep,
            label: f.name,
            // Typing IS the activation here, exactly as for the chip search.
            activate: (t) => {
                t.focus?.();
                setNativeValue(t, String(want));
                try { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
                catch { /* a box that answers to typing alone has already opened */ }
            },
        });
        if (!r.ok) return { result: r.result || RESULT.COMMIT_FAILED, reason: r.reason };
        return { ...r.value, picked };
    },
    async verify(f, want, ctx = {}) {
        const ok = await until(() => this.satisfied(f, want), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 1200 });
        if (!ok) {
            return {
                result: RESULT.COMMIT_FAILED,
                reason: `box reads "${this.shown(f) || 'empty'}"${visibleOptions().length ? ' with its list still open' : ''}`,
            };
        }
        if (!rowClean(ctx)) return { result: RESULT.COMMIT_FAILED, reason: `row error: ${errorsIn(ctx.row)[0]}` };
        return { result: RESULT.COMMITTED };
    },
};

/**
 * A prompt answered by walking a ladder against the options it really offers.
 *
 * ONE lease: the options cannot be read without opening the list, and the rung
 * cannot be chosen without the options. Lives here, beside the capabilities,
 * because two pages now need it — My Information's "How Did You Hear About Us"
 * and My Experience's Degree — and a second copy would be a second answer to
 * "what counts as already answered".
 *
 * ALREADY ANSWERED WINS. A ladder is a DEFAULT: a value already on the page is
 * either what the ATS parsed out of the résumé or what the candidate chose, and
 * both outrank anything we would pick for them.
 */
/** The control that commits a row — a real one, not a nested leaf wrapper. */
const commitControl = (el) => el.querySelector('input[type="radio"], input[type="checkbox"]');
/** The clickable leaf inside a menu row, when the row itself is only a label. */
const leafNode = (el) => el.querySelector('[data-automation-id="promptLeafNode"]');
const hasCommitControl = (el) => !!commitControl(el);

/**
 * A row that walks OUT of a submenu, not into it — the "‹ Company Website"
 * breadcrumb. `visibleOptions` already drops it on this tenant (it renders as
 * role=presentation, which SEL.option does not match), but a tenant that gives
 * the breadcrumb a role=option would ping-pong the walk without this.
 */
const isBackControl = (el) => {
    if ((el.getAttribute('role') || '') === 'presentation') return true;
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (/^back\b|go back|previous/.test(label)) return true;
    return !!el.closest('[data-automation-id="menuHeader"], header');
};

/**
 * Walk a ladder DOWN a cascade, one drill per level, and commit at the leaf.
 *
 * Measured 2026-08-10 (Mondelez "How Did You Hear About Us?"): the top level is
 * eight CATEGORY rows — a chevron and NO control — and clicking one DRILLS to a
 * level carrying a back breadcrumb plus the real leaf, a row with a RADIO that is
 * the only thing that commits. The SAME ladder answers both levels, because
 * "Company Website" names a category and the leaf inside it; so the walk matches
 * the category, drills, matches the leaf, and clicks its radio.
 *
 * A FLAT listbox (Degree) is the degenerate case: its first match already
 * carries the commit, so the click commits and the loop returns on pass zero
 * without ever drilling. That is why one function serves both fields.
 *
 * Nothing is assumed from the click returning. The commit signal is the FIELD's
 * own value changing — a chip appears, a button relabels — read through readNow;
 * a drill is the option set changing while the value does not.
 *
 * Options are read PAGE-WIDE, not through the lease's node. Measured 2026-08-10
 * (R-170139): a drill does not re-render in place — Workday REMOVES the old
 * option container and portals a NEW one, so the node the lease captured at open
 * is detached the moment we drill, and `lease.options()` scoped to it reads
 * empty. v1 read `visibleOptions()` page-wide for exactly this reason (it is the
 * v1-works / v2-slips difference, recorded and then forgotten once). The lease
 * still owns the page — the sweep cleared it before the open — so the only list
 * on it is ours, whichever container is currently holding the level.
 */
/**
 * Search-and-pick — the way v1 answers this exact prompt (recipe.js
 * fillPromptField). "How Did You Hear About Us?" is a SEARCHABLE prompt: its
 * trigger is an <input> (placeholder "Search", enterkeyhint=search,
 * data-uxi-widget-type=selectinput), not a click-only cascade. It does NOT
 * live-filter — MEASURED PwC 715624WD (2026-08-14): typing "job board" left all 11
 * categories untouched; pressing ENTER ran a server search that FLATTENED the tree
 * to the 2 matching leaves ("I found the job on a job board", "PwC Global Job
 * Board"), and clicking one committed the chip. A search result is SHORT, so it
 * paints in full even in a background-throttled tab (virtualisation only bites the
 * long unfiltered level that collapses to ~2 painted rows). So where the DOM drill
 * cannot reach an unpainted category row, one typed rung + Enter surfaces the leaf
 * and it is one click away. The server search is GLOBAL, so this works from any
 * level — even after a wrong category was drilled into.
 *
 * Typing is per-character but WITHOUT a per-key sleep (`typeInto`), and the query
 * runs on ONE Enter, not per keystroke: a slept keystroke loop both crawls under
 * the hidden tab's ~1s timer clamp AND — measured live 2026-08-14 — fires the
 * /source fetch once per key into a mid-init atom, the TypeError storm behind
 * Workday's "Something went wrong". Returns null when there is no text box to type
 * into — a button-only cascade (MDLZ's measured shape) — so the DOM drill stays
 * the path there.
 */
async function typeFilterPick(f, ladder, ctx, committedNow) {
    const trigger = triggerOf(f);
    const wrap = trigger ? trigger.closest('[data-automation-id^="formField-"]') : null;
    const filter = trigger && trigger.tagName === 'INPUT'
        ? trigger
        : (wrap || document).querySelector('input[type="text"], input:not([type])');
    if (!filter) return null;
    const nap = napper(ctx.sleep);
    // A search-shaped box lists NOTHING until Enter runs the query; a live-filter
    // box narrows as you type. Only the former needs Enter (which can also commit
    // the highlighted row — guarded below).
    const searchShaped = filter.getAttribute('enterkeyhint') === 'search'
        || filter.getAttribute('data-uxi-widget-type') === 'selectinput';

    for (const rawRung of ladder) {
        const term = rawRung.replace(/^=/, '');   // '=' anchors matching, it is not text
        const beforeKey = resultsKey();
        typeInto(filter, term);
        // A search-shaped box lists NOTHING new until Enter runs the query on the
        // server (MEASURED: typing alone left all 11 categories); a live-filter box
        // narrows as you type, and Enter there commits the highlighted — often
        // wrong — row (v1's measured hazard). So press Enter only for the former.
        if (searchShaped) { await nap(150); pressEnter(filter); }
        await waitForResults(beforeKey, { sleep: ctx.sleep, budgetMs: ctx.searchMs || 6000 });

        // Enter can also COMMIT a highlighted row on its own — accept that chip
        // only when it carries this rung's text (v1 measured it committing the
        // alphabetically-first WRONG option, and that rode all the way to Review).
        const early = committedNow();
        if (early && (fold(early).includes(fold(term)) || fold(term).includes(fold(early)))) {
            setNativeValue(filter, '');
            return { result: RESULT.COMMITTED, picked: term, rung: rawRung, onPage: early, via: 'type-filter' };
        }
        // The search flattened the tree; match THIS rung against what surfaced and
        // click the leaf. A category-option that only drills commits nothing, so
        // committedNow stays false and the loop tries the next rung — the leaf rung
        // reaches a real leaf and clicks it.
        const opts = visibleOptions().filter((o) => !isBackControl(o));
        const pick = chooseFromLadder(opts, [rawRung]);
        if (pick.option) {
            const hit = commitControl(pick.option) || leafNode(pick.option) || pick.option;
            try { hit.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
            hit.click();
            const now = await until(() => committedNow(), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 2000 });
            if (now) { setNativeValue(filter, ''); return { result: RESULT.COMMITTED, picked: pick.matched, rung: rawRung, onPage: now, via: 'type-filter' }; }
        }
        setNativeValue(filter, '');
        await nap(200);
    }
    // Leave nothing typed behind: uncommitted text reads as an answer and would
    // block the field from ever being re-tried (recipe.js prompt.clear hazard).
    try { setNativeValue(filter, ''); } catch { /* gone */ }
    return { result: RESULT.OPTION_NOT_FOUND, reason: 'no rung surfaced a match after filtering', via: 'type-filter' };
}

async function walkCascadeLadder(lease, f, ladder, ctx = {}) {
    const before = readNow(f);
    const committedNow = () => { const now = readNow(f); return now && now !== before ? now : null; };
    const levelKey = () => visibleOptions().map(txt).join('|');

    for (let level = 0; level < 4; level++) {
        const already = committedNow();
        if (already) return { result: RESULT.COMMITTED, picked: null, onPage: already, levels: level };

        const opts = visibleOptions().filter((o) => !isBackControl(o));
        const choice = opts.length ? chooseFromLadder(opts, ladder) : { option: null };

        // The DOM walk found no matching row. On a throttled tab that is not a
        // dead end — the level is virtualised and only ~2 rows painted, so the
        // rung's row was never rendered to be clicked. TYPE it instead: the server
        // filter flattens the cascade and the leaf surfaces in a short, fully
        // painted list (v1's mechanism; see typeFilterPick). An unthrottled tenant
        // (MDLZ) matches on the DOM walk above and never reaches here.
        if (!choice.option) {
            const typed = await typeFilterPick(f, ladder, ctx, committedNow);
            if (typed && typed.result === RESULT.COMMITTED) return { ...typed, levels: level + 1 };
            if (typed && typed.result === RESULT.OPTION_NOT_FOUND) return { ...typed, level };
            // typed === null → not a searchable prompt (no text box); fall through
            // and report the DOM miss the way the drill always has.
            if (!opts.length) return { result: RESULT.OPTION_NOT_FOUND, reason: 'the list emptied mid-cascade', level };
            return { result: choice.why, want: choice.want, shown: choice.shown, sample: choice.sample, level };
        }

        // Every row carrying this rung's text, a real leaf (radio/checkbox) first.
        // At a drilled level a category twin can sit beside the leaf, and clicking
        // it walks back out; try up to three, the way v1 does, in case box-sort
        // put a dead twin first.
        const twins = opts.filter((o) => fold(txt(o)) === fold(choice.matched));
        const leaves = twins.filter(hasCommitControl);
        const cands = (leaves.length ? leaves : (twins.length ? twins : [choice.option])).slice(0, 3);

        const keyBefore = levelKey();
        let drilled = false;
        for (const cand of cands) {
            const hit = commitControl(cand) || leafNode(cand) || cand;
            try { cand.scrollIntoView?.({ block: 'center' }); } catch { /* no layout in a test DOM */ }
            hit.click();
            const now = await until(() => committedNow(), { sleep: ctx.sleep, budgetMs: ctx.commitMs || 2000 });
            if (now) return { result: RESULT.COMMITTED, picked: choice.matched, rung: choice.rung, onPage: now, levels: level + 1 };
            drilled = await until(() => levelKey() !== keyBefore && visibleOptions().length > 0,
                { sleep: ctx.sleep, budgetMs: ctx.drillMs || 1200 });
            if (drilled) break;
        }
        if (!drilled) {
            return { result: RESULT.COMMIT_FAILED, reason: `"${choice.matched}" neither committed nor drilled`, picked: choice.matched, level };
        }
    }
    return { result: RESULT.OPTION_NOT_FOUND, reason: 'the cascade did not reach a leaf in four levels' };
}

export async function answerFromLadder(f, ladder, ctx = {}) {
    const shown = readNow(f);
    if (shown && !/^\((select one|no chips|empty)\)$/i.test(shown)) {
        return { result: RESULT.SATISFIED, detail: { picked: shown } };
    }
    const trigger = triggerOf(f);
    if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };

    let rung = null;
    const opened = await withList(trigger, async (lease) => {
        const walk = await walkCascadeLadder(lease, f, ladder, ctx);
        if (walk.rung) rung = walk.rung;
        return walk;
    }, { sleep: ctx.sleep, label: f.name });

    if (!opened.ok) return { result: opened.result || RESULT.COMMIT_FAILED, reason: opened.reason };
    if (opened.value?.result !== RESULT.COMMITTED) return { ...opened.value };
    const picked = opened.value.picked;
    // A chip search verifies against a LIST of terms — its `satisfied` spreads
    // `want`, and a bare string would spread into characters. A button listbox
    // verifies against the string itself. The ladder commits one value either
    // way; only the shape the verifier expects differs.
    const wantForVerify = f.kind === WIDGET.SEARCH_MULTI ? [picked] : picked;
    const proof = await CAPABILITY[f.kind].verify(f, wantForVerify, ctx);
    return { ...proof, picked, rung };
}

export const CAPABILITY = {
    [WIDGET.TEXT]: text,
    [WIDGET.TEXTAREA]: text,
    [WIDGET.CHECKBOX]: checkbox,
    [WIDGET.LISTBOX]: listbox,
    [WIDGET.SEARCH_MULTI]: searchMulti,
    [WIDGET.DATE]: date,
    [WIDGET.RADIO]: radio,
    [WIDGET.SEARCH_SINGLE]: searchSingle,
};

/**
 * Which engine may drive a CHIP-SEARCH field — decided by the PLAN's declared
 * contract, never inferred.
 *
 * The shape cannot decide: Field of Study (single) and Skills (multi) render
 * byte-identical chip-search DOM (probed side by side, 2026-08-13), and every
 * "signal" that seemed to separate them — aria-required, a searchBox automation
 * id, the type of `want` — is an unmeasured render detail one tenant version
 * away from flipping. So the plan must SAY what the field is:
 *
 *   capability 'searchSelect' + cardinality 'one'  → searchSelect
 *   capability 'searchMulti'  + cardinality 'many' → searchMulti
 *   capability 'searchMulti'  + cardinality 'one'  → searchMulti, ONLY with a
 *     documented `contractException` (countryPhoneCode: measured working, its
 *     migration gated on a measurement not yet made)
 *   anything else, or nothing                      → CONTRACT_ERROR
 *
 * No default. A developer who forgets the declaration gets a loud, dev-facing
 * result — never a field silently driven by the wrong state machine, which is
 * how a single-select was fed through the multi engine and searched one
 * character at a time. A CI test walks every spec so this fires there first.
 *
 * Ladder-driven fields (Degree, the HDYHAU cascade) do not pass through here —
 * answerFromLadder is its own path with its own measured walk.
 */
export function resolveCapability(f, decl) {
    if (f.kind !== WIDGET.SEARCH_MULTI) return { cap: CAPABILITY[f.kind] || null };
    const { capability, cardinality, contractException } = decl || {};
    if (capability === 'searchSelect' && cardinality === 'one') return { cap: searchSelect };
    if (capability === 'searchMulti' && cardinality === 'many') return { cap: searchMulti };
    if (capability === 'searchMulti' && cardinality === 'one' && contractException) {
        return { cap: searchMulti, exception: contractException };
    }
    return {
        contractError: {
            capability: capability ?? '(missing)',
            cardinality: cardinality ?? '(missing)',
        },
    };
}

/**
 * Add a row to a section, and prove one arrived.
 *
 * The commit signal is the row COUNT, read through the same finder the planner
 * uses — not the click returning, and not a fixed wait. "Add clicked, no row
 * appeared" was measured twice, and both times the click had hit-tested into
 * whatever was covering the button because it sat below the fold; so the scroll
 * is part of the action, and a row that never appears is an INTERACTION failure
 * that may be retried, not a semantic one that should reach anybody.
 */
export async function addRow(button, { sleep, anchor, root = null, budgetMs } = {}) {
    const budget = budgetMs || 4000;
    if (!button) return { result: RESULT.USER_REQUIRED, reason: 'no add button for this section' };
    // TWO readings of "a row arrived", because the anchor alone lied once.
    // MEASURED (PwC 715624WD, 2026-08-15): Education's Add succeeded on every
    // click — an "Education 1" panel appeared — while the anchor count read 0
    // forever, because that tenant's row renders formField-school and the anchor
    // then knew only formField-schoolName. Each pass re-planned the add: 39 real
    // rows one day, a livelock the next. So the click is ALSO verified by the
    // page growing new formField-* wrappers at all — tenant-blind, id-blind.
    // The pass is sequential and swept clean before this runs, so growth right
    // after our click is ours. `anchorBlind` on the result is the escalation
    // signal: the add WORKED but produced rows the planner cannot recognise, and
    // clicking again can only pile up rows nobody will ever fill.
    const fieldCount = () => {
        try { return (root || document).querySelectorAll('[data-automation-id^="formField-"]').length; }
        catch { return 0; }
    };
    const before = rowsOf(anchor, { root }).length;
    const beforeFields = fieldCount();
    try { button.scrollIntoView?.({ block: 'center' }); } catch { /* no layout in a test DOM */ }
    button.click();
    const grew = await until(
        () => rowsOf(anchor, { root }).length > before || fieldCount() > beforeFields,
        { sleep, budgetMs: budget },
    );
    const after = rowsOf(anchor, { root }).length;
    const anchorBlind = grew && after <= before;
    trace('mdlz.row.add', { anchor, before, after, grew, fields: fieldCount(), anchorBlind });
    if (!grew) return { result: RESULT.OPEN_TIMEOUT, reason: `the section still has ${before} row(s)` };
    return anchorBlind
        ? { result: RESULT.COMMITTED, rows: after, anchorBlind: true }
        : { result: RESULT.COMMITTED, rows: after };
}

/**
 * Semantic failures this document has already had, so they happen ONCE.
 *
 * Measured on a live run: Country came back OPTION_NOT_FOUND on a 249-row list,
 * three passes in a row, identically — the same list opened, the same 249 rows
 * read, the same verdict, three times. Nothing about the page or the answer had
 * changed between them, so the second and third attempts could not have gone
 * differently; they were pure cost and pure noise, and they kept a popup opening
 * over a page that was otherwise clean.
 *
 * An INTERACTION failure is worth retrying — the page was busy, a list was in
 * the way. A SEMANTIC one is not: the catalogue does not hold the answer, and it
 * will not hold it next pass either. So it is recorded and reported as a gap
 * until the WANT changes or the page does.
 *
 * On `window`, like every other claim here: two copies of the content script
 * must not each learn this the expensive way.
 */
const REFUSED = '__copoV2Refused';
const refusalKey = (f, want) => `${f.name}::${describeWant(want)}`;

const refusedBefore = (f, want) => {
    try { return !!(win()[REFUSED] || {})[refusalKey(f, want)]; } catch { return false; }
};

const rememberRefusal = (f, want, why) => {
    try {
        const all = win()[REFUSED] || (win()[REFUSED] = {});
        all[refusalKey(f, want)] = { why, at: Date.now() };
    } catch { /* nothing to remember with */ }
};

/** A page change clears them: a new catalogue is a new question. */
export const forgetRefusals = () => { try { win()[REFUSED] = {}; } catch { /* noop */ } };

const win = () => (typeof window !== 'undefined' ? window : globalThis);


/** Widgets whose current value can be read without opening anything. */
const HOLDS_A_VALUE = new Set([
    WIDGET.LISTBOX, WIDGET.SEARCH_SINGLE, WIDGET.SEARCH_MULTI, WIDGET.TEXT, WIDGET.TEXTAREA, WIDGET.DATE,
]);

/** A want, in one short readable string, whatever shape it arrived in. */
const describeWant = (want) => {
    if (want === null || want === undefined) return '—';
    if (Array.isArray(want)) return want.join(' | ').slice(0, 60);
    if (typeof want === 'object') return `${want.month}/${want.year}`;
    return String(want).slice(0, 60);
};

/** What each verify actually reads, spelled out for the trace. */
const SIGNAL = {
    [WIDGET.DATE]: 'aria-valuenow',
    [WIDGET.RADIO]: 'checked, re-read after the click',
    [WIDGET.SEARCH_SINGLE]: 'the value in its own box, with the list closed',
    [WIDGET.SEARCH_MULTI]: 'chips',
    [WIDGET.LISTBOX]: 'button text',
    [WIDGET.CHECKBOX]: 'checked + no row error',
    [WIDGET.TEXT]: 'value that stuck + no row error',
    [WIDGET.TEXTAREA]: 'value that stuck + no row error',
};

/**
 * Fill one field: skip it if it is already right, write it, then prove it.
 *
 * The three answers stay separate all the way out. An interaction failure never
 * becomes a semantic one, a satisfied field never spends a click, and a commit
 * is only ever reported by the widget's own signal.
 */
export async function runField(f, want, ctx = {}) {
    const routed = resolveCapability(f, ctx.decl);
    if (routed.contractError) {
        // The PLAN is wrong, not the candidate — a chip-search field reached the
        // executor without a declared capability/cardinality. Loud, dev-facing,
        // non-retryable; the CI contract test exists so this never actually fires.
        trace('mdlz.plan.contractError', {
            field: f.name, shape: f.kind, ...routed.contractError,
        });
        return {
            result: RESULT.CONTRACT_ERROR,
            reason: 'internal field contract missing — the plan must declare capability/cardinality for this chip-search field',
        };
    }
    const cap = routed.cap;
    if (!cap) {
        // No handler is not a licence to improvise on a real application.
        trace('mdlz.field.unknown', { field: f.name, label: f.label });
        return { result: RESULT.USER_REQUIRED, reason: `no capability for a ${f.kind} widget` };
    }
    if (!f.present()) return { result: RESULT.WAITING_HYDRATION, reason: 'field not on the page' };

    if (cap.satisfied(f, want)) {
        trace('mdlz.field.satisfied', { field: f.name, kind: f.kind });
        return { result: RESULT.SATISFIED };
    }

    // ASKED AND ANSWERED. The same want, the same field, already refused on this
    // page — re-opening the list cannot produce a different catalogue.
    if (refusedBefore(f, want)) {
        trace('mdlz.field.refusedBefore', { field: f.name, want: describeWant(want) });
        return { result: RESULT.USER_REQUIRED, reason: 'already refused on this page', repeat: true };
    }

    // A DEFAULT NEVER OVERWRITES A VALUE THAT IS ALREADY THERE.
    //
    // Measured on a live run: Country read "Vietnam" on the page while the want
    // was the profile's NATIONALITY ("Vietnamese"), so `satisfied` said no and
    // the field was re-opened — 249 options, OPTION_NOT_FOUND, every pass, on a
    // field that was already correct and required no work at all.
    //
    // The rule generalises past that bug. When our value is an agent default
    // rather than something the candidate stated, a committed field on the page
    // is better evidence than our guess: it is either what the ATS pre-filled or
    // what the candidate chose, and both outrank a default.
    if (ctx.isDefault && HOLDS_A_VALUE.has(f.kind)) {
        const shown = readNow(f);
        const empty = !shown || /^\((select one|no chips|empty)\)$/i.test(shown) || shown === '—/—';
        if (!empty) {
            trace('mdlz.field.keep', { field: f.name, kind: f.kind, keeping: shown, ratherThan: describeWant(want) });
            return { result: RESULT.SATISFIED, detail: { picked: shown, kept: true } };
        }
    }

    const wrote = await cap.commit(f, want, ctx);
    if (wrote.result !== RESULT.COMMITTED) {
        if (SEMANTIC.has(wrote.result)) rememberRefusal(f, want, wrote.result);
        trace('mdlz.field.commit', {
            field: f.name,
            kind: f.kind,
            result: wrote.result,
            reason: wrote.reason || '',
            // The three columns whose absence made a live failure unreadable.
            want: wrote.want ?? describeWant(want),
            shown: wrote.shown ?? '(n/a)',
            sample: (wrote.sample || wrote.saw || []).join(' | ') || '(none)',
        });
        return wrote;
    }

    const proof = await cap.verify(f, want, ctx);
    trace('mdlz.field.verify', {
        field: f.name, kind: f.kind, result: proof.result, reason: proof.reason || '',
        signal: SIGNAL[f.kind] || 'n/a',
    });
    return { ...proof, picked: wrote.picked, added: wrote.added };
}
