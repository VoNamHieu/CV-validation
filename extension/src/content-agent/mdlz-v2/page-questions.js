/**
 * P4 — Application Questions. The page where the fields have no names.
 *
 * MEASURED: every field on this step carries a PER-JOB DYNAMIC automation id, so
 * nothing here can be selected by id — a question is found by its own text, and
 * the set of questions changes with the posting. That is why this controller
 * discovers rather than plans: it reads what is on the page and answers what it
 * can.
 *
 * WHERE THE ANSWERS COME FROM: answers.js, which is the repo's answer policy and
 * not this file's opinion. Its contract is the one that matters here — a rule
 * "can never introduce an option that is not on the page", the resolution order
 * is profile → product default for the KIND → a semantic fallback among the
 * OFFERED options → nothing, and what it returns carries `source` so the review
 * shows the user which answers were the agent's. The agent never submits; every
 * AGENT_DEFAULT is a line the user reads before they do.
 *
 * The three Mondelez asks on every job were measured on R-173278, phrasings
 * verbatim from the page: conflict of interest, relatives currently employed,
 * and sponsor a work visa — all three "No", all three AGENT_DEFAULT. The
 * sponsorship default carries a caveat recorded with it and repeated here
 * because it is the one that could be wrong in a way that matters: "No" is
 * correct for the home-market case (a VN candidate, a VN-located job, the only
 * market served today) and REVISIT BEFORE TARGETING JOBS ABROAD, where it would
 * falsely waive a sponsorship need.
 *
 * A question nobody can answer is left alone and reported. It is not guessed at,
 * and it does not block the pass — the review lists it.
 */

import { RESULT, SEL } from './config.js';
import { resolveAnswer } from '../answers.js';
import { reshapeMoneyValue } from '../recipe.js';
import { CAPABILITY, chooseOption, readNow, runField } from './executors.js';
import { WIDGET, fingerprintOf, triggerOf } from './fingerprint.js';
import { NAV, advance } from './navigation.js';
import { withList } from './popup-manager.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';

const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');

/**
 * The measured text answers, by the phrasing the page uses.
 *
 * These are not semantic rules — they are two values recorded against two
 * questions on this tenant, so they live as data rather than as a rule that
 * would claim to know more than it does.
 */
const TEXT_ANSWERS = [
    { match: /notice period/i, value: () => '30 days' },
    {
        match: /salary/i,
        value: (profile) => profile?.desiredSalary || 'Negotiable',
        money: true,
    },
];

/** Every question on the page, with the text that identifies it. */
export function questionsOnPage() {
    try {
        return [...document.querySelectorAll('[data-automation-id^="formField-"]')]
            .filter((w) => w.offsetParent !== null)
            .map((wrap) => ({ wrap, id: wrap.getAttribute('data-automation-id'), question: txt(wrap.querySelector('legend, label')) }))
            .filter((q) => q.question);
    } catch { return []; }
}

/**
 * A money box answers to the BOX, not to our default.
 *
 * A numeric or VND field gets digits; "Negotiable" has none, so the field steps
 * aside as a named gap instead of looping a doomed write.
 */
function moneyFor(raw, wrap, control) {
    const numericBox = control?.type === 'number' || control?.inputMode === 'numeric'
        || /numeric/i.test(control?.getAttribute?.('data-automation-id') || '');
    const vndLabel = /\bvnd\b|₫/i.test(txt(wrap));
    return reshapeMoneyValue(raw, { numericBox, vndLabel });
}

/**
 * Answer one question, whatever kind of control it turns out to be.
 *
 * The prompt case is the interesting one: the offered options cannot be read
 * without opening the list, and the answer cannot be chosen without the offered
 * options. So it is ONE lease — open, read, resolve, pick — rather than two
 * openings with a guess in between.
 */
