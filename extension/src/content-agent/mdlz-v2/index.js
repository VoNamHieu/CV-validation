/**
 * MDLZ v2 — the entry, and the decision to take a page or hand it back.
 *
 * Ownership rule, unchanged since Milestone 0: on a given page instance either
 * v1 or v2 owns the DOM, never both. Two owners writing the same widget, each
 * verifying against state the other had just changed, is the disorder v2 exists
 * to end — so this file's most important job is not filling anything. It is
 * DECLINING clearly: v2 takes a page only when it can finish the step, and
 * anything it cannot finish stays with v1, whole.
 *
 * What it takes, today: My Experience, and only once the résumé is attached
 * (v1 owns the upload, and a pass that filled fields while the parser was still
 * to run would be filling a page about to be re-rendered underneath it).
 *
 * One CALL is one PASS. After a row is added the plan stops for that section and
 * the next pass re-derives it against the page the click produced — a plan that
 * assumes what a click will render is the plan that filled rows which did not
 * exist yet.
 */

import { ADD_VIA_KEY, FLAG_KEY, RESULT, SEL, SEMANTIC, STEP, isMdlzPage } from './config.js';
import { openPopups, orphanOptionCount, pageFingerprint, waitPageReady } from './page-observer.js';
import { census } from './popup-manager.js';
import { addRow, answerFromLadder, runField } from './executors.js';
import { fingerprintOf } from './fingerprint.js';
import { SECTIONS, addButtonFor, planStep, resolveRow, resolveTarget } from './planner.js';
import { NAV, advance } from './navigation.js';
import { ATTACH, attachResume, runAutofillPage } from './page-autofill.js';
import { runMyInfoPage } from './page-myinfo.js';
import { runDisclosuresPage } from './page-disclosures.js';
import { runQuestionsPage } from './page-questions.js';
import { runReviewPage } from './page-review.js';
import { READY, observePageState, owns, releasePage } from './pages.js';
import { preflightReport, resumeEvidence } from './preflight.js';
import { rowsOf } from './row.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';

/**
 * Three settings, not two.
 *
 * `dry` is the one that matters before a first live run: v2 reads the page,
 * says what it would have done, and hands it straight back to v1 — so the first
 * contact with somebody's real application is a measurement and not a write.
 */
export const MODE = { OFF: 'off', DRY: 'dry', ON: 'on' };

export async function flagMode() {
    return (await settings()).mode;
}

/**
 * Everything storage says about this run, read in one go.
 *
 * `addVia` restricts how a section's Add button may be identified — 'rows' turns
 * off the heading strategy from a console, for a live run that finds it wrong.
 */
export async function settings() {
    if (!isMdlzPage()) return { mode: MODE.OFF, addVia: 'any' };
    try {
        const d = await new Promise((r) => chrome.storage.local.get([FLAG_KEY, ADD_VIA_KEY], r));
        const v = d?.[FLAG_KEY];
        const addVia = d?.[ADD_VIA_KEY] === 'rows' ? 'rows' : 'any';
        if (v === false || v === 'off') return { mode: MODE.OFF, addVia };   // explicit opt-out
        if (v === 'dry' || v === 'preflight') return { mode: MODE.DRY, addVia };
        // DEFAULT ON for mdlz (2026-08-09). v1 is frozen: it is the fallback
        // for pages v2 declines, not something a console command has to switch
        // on before every run. The escape hatch stays a single key —
        // `chrome.storage.local.set({ copoMdlzV2: false })` — because a young
        // controller that cannot be turned off is worse than one nobody uses.
        return { mode: MODE.ON, addVia };
    } catch {
        return { mode: MODE.OFF, addVia: 'any' };
    }
}

/** Is v2 allowed to WRITE here? The strongest setting, and only that one. */
export const mdlzV2Enabled = async () => (await flagMode()) === MODE.ON;

/**
 * One observation pass. Returns what v2 believes about this page.
 *
 * The popup figures are the ones that matter first: `orphanOptions` above zero
 * means a previous field left its list open, which measured on the live form
 * as a Degree that "would not open" and a calendar that "did not open" while
 * twenty Skills options sat over them.
 */
