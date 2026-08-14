/**
 * P5 — Voluntary Disclosures. The page where being wrong is worst.
 *
 * Two demographic prompts and a consent box, measured on Mondelez R-173278
 * (2026-08-02) — a page that had no recipe step at all and therefore always fell
 * to the planner.
 *
 * THE RULE THAT GOVERNS EVERYTHING HERE: v2 never chooses a demographic value.
 * Declining is the only answer that states nothing about a person, and the only
 * substantive answer allowed is one the CANDIDATE has already given in their own
 * profile — INCLUDING that stated value translated into the tenant's own label
 * ("Nam" → this list's "Male", via semantic.js genderLadder). Translating the
 * candidate's own answer into the list's language is still their answer, not a
 * choice v2 made. Where neither exists the field is left, and the review lists it. The
 * measured deny patterns are kept as a structural belt: whatever the ladder
 * produces, a substantive pick that did not come from the profile is refused, so
 * the worst outcome of a rung that misses is an empty field — which is what a
 * missing rung produced anyway.
 *
 * The decline row is worded differently by every tenant, and each wording cost a
 * run: Mondelez offers Female / Male / "Not Specified" / Other, Visa offers
 * "Not Declared", and neither is matched by the US-styled phrasings — the Visa
 * one stalled two runs for a phrasing alone.
 *
 * ETHNICITY IS NOT THE SAME QUESTION. A VN tenant's list is the country's
 * ethnic-group catalogue and carries no decline row at all, so the profile's own
 * value ("Kinh") is tried first and a silent profile leaves the field — it is
 * optional, and an optional demographic left blank is the correct outcome, not a
 * failure to be worked around.
 *
 * THE CONSENT BOX IS TICKED, and the marketing box is not. That boundary is
 * policy.js's, not this file's: the marketing exclusion is checked FIRST and
 * wins, so "receive marketing updates — I consent" can never be read as a
 * required terms box. The product's one approval boundary is the SUBMIT button,
 * which stays the user's; an acknowledgement gating the review page is answered
 * so the user reaches the review they were going to read anyway.
 */

import { RESULT, SEL } from './config.js';
import { resolveAnswer } from '../answers.js';
import { CONSENT_RE, MARKETING_RE } from '../policy.js';
import { CAPABILITY, chooseOption, readNow, runField } from './executors.js';
import { WIDGET, fingerprintOf, triggerOf } from './fingerprint.js';
import { NAV, advance } from './navigation.js';
import { withList } from './popup-manager.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';
import { genderLadder } from '../semantic.js';
import { countryName } from './page-myinfo.js';

const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
const fold = (s) => String(s || '').trim().toLowerCase();

/**
 * The shapes a wrong demographic pick would take, measured per catalogue.
 *
 * It cannot enumerate every ethnicity and does not try to: it blocks what a
 * mistake looks like on THESE lists. The profile's own value is never checked
 * against it — a candidate stating their own gender or ethnicity is the one
 * substantive answer that is theirs to give.
 */
export const SUBSTANTIVE = {
    gender: /^\s*(male|female|man|woman|nam|nữ|khác|other)\s*$/i,
    ethnicity: /^\s*(asian|white|black|hispanic|latino|kinh|hoa|tày|thái|mường|khmer|nùng|other)\s*$/i,
};

/** The decline rungs, in the order each was measured to be needed. */
export const DECLINE = [
    'Not Specified', 'Not Declared', 'Undeclared', 'Prefer not to say',
    'Decline to answer', 'I do not wish to answer', "I don't wish to answer",
    'Decline to self-identify', 'Choose not to disclose', 'Not applicable',
];

/**
 * What to say, and whose answer it is.
 *
 * Profile first — that is the candidate speaking. Then the decline ladder among
 * the options the page really offers. Then nothing.
 */