async function answerQuestion(q, ctx) {
    const find = () => questionsOnPage().find((x) => x.question === q.question)?.wrap || null;
    const f = fingerprintOf(find, { name: q.id });
    const kind = f.kind;

    // Text boxes: the two measured values, or nothing.
    if (kind === WIDGET.TEXT || kind === WIDGET.TEXTAREA) {
        const rule = TEXT_ANSWERS.find((r) => r.match.test(q.question));
        if (!rule) return { result: RESULT.USER_REQUIRED, reason: 'no answer for this question', question: q.question };
        let value = rule.value(ctx.profile);
        if (rule.money) {
            value = moneyFor(value, find(), f.controls().text);
            if (!value) return { result: RESULT.USER_REQUIRED, reason: 'no numeric salary to write', question: q.question };
        }
        return runField(f, value, ctx);
    }

    // Radios: the options are already on the page, so the answer can be
    // resolved before anything is touched.
    if (kind === WIDGET.RADIO) {
        const options = CAPABILITY[WIDGET.RADIO].options(f).map((o) => o.text).filter(Boolean);
        const answer = resolveAnswer({ questionText: q.question }, options, ctx.profile, ctx.cv);
        if (!answer) return { result: RESULT.USER_REQUIRED, reason: 'no rule and no profile answer', question: q.question, options };
        const r = await runField(f, answer.value, ctx);
        return { ...r, answer };
    }

    // Prompts: one lease, and the answer decided inside it against the options
    // the page really offered.
    if (kind === WIDGET.LISTBOX || kind === WIDGET.SEARCH_SINGLE || kind === WIDGET.SEARCH_MULTI) {
        // ALREADY ANSWERED — by us on an earlier pass, or by the candidate
        // themselves on a draft they came back to. Either way it is not ours to
        // re-open: a second pass that re-picks is the same defect as a second
        // pass that re-types, and on a question ABOUT THE CANDIDATE it would
        // overwrite their own answer with the agent's default.
        const shown = readNow(f);
        if (shown && !/^\(select one\)$/i.test(shown) && !/^\(no chips\)$/i.test(shown)) {
            return { result: RESULT.SATISFIED, detail: { picked: shown } };
        }
        const trigger = triggerOf(f);
        if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };
        let answer = null;
        const opened = await withList(trigger, async (lease) => {
            const options = lease.options().map(txt).filter(Boolean);
            answer = resolveAnswer({ questionText: q.question }, options, ctx.profile, ctx.cv);
            if (!answer) return { result: RESULT.USER_REQUIRED, options };
            const choice = chooseOption(lease.options(), answer.value);
            if (!choice.option) return { result: choice.why, saw: choice.saw };
            choice.option.click();
            return { result: RESULT.COMMITTED, picked: choice.matched };
        }, { sleep: ctx.sleep, label: q.id });

        if (!opened.ok) return { result: opened.result || RESULT.COMMIT_FAILED, reason: opened.reason, question: q.question };
        if (opened.value?.result !== RESULT.COMMITTED) {
            return { ...opened.value, question: q.question, reason: 'nothing on the list answers this' };
        }
        const proof = await CAPABILITY[kind].verify(f, opened.value.picked, ctx);
        return { ...proof, answer, picked: opened.value.picked };
    }

    if (kind === WIDGET.CHECKBOX) {
        // A checkbox GROUP — several boxes under one question ("What shift do you
        // prefer?" Morning / … / Any shift, measured on Maersk R192834) — is a
        // pick-one, not a yes/no tick. It answers exactly like a radio group,
        // only the input type differs: read each box's label, resolve against
        // them, and tick the match. A SINGLE checkbox stays the yes/no path below,
        // so MDLZ's consent/acknowledge boxes are untouched.
        const wrap = find();
        const boxes = wrap ? [...wrap.querySelectorAll('input[type="checkbox"]')] : [];
        if (boxes.length > 1) {
            const nap = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
            const labelOf = (b) => fold(
                (b.id && wrap.querySelector(`label[for="${b.id}"]`)?.textContent)
                || b.closest('label')?.textContent
                || b.parentElement?.textContent || '');
            const labelled = boxes.map((b) => ({ b, t: labelOf(b) })).filter((x) => x.t);
            const answer = resolveAnswer({ questionText: q.question }, labelled.map((x) => x.t), ctx.profile, ctx.cv);
            if (!answer) return { result: RESULT.USER_REQUIRED, reason: 'no rule for this checkbox group', question: q.question, options: labelled.map((x) => x.t) };
            const want = fold(answer.value);
            const hit = labelled.find((x) => x.t === want) || labelled.find((x) => x.t.includes(want));
            if (!hit) return { result: RESULT.OPTION_NOT_FOUND, question: q.question, options: labelled.map((x) => x.t) };
            if (!hit.b.checked) {
                const clickable = (hit.b.id && wrap.querySelector(`label[for="${hit.b.id}"]`)) || hit.b.closest('label') || hit.b;
                try { clickable.scrollIntoView?.({ block: 'center' }); } catch { /* no layout */ }
                clickable.click();
                await nap(200);
            }
            // Re-read by label — the node can be recycled on a re-render.
            const after = wrap.querySelectorAll('input[type="checkbox"]');
            const stillChecked = [...after].some((b) => labelOf(b) === want && b.checked) || hit.b.checked;
            return stillChecked
                ? { result: RESULT.COMMITTED, answer, picked: hit.t, question: q.question }
                : { result: RESULT.COMMIT_FAILED, reason: 'the box did not stay checked', question: q.question };
        }
        const answer = resolveAnswer({ questionText: q.question }, ['yes', 'no'], ctx.profile, ctx.cv);
        if (!answer) return { result: RESULT.USER_REQUIRED, reason: 'no rule for this box', question: q.question };
        return runField(f, /^(yes|có|i agree|i acknowledge|đồng ý)$/i.test(String(answer.value)), ctx);
    }

    return { result: RESULT.USER_REQUIRED, reason: `no capability for a ${kind} question`, question: q.question };
}