export async function observeOnly({ sleep } = {}) {
    const ready = await waitPageReady({ sleep });
    const popups = openPopups();
    const now = census();
    const report = {
        step: ready.step,
        ready: ready.ready,
        fingerprint: pageFingerprint(),
        openPopups: popups.length,
        popupOwners: popups.map((p) => p.ownerField || '(portal)').join(',') || '(none)',
        orphanOptions: orphanOptionCount(),
        // Lists nobody has closed, counted separately from the options in them:
        // one leftover list is one blocked widget, whatever its row count.
        openLists: now.lists,
    };
    trace('mdlz.page.observe', report);
    return report;
}

/**
 * Has the résumé already been attached?
 *
 * v1 owns the upload, and v2 must not take a page where it is still to happen —
 * Workday re-renders every section it parses the CV into, and a pass filling
 * fields underneath that is a pass writing into a page that is about to be
 * replaced.
 *
 * The reading is `resumeEvidence`, which asks three ways and keeps them
 * separate: the filename on the page, Workday's own upload confirmation, and
 * `input.files`. One signal was a guess that could be wrong with nothing to
 * notice it — v2 would simply decline forever and say nothing.
 *
 * Still the conservative direction: no evidence at all means v1 keeps the page
 * it has always had.
 */
export function resumeAttached(cvData) {
    return !!resumeEvidence(cvData).attached;
}

/** Turn one planned descriptor into something the scheduler can run. */
function runnable(task, ctx) {
    if (task.kind === 'addRow') {
        return {
            id: task.id,
            run: async () => {
                const spec = SECTIONS.find((s) => s.name === task.section);
                const rows = rowsOf(spec.anchor, { root: ctx.root });
                return addRow(addButtonFor(spec, rows, ctx.addVia), {
                    sleep: ctx.sleep, anchor: spec.anchor, root: ctx.root, budgetMs: ctx.addMs,
                });
            },
        };
    }
    return {
        id: task.id,
        optional: !!task.optional,
        run: async () => {
            // Resolved HERE, not at planning time: the row may have been
            // re-rendered, and for a row an Add produced it did not exist then.
            const wrap = resolveTarget(task, { root: ctx.root });
            if (!wrap) return { result: RESULT.WAITING_HYDRATION, reason: 'the field is not on the page' };
            const f = fingerprintOf(() => resolveTarget(task, { root: ctx.root }), { name: task.field || task.id });
            const inRow = { ...ctx, row: resolveRow(task, { root: ctx.root }) };
            // A field whose answer is a LADDER cannot be asked for by value: the
            // rung is only decidable against options that do not exist until the
            // list is open. Degree is the measured case.
            return task.ladder?.length
                ? answerFromLadder(f, task.ladder, inRow)
                : runField(f, task.want, inRow);
        },
    };
}

/**
 * Would v2 take this page, and why not?
 *
 * ONE decision, used by the pass and by the dry run alike — a preflight that
 * decided separately could report "would take" about a page the controller
 * declines, which is the one thing a preflight must never do.
 */
export async function decideTake(ctx = {}) {
    // C0 first: which page, settled or not, and whose it is. The claim it takes
    // is what stops anything else clicking here.
    const state = await observePageState(ctx);
    const seen = { ...(await observeOnly(ctx)), ...state };
    const owned = owns(state.page);
    const no = (reason, extra = {}) => ({ take: false, reason, seen, pageIsV2Owned: owned, ...extra });

    if (!owned) return no(`v2 does not own ${state.page}`);
    if (state.state === READY.HYDRATING) return no('page still settling');
    // EMPTY_READY is a page, not a non-page: a fresh draft is exactly where
    // "Add Another" is the only work there is.
    if (!resumeAttached(ctx.cvData)) return no('résumé not attached yet — v1 owns the upload');

    const plan = planStep(ctx.cv, { root: ctx.root, addVia: ctx.addVia || 'any' });
    const blocking = plan.gaps.filter((g) => /add button/.test(g.why));
    if (blocking.length) {
        return no(`cannot finish ${blocking.map((g) => g.section).join(', ')}`, { plan });
    }
    if (!plan.tasks.length) return no('nothing planned for this page', { plan });
    return { take: true, reason: '', seen, plan, pageIsV2Owned: true };
}