export function disclosureAnswer(kind, offered, profile) {
    const own = profile?.[kind];
    if (own && String(own).trim()) {
        // GENDER MATCHES EXACT-ONLY. "male" is a substring of "female" and "man"
        // of "woman", so an includes() match misgenders a stated "Male"/"Man" on
        // a list that carries only the opposite. Ethnicity keeps the substring
        // pass on purpose — the profile's "Kinh" must find "Kinh (Vietnam)".
        const hit = kind === 'gender'
            ? offered.find((o) => fold(o) === fold(own))
            : offered.find((o) => fold(o) === fold(own)) || offered.find((o) => fold(o).includes(fold(own)));
        if (hit) return { value: hit, source: 'PROFILE' };
        // Gender only: the SAME stated gender in the tenant's language, so a
        // candidate who wrote "Nam" registers as this list's "Male" (or "Nam"
        // on a VN list). EXACT match here too, so "man" can never hit "woman";
        // the value returned is the tenant's own label. This states nothing the
        // candidate did not — it is their gender, translated — so it is tagged
        // PROFILE and the SUBSTANTIVE belt admits it. Ethnicity gets no ladder.
        if (kind === 'gender') {
            for (const variant of genderLadder(own)) {
                const g = offered.find((o) => fold(o) === fold(variant));
                if (g) return { value: g, source: 'PROFILE' };
            }
        }
    }
    for (const rung of DECLINE) {
        const hit = offered.find((o) => fold(o) === fold(rung))
            || offered.find((o) => fold(o).includes(fold(rung)));
        if (hit) return { value: hit, source: 'AGENT_DEFAULT' };
    }
    return null;
}

/** One demographic prompt. */
async function answerDemographic(id, kind, ctx, { required }) {
    const find = () => document.querySelector(`[data-automation-id="${id}"]`);
    if (!find()) return { result: RESULT.SKIPPED_OPTIONAL, reason: 'not on this tenant' };
    const f = fingerprintOf(find, { name: id });

    const shown = readNow(f);
    if (shown && !/^\(select one\)$/i.test(shown)) {
        // Answered already — by us, or by the candidate on a draft they came
        // back to. Their own disclosure is the last thing to overwrite.
        return { result: RESULT.SATISFIED, detail: { picked: shown } };
    }

    const trigger = triggerOf(f);
    if (!trigger) return { result: RESULT.WAITING_HYDRATION, reason: 'no trigger yet' };

    let answer = null;
    const opened = await withList(trigger, async (lease) => {
        const offered = lease.options().map(txt).filter(Boolean);
        answer = disclosureAnswer(kind, offered, ctx.profile);
        if (!answer) return { result: required ? RESULT.USER_REQUIRED : RESULT.SKIPPED_OPTIONAL, offered };
        // THE BELT: a substantive value that did not come from the profile is
        // refused here, whatever produced it.
        if (answer.source !== 'PROFILE' && SUBSTANTIVE[kind].test(answer.value)) {
            trace('mdlz.disclosure.refused', { field: id, why: 'a substantive value nobody stated' });
            return { result: RESULT.USER_REQUIRED, offered };
        }
        const choice = chooseOption(lease.options(), answer.value);
        if (!choice.option) return { result: choice.why, saw: choice.saw };
        choice.option.click();
        return { result: RESULT.COMMITTED, picked: choice.matched };
    }, { sleep: ctx.sleep, label: id });

    if (!opened.ok) return { result: opened.result || RESULT.COMMIT_FAILED, reason: opened.reason };
    if (opened.value?.result !== RESULT.COMMITTED) {
        trace('mdlz.disclosure.left', {
            field: id, offered: (opened.value?.offered || []).slice(0, 4).join(' | '),
            why: 'no decline row on this catalogue, and the profile is silent',
        });
        return { ...opened.value, reason: 'nothing here can be answered without stating something' };
    }
    const proof = await CAPABILITY[WIDGET.LISTBOX].verify(f, opened.value.picked, ctx);
    return { ...proof, answer, picked: opened.value.picked };
}

/**
 * Split a date of birth into { year, month, day }, or return null.
 *
 * A date of birth is a real record: a WRONG one is worse than an empty one. So
 * the ambiguous case — 03/04/2000, March or April? — returns null and the field
 * becomes a gap the candidate fills, never a guess. ISO (2000-03-15) is
 * unambiguous on the year's place; a slash/dot/dash date is read D-M-Y or M-D-Y
 * and only disambiguated when one of the first two parts exceeds 12.
 */