/** Nothing left that we can answer, and nothing the form is complaining about. */
export function questionsComplete(ledger, gaps) {
    const unfinished = (ledger?.tasks || [])
        .filter((t) => ![RESULT.SATISFIED, RESULT.COMMITTED].includes(t.result))
        .filter((t) => t.result !== RESULT.USER_REQUIRED);
    if (unfinished.length) return { complete: false, reason: `${unfinished[0].id} ended ${unfinished[0].result}` };
    if (gaps.length) return { complete: false, reason: `${gaps.length} question(s) nobody can answer` };
    let errors = [];
    try {
        errors = [...document.querySelectorAll(SEL.fieldError)]
            .filter((e) => e.offsetParent !== null).map(txt);
    } catch { /* no DOM */ }
    if (errors.length) return { complete: false, reason: errors[0] };
    return { complete: true };
}

export async function runQuestionsPage(ctx = {}) {
    // Discovered every pass, never remembered: answering one question can render
    // another (the conditional detail a "Yes" asks for), and a remembered list is
    // a list about the page as it was.
    const questions = questionsOnPage();
    trace('mdlz.questions.seen', {
        count: questions.length,
        asking: questions.slice(0, 4).map((q) => q.question.slice(0, 40)).join(' · '),
    });

    const gaps = [];
    const tasks = questions.map((q) => ({
        id: q.id,
        run: async () => {
            const r = await answerQuestion(q, ctx);
            if (r.result === RESULT.USER_REQUIRED) {
                gaps.push({ question: q.question, why: r.reason, options: r.options });
            }
            return r;
        },
    }));

    const ledger = await runSequential(tasks, { sleep: ctx.sleep });
    if (ledger.busy) return { took: false, reason: 'another pass owns this page', report: { matched: false, filled: 0, busy: true } };

    const done = ledger.tasks.filter((t) => t.result === RESULT.COMMITTED);
    const quiet = ledger.tasks.length > 0
        && ledger.tasks.every((t) => [RESULT.SATISFIED, RESULT.USER_REQUIRED].includes(t.result));
    let navigation = null;
    if (quiet && !ledger.halted && ctx.advance !== false) {
        navigation = await advance({ sleep: ctx.sleep, verifyComplete: () => questionsComplete(ledger, gaps) });
    }

    trace('mdlz.questions.pass', {
        answered: done.length,
        left: gaps.length,
        gaps: gaps.map((g) => g.question.slice(0, 30)).join(' · ') || '(none)',
        advance: navigation ? navigation.result : '(not attempted — the page still needed work)',
    });

    return {
        took: true,
        ledger,
        gaps,
        navigation,
        advanced: navigation?.result === NAV.ADVANCED,
        report: {
            matched: true,
            filled: done.length,
            step: 'Application Questions',
            // `source` is why this shape exists: the review shows the user which
            // answers were the agent's before they submit.
            answers: done.map((t) => ({
                field: t.id,
                value: t.detail?.picked || t.detail?.answer?.value || '',
                source: t.detail?.answer?.source || 'mdlz-v2',
            })),
            v2: true,
            advancedTo: navigation?.to,
        },
    };
}