/**
 * The controller. Takes the page, or says why it did not.
 *
 * Everything that makes it decline is a REASON, not a silence: a step v2 does
 * not own, a résumé still to upload, a section whose Add button cannot be told
 * from the other three on the page. v1 then runs exactly as it did before.
 */
export async function runMdlzV2(ctx = {}) {
    const { mode, addVia } = await settings();
    if (mode === MODE.OFF) {
        // Off means off: v2 holds no page, so nothing it left behind can refuse
        // somebody else's click.
        releasePage();
        return { took: false, reason: 'flag off', pageIsV2Owned: false };
    }

    // ── Tầng B: one controller per page ──────────────────────────────
    //
    // The page decides who runs. A page v2 owns but has no controller for must
    // never fall through to another page's logic — which is exactly what
    // happened when this dispatch was missing: My Information landed in My
    // Experience's planner and came back "cannot finish work, education,
    // languages" about a page that has none of them.
    const where = await observePageState(ctx);
    if (!owns(where.page)) {
        return { took: false, reason: `v2 does not own ${where.page}`, pageIsV2Owned: false, result: RESULT.SKIPPED_OPTIONAL };
    }
    const CONTROLLERS = {
        [STEP.AUTOFILL]: runAutofillPage,
        [STEP.MY_INFORMATION]: runMyInfoPage,
        [STEP.APPLICATION_QUESTIONS]: runQuestionsPage,
        [STEP.VOLUNTARY_DISCLOSURES]: runDisclosuresPage,
        [STEP.REVIEW]: runReviewPage,
    };
    const controller = CONTROLLERS[where.page];
    if (controller) {
        if (mode === MODE.DRY) {
            // A dry run reads; it must not hold the page either, or the reading
            // would stop v1 filling it.
            releasePage();
            return {
                took: false, dry: true, pageIsV2Owned: false,
                reason: `dry run — ${where.page} reads only`,
                preflight: { verdict: 'WOULD TAKE', step: where.page, resume: resumeEvidence(ctx.cvData) },
            };
        }
        const r = await controller(ctx);
        return { ...r, pageIsV2Owned: true };
    }
    if (where.page !== STEP.MY_EXPERIENCE) {
        // Owned, ported nowhere. Say so instead of guessing which controller
        // might cope.
        return { took: false, reason: `no controller for ${where.page}`, pageIsV2Owned: true };
    }

    // ── the résumé, on the page v2 owns ──────────────────────────────
    //
    // MEASURED 2026-08-09, live on R-174102: this was a DEADLOCK, and it cost a
    // whole run without a single widget being at fault.
    //
    // v2 owned My Experience and declined it every pass — "résumé not attached
    // yet, v1 owns the upload" — while `routeAfterV2` refuses v1 on every page
    // v2 owns. So the only code that could attach the résumé was never allowed
    // to run, and v2 waited for a file that nothing on the page would ever
    // deliver: seven iterations, five of them byte-identical, then the loop gave
    // up with "v2 owns this page and recorded nothing". A page with an owner
    // that will not act and a fallback that is not allowed to is not a slow
    // page; it is a stopped one.
    //
    // Owning a page means finishing it, and the résumé is PART of this page —
    // Workday renders the upload here and marks it required. So v2 attaches it,
    // through the same routine the Autofill page uses. Not a second copy (two
    // definitions of "the ATS has the file" froze a run once already), and not
    // an exception that lets v1 back onto a page v2 holds.
    //
    // A dry run must not reach this: it writes, and the DRY gate below this
    // point is too late to be the thing that stops it.
    if (mode === MODE.ON && !resumeAttached(ctx.cvData)) {
        const att = await attachResume(ctx);
        trace('mdlz.myexp.resume', {
            state: att.state,
            rows: att.detail?.uploadedRows ?? 0,
            reason: att.reason || '',
        });
        // NOTHING IS PLANNED IN THE PASS THAT ATTACHED IT. Workday re-renders
        // every section it parses the CV into, so a plan derived now is a plan
        // about a page that is about to be replaced — which is the very reason
        // this gate was put here in the first place. The next pass sees the
        // page the parse produced, and `readiness` waits for it to settle.
        if (att.state !== ATTACH.NO_TARGET) {
            const unanswerable = att.state === ATTACH.NO_CV || att.state === ATTACH.FAILED;
            return {
                took: true,
                result: att.result,
                reason: att.reason || `résumé ${att.state.toLowerCase()}`,
                pageIsV2Owned: true,
                // A state a person has to fix is recorded as a GAP, so the loop's
                // stuck detector can name it instead of saying v2 recorded
                // nothing — which is exactly what it said about this deadlock.
                gaps: unanswerable ? [{ section: 'resume', field: 'Resume/CV', why: att.reason }] : [],
                report: {
                    matched: true,
                    filled: att.state === ATTACH.ATTACHED ? 1 : 0,
                    step: 'My Experience',
                    answers: [],
                    v2: true,
                },
            };
        }
    }

    const decision = await decideTake({ ...ctx, addVia });

    // Dry run: report and stand down, whatever the decision was. v1 fills this
    // page exactly as it does today, and what comes back is a table.
    if (mode === MODE.DRY) {
        const preflight = preflightReport(ctx.cv, decision, { root: ctx.root, cvData: ctx.cvData, addVia });
        // A dry run reads. It must not own the page either, or the reading
        // itself would stop v1 filling it.
        releasePage();
        return { took: false, reason: `dry run — ${preflight.verdict}`, preflight, dry: true, pageIsV2Owned: false };
    }

    if (!decision.take) {
        if (decision.plan) {
            trace('mdlz.plan.declined', { reason: decision.reason, gaps: decision.plan.gaps.length });
        }
        return { took: false, reason: decision.reason, gaps: decision.plan?.gaps, result: RESULT.SKIPPED_OPTIONAL, pageIsV2Owned: !!decision.pageIsV2Owned };
    }
    const { tasks, gaps } = decision.plan;

    trace('mdlz.plan', {
        tasks: tasks.length,
        adds: tasks.filter((t) => t.kind === 'addRow').length,
        gaps: gaps.length,
        first: tasks.slice(0, 3).map((t) => t.id).join(' · '),
    });

    const ledger = await runSequential(tasks.map((t) => runnable(t, { ...ctx, addVia })), { sleep: ctx.sleep });
    if (ledger.busy) return { took: false, reason: 'another pass owns this page', report: { matched: false, filled: 0, busy: true }, pageIsV2Owned: true };

    // v1's report shape, because v1's caller is what reads it: how many fields
    // moved, which step, and the answers that were actually committed.
    const done = ledger.tasks.filter((t) => t.result === RESULT.COMMITTED);
    const report = {
        matched: true,
        filled: done.length,
        step: 'My Experience',
        answers: done.map((t) => ({ field: t.id, value: t.detail?.picked || '', source: 'mdlz-v2' })),
        v2: true,
        ledger,
        gaps,
    };
    // ── leaving the page ─────────────────────────────────────────────
    //
    // Only from a pass that needed to do NOTHING. Filling and then advancing in
    // one breath means leaving on the strength of what we just wrote; waiting
    // for a pass that finds everything already right means leaving on the
    // strength of what the page says. It costs one cheap pass — a satisfied
    // field spends no click — and it is the same check the second-pass gate
    // makes.
    // "Nothing left to do here" — which is NOT the same as "everything
    // succeeded", and reading it as the latter is what kept a finished page.
    //
    // MEASURED (R-174102, 2026-08-09): every field on My Experience was
    // correct, the form showed no errors, and the run still ended on the page
    // after twelve identical iterations. Skills was the only task not
    // SATISFIED — an OPTIONAL field whose catalogue answers "No Items." to
    // everything, so it can never be satisfied, on any pass, ever. This gate
    // and `pageComplete` were applying different rules to the same ledger; the
    // one that decides whether to even TRY advancing was the stricter of the
    // two, so the page was never offered to the check that would have passed it.
    //
    // A COMMITTED task still holds the page: leaving is done on the strength of
    // what the page SAYS next pass, never on what we just wrote.
    const settled = (t) => t.result === RESULT.SATISFIED || (t.optional && SEMANTIC.has(t.result));
    const quiet = ledger.tasks.length > 0 && ledger.tasks.every(settled);
    let navigation = null;
    // `advance: false` is for a caller that wants the fill and not the move —
    // the Review controller is read-only by definition, and a pass being
    // measured should not walk off the page it is being measured on.
    if (quiet && !ledger.halted && ctx.advance !== false) {
        navigation = await advance({
            sleep: ctx.sleep,
            verifyComplete: () => pageComplete(ledger, gaps),
        });
        if (navigation.result === NAV.ADVANCED) report.advancedTo = navigation.to;
        else report.advanceBlocked = navigation.result;
    }

    trace('mdlz.pass', {
        filled: report.filled,
        satisfied: ledger.tasks.filter((t) => t.result === RESULT.SATISFIED).length,
        failed: ledger.tasks.filter((t) => ![RESULT.COMMITTED, RESULT.SATISFIED].includes(t.result)).length,
        halted: ledger.halted || '(none)',
        leaks: ledger.leaks,
        gaps: gaps.length,
        advance: navigation ? navigation.result : '(not attempted — the page still needed work)',
    });
    return { took: true, report, ledger, gaps, navigation, pageIsV2Owned: true };
}