export function parseDob(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const ok = (y, m, d) => (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
        ? { year: y, month: m, day: d } : null;
    // Year-first (ISO and its slash/dot cousins): the year's position is certain.
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return ok(+m[1], +m[2], +m[3]);
    // Year-last: the first two parts need disambiguation.
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
        const [a, b, y] = [+m[1], +m[2], +m[3]];
        if (a > 12 && b <= 12) return ok(y, b, a);   // a can only be the day → D/M/Y
        if (b > 12 && a <= 12) return ok(y, a, b);   // b can only be the day → M/D/Y
        return null;                                 // both ≤ 12: ambiguous, do not guess
    }
    return null;
}

/**
 * Date of Birth — a segmented month/day/year spin-input, REQUIRED on some tenants
 * (measured Maersk R173118). Filled only from an UNAMBIGUOUS profile date; a
 * missing or ambiguous one is a gap the candidate fills, NOT the ~3-minute loop
 * v1 spun here. A DOB already on a resumed draft is the candidate's and is left.
 */
async function answerDateOfBirth(id, ctx, { required }) {
    const find = () => document.querySelector(`[data-automation-id="${id}"]`);
    if (!find()) return { result: RESULT.SKIPPED_OPTIONAL, reason: 'not on this tenant' };
    const f = fingerprintOf(find, { name: id });

    const cur = CAPABILITY[WIDGET.DATE].read(f);
    if (cur.month && cur.year && (cur.day == null || cur.day)) {
        return { result: RESULT.SATISFIED, detail: { picked: readNow(f) } };
    }

    const parsed = parseDob(ctx.profile?.dateOfBirth);
    if (!parsed) {
        return { result: required ? RESULT.USER_REQUIRED : RESULT.SKIPPED_OPTIONAL,
            reason: 'no unambiguous date of birth in the profile' };
    }
    const done = await CAPABILITY[WIDGET.DATE].commit(f, parsed, ctx);
    if (done.result !== RESULT.COMMITTED) return { ...done, detail: { picked: readNow(f) } };
    const proof = await CAPABILITY[WIDGET.DATE].verify(f, parsed, ctx);
    return { ...proof, detail: { picked: readNow(f) } };
}

/** Every checkbox on the page, sorted into what may be ticked and what may not. */
export function consentBoxes() {
    try {
        return [...document.querySelectorAll('[data-automation-id^="formField-"]')]
            .filter((w) => w.offsetParent !== null)
            .filter((w) => w.querySelector('input[type="checkbox"]'))
            .map((wrap) => {
                const text = txt(wrap);
                // Marketing FIRST and it wins — policy.js's rule, because
                // "receive marketing updates — I consent" reads as a terms box
                // to anything that checks consent first.
                const marketing = MARKETING_RE.test(text);
                return {
                    wrap,
                    id: wrap.getAttribute('data-automation-id'),
                    text,
                    marketing,
                    consent: !marketing && CONSENT_RE.test(text),
                };
            });
    } catch { return []; }
}

async function answerConsent(box, ctx) {
    if (box.marketing) {
        // Nobody signs a candidate up for promotional mail to advance a form.
        trace('mdlz.consent.refused', { field: box.id, why: 'marketing' });
        return { result: RESULT.SKIPPED_OPTIONAL, reason: 'marketing consent is never ticked' };
    }
    const find = () => document.querySelector(`[data-automation-id="${box.id}"]`);
    const f = fingerprintOf(find, { name: box.id });
    if (!box.consent) {
        // A box nothing recognises is a box nobody agreed to.
        const answer = resolveAnswer({ questionText: box.text }, ['yes', 'no'], ctx.profile, ctx.cv);
        if (!answer) return { result: RESULT.USER_REQUIRED, reason: 'an agreement nothing in the policy speaks to' };
    }
    return runField(f, true, ctx);
}