/**
 * Is this page finished — the question the navigation transaction asks before
 * it presses anything.
 *
 * Three ways it can be unfinished, and each is reported as itself: a task that
 * did not end well, an answer the CV never held, and an error the form is
 * showing. The third one matters most: leaving a page that is complaining means
 * arriving at the next one with the complaint still behind you.
 */
export function pageComplete(ledger, gaps = []) {
    const unfinished = (ledger?.tasks || [])
        .filter((t) => ![RESULT.SATISFIED, RESULT.COMMITTED].includes(t.result))
        // AN OPTIONAL FIELD THE CATALOGUE CANNOT ANSWER IS NOT AN UNFINISHED
        // PAGE. Measured on Skills (R-174102): the employer does not require it
        // and its catalogue answers "No Items." to everything, so holding the
        // application here would mean never advancing over a field nobody asked
        // for. Only SEMANTIC outcomes are forgiven — an optional field that was
        // merely blocked or still hydrating may well succeed next pass, and
        // leaving on that would be leaving early.
        .filter((t) => !(t.optional && SEMANTIC.has(t.result)));
    if (unfinished.length) {
        return { complete: false, reason: `${unfinished[0].id} ended ${unfinished[0].result}`, unfinished };
    }
    if (gaps.length) {
        const g = gaps[0];
        return { complete: false, reason: `${g.section}${g.field ? `.${g.field}` : ''}: ${g.why}`, gaps };
    }
    let errors = [];
    try {
        errors = [...document.querySelectorAll(SEL.fieldError)]
            .filter((e) => e.offsetParent !== null)
            .map((e) => (e.textContent || '').trim());
    } catch { /* no DOM to ask */ }
    if (errors.length) return { complete: false, reason: errors[0], errors };
    return { complete: true };
}

/**
 * The last CV the router handed in, kept for the console hook alone.
 *
 * A dry run is worth most when it can be asked for at a moment somebody chose —
 * mid-draft, on the row that looks wrong — and not only when the loop happens
 * to come round. The value is already in this page's memory; nothing is stored,
 * sent, or written down.
 */
let _lastCv = null;
export const rememberCv = (cv) => { if (cv) _lastCv = cv; };

/** `copoMdlzPreflight()` in the extension's console context, any time. */
export async function preflightNow(cv) {
    const decision = await decideTake({ cv: cv || _lastCv });
    return preflightReport(cv || _lastCv, decision, {});
}

try {
    if (isMdlzPage() && typeof globalThis !== 'undefined') {
        globalThis.copoMdlzPreflight = preflightNow;
    }
} catch { /* not a browser, or a page v2 has no business on */ }