export function disclosuresComplete(ledger, gaps) {
    const unfinished = (ledger?.tasks || [])
        .filter((t) => ![RESULT.SATISFIED, RESULT.COMMITTED, RESULT.SKIPPED_OPTIONAL].includes(t.result))
        .filter((t) => t.result !== RESULT.USER_REQUIRED);
    if (unfinished.length) return { complete: false, reason: `${unfinished[0].id} ended ${unfinished[0].result}` };
    if (gaps.length) return { complete: false, reason: gaps[0].why };
    let errors = [];
    try {
        errors = [...document.querySelectorAll(SEL.fieldError)].filter((e) => e.offsetParent !== null).map(txt);
    } catch { /* no DOM */ }
    if (errors.length) return { complete: false, reason: errors[0] };
    return { complete: true };
}

export async function runDisclosuresPage(ctx = {}) {
    const gaps = [];
    const tasks = [
        {
            id: 'formField-gender',
            run: async () => {
                const r = await answerDemographic('formField-gender', 'gender', ctx, { required: true });
                if (r.result === RESULT.USER_REQUIRED) {
                    gaps.push({ id: 'formField-gender', why: 'no decline option and no stated gender' });
                }
                return r;
            },
        },
        {
            id: 'formField-ethnicity',
            // Optional, and an optional demographic left blank is the right
            // outcome rather than a failure to work around.
            run: () => answerDemographic('formField-ethnicity', 'ethnicity', ctx, { required: false }),
        },
        {
            id: 'formField-dateOfBirth',
            // REQUIRED where it renders (measured Maersk); a DOB the profile
            // cannot supply unambiguously is a gap the candidate fills, never the
            // loop v1 spun on this segmented widget.
            run: async () => {
                const r = await answerDateOfBirth('formField-dateOfBirth', ctx, { required: true });
                if (r.result === RESULT.USER_REQUIRED) {
                    gaps.push({ id: 'formField-dateOfBirth', why: r.reason || 'no date of birth to fill' });
                }
                return r;
            },
        },
        {
            id: 'formField-nationality',
            // Maersk asks a REQUIRED Primary Nationality that MDLZ never rendered
            // (measured R192834, 2026-08-14): the plan had no task for it, so it
            // stayed "Select One", advance held INCOMPLETE, and the run escalated
            // and ended ONE PAGE short of Review after everything else was done.
            // The prompt's own options are COUNTRY names ("Vietnam"), not demonyms
            // — the SAME picker My Information fills for Country — so countryName()
            // turns the profile's stated nationality/country into that noun. It is
            // the candidate's own stated country, not a demographic v2 chose, so
            // the disclosures policy admits it; the generic listbox capability,
            // resolved from the fingerprint, makes the pick.
            run: async () => {
                const find = () => document.querySelector('[data-automation-id="formField-nationality"]');
                if (!find()) return { result: RESULT.SKIPPED_OPTIONAL, reason: 'not on this tenant' };
                const f = fingerprintOf(find, { name: 'formField-nationality' });
                const r = await runField(f, countryName(ctx.profile), ctx);
                if (r.result === RESULT.USER_REQUIRED) {
                    gaps.push({ id: 'formField-nationality', why: r.reason || 'nationality not offered by the prompt' });
                }
                return r;
            },
        },
    ];

    for (const box of consentBoxes()) {
        tasks.push({ id: box.id, run: () => answerConsent(box, ctx) });
    }

    const ledger = await runSequential(tasks, { sleep: ctx.sleep });
    if (ledger.busy) return { took: false, reason: 'another pass owns this page', report: { matched: false, filled: 0, busy: true } };

    const done = ledger.tasks.filter((t) => t.result === RESULT.COMMITTED);
    const quiet = ledger.tasks.length > 0
        && ledger.tasks.every((t) => [RESULT.SATISFIED, RESULT.SKIPPED_OPTIONAL, RESULT.USER_REQUIRED].includes(t.result));
    let navigation = null;
    if (quiet && !ledger.halted && ctx.advance !== false) {
        navigation = await advance({ sleep: ctx.sleep, verifyComplete: () => disclosuresComplete(ledger, gaps) });
    }

    trace('mdlz.disclosures.pass', {
        answered: done.length,
        left: gaps.length,
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
            step: 'Voluntary Disclosures',
            answers: done.map((t) => ({
                field: t.id,
                value: t.detail?.picked || '',
                source: t.detail?.answer?.source || 'AGENT_DEFAULT',
            })),
            v2: true,
            advancedTo: navigation?.to,
        },
    };
}
