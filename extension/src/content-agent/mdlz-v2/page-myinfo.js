/**
 * P2 — My Information. Twelve fields, and every rule below was paid for once.
 *
 * The data is the PROFILE here, not the CV: a résumé states an address in prose
 * and nothing extracts it into a street and a district, so the two required
 * address fields were profile-only until a measured run hit them empty and
 * returned NEED_HUMAN on data the CV had been holding all along. Resolution is
 * profile → CV → the one measured default.
 *
 * The order is not a preference. COUNTRY GOES FIRST because picking it
 * RE-RENDERS the region and postal fields — a Province filled before Country is
 * a Province filled into a node that is about to be replaced.
 *
 * What each field is, as measured on this tenant:
 *
 *   · legal names — western pair, plus a LOCAL pair on dual-script tenants
 *     ("Family Name - Vietnamese*"), both required where they render. The value
 *     is re-derived from the full name here rather than trusted, because a
 *     profile is only as correct as the web-app build that wrote it, and a stale
 *     one re-poisoned the split three times in one day.
 *   · previously worked here — a RADIO, and radios are why this step used to
 *     stall: eleven fields filled, that one untouched, advance withheld.
 *   · address line 1 / District or Town (`formField-city`) / postal code —
 *     required. Postal is FIVE digits: Vietnam switched in 2018 and Workday
 *     validates it, while a hard-coded legacy six survived 24 iterations of the
 *     field refilling itself.
 *   · Country / Province or City — Province is two different widgets behind one
 *     id (a button listbox on 3M, a searchable input on Mondelez), which is
 *     exactly why the capability is resolved from the shape at runtime.
 *   · phone type — the measured options are "Mobile - Personal", "Mobile -
 *     Work", "Telephone - Office", "Telephone - Personal", so a bare "Mobile"
 *     takes whichever is listed first. The ladder names the personal line.
 *   · country phone code — a REQUIRED multi-select on an INPUT: typing into it
 *     without committing an item leaves "0 items selected", which silently
 *     blocks Next while the scanner cannot see that anything is wrong.
 *
 * And one field is deliberately absent: the email box. Nothing here writes to
 * it. It is the account's own address, and the only measurement worth having
 * about it is that we left it alone.
 */

import { RESULT } from './config.js';
import { repairProfileNames, splitLegalName } from '../dom.js';
import { answerFromLadder, readNow, runField } from './executors.js';
import { fingerprintOf } from './fingerprint.js';
import { NAV, advance } from './navigation.js';
import { errorsIn } from './row.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';

/**
 * "How Did You Hear About Us?" — required, and the answer is a FACT the employer
 * acts on: "Employee referral" or "Recruiter" routes the application differently
 * and implies a person who does not exist. It carried `pickAny` once, which
 * takes the first option in the list when nothing matches — a coin flip between
 * claims about how the candidate found the job.
 *
 * So it walks this ladder, measured, in this order, and the last two rungs are
 * ANCHORED: "Other" is a truthful neutral claim and a better outcome than a
 * stranded required field, but a substring tier would resolve it to "Another job
 * board" through the letters inside "another".
 *
 * v1 has one more rung than this — it asks a model to pick from the options that
 * are really there. v2 has no model, so a ladder that misses leaves the field
 * and reports it. That is a smaller answer, not a wrong one.
 */
export const SOURCE_LADDER = [
    'Company Website', 'Company Careers Website', 'Employer Website', 'Careers Website',
    'Career Site', 'Careers Page', 'Career Page', 'Company Webpage', 'Website', 'Webpage',
    '=Other', '=Khác',
];

/** Vietnam's generic postal code, five digits — see the 2018 note above. */
export const VN_POSTAL = '10000';

/**
 * The COUNTRY, from a profile that only records a nationality.
 *
 * A nationality is an adjective and a country is a noun; the picker holds
 * nouns. Only the market actually served is translated — inventing a mapping
 * for every nationality would be guessing at what 249 catalogue rows are
 * called, and the field falls back to the measured default either way.
 */
export function countryName(profile) {
    const n = String(profile?.country || profile?.nationality || '').trim();
    if (!n) return 'Vietnam';
    if (/^(vietnamese|việt nam|viet nam|vietnam|vn)$/i.test(n)) return 'Vietnam';
    return n;
}

/**
 * The fields, in the order they must be done.
 *
 * `id` is the automation id; `want` reads from the profile and the CV. A field
 * that resolves to nothing is a GAP, not a guess — except where a measured
 * default exists and is named.
 */
export function myInfoPlan(profile, cv) {
    const p = repairProfileNames(profile || {});
    const split = splitLegalName(p.fullName || '') || {};
    const first = p.firstName || split.firstName || '';
    const last = p.lastName || split.lastName || '';
    const contact = cv?.contact || {};
    // Measured decision (2026-08-03): a CV that only says "Hà Nội" answers the
    // street and district with the city name rather than leaving two required
    // fields empty and the run dead.
    const city = p.addressProvince || contact.address_city || p.city || '';

    return [
        { id: 'formField-candidateIsPreviousWorker', want: 'No', why: 'agent default', isDefault: true },
        // Required. Two widgets behind one automation id — a button listbox on
        // 3M, a searchable input on Mondelez — so the capability is resolved
        // from the shape, and the answer from the ladder above.
        { id: 'formField-source', ladder: SOURCE_LADDER, required: true, isDefault: true },
        { id: 'formField-legalName--firstName', want: first, required: true },
        { id: 'formField-legalName--lastName', want: last, required: true },
        { id: 'formField-legalName--firstNameLocal', want: first, optional: true },
        { id: 'formField-legalName--lastNameLocal', want: last, optional: true },
        // MEASURED: picking Country re-renders the region and postal fields. It
        // goes first for that reason, and what it replaces is named here so the
        // fields after it are not filled into nodes about to be thrown away.
        //
        // The VALUE is a country name, which is not what the profile holds. The
        // profile carries `nationality` — taken from the CV, so "Vietnamese" —
        // and a live run fed that straight into a 249-country picker: no exact
        // match, no substring ("vietnam" does not contain "vietnamese"), and the
        // field re-opened every pass while already reading "Vietnam".
        { id: 'formField-country', want: countryName(p), required: true, isDefault: true, rerenders: ['formField-countryRegion', 'formField-postalCode'] },
        { id: 'formField-addressLine1', want: p.addressStreet || contact.address_street || city, required: true },
        { id: 'formField-city', want: p.addressDistrict || contact.address_district || city, required: true },
        { id: 'formField-countryRegion', want: p.addressProvince || city, optional: !city },
        { id: 'formField-postalCode', want: p.postalCode || VN_POSTAL, required: true, isDefault: !p.postalCode },
        { id: 'formField-phoneType', want: 'Mobile - Personal', why: 'agent default', isDefault: true },
        // DOCUMENTED EXCEPTION to the chip-search contract, not a precedent: a
        // semantically-ONE field still driven by searchMulti, because that is
        // the measured-working state (live runs: the parsed "Vietnam (+84)" chip
        // satisfies) and migrating it to searchSelect is gated on a measurement
        // NOT yet made — with the field EMPTY, does picking "Vietnam" commit on
        // Enter, and does the widget replace or accumulate a second chip? Until
        // that is measured, keeping the old behavior is the correct move; the
        // exception string is what lets CI tell this apart from a forgotten
        // declaration. NB the searchMulti verifier proves the term HAS a chip,
        // not that the chip count is one — the residual risk this TODO names.
        { id: 'formField-countryPhoneCode', want: [p.phoneCountry || 'Vietnam'], required: true, isDefault: !p.phoneCountry,
            capability: 'searchMulti', cardinality: 'one', contractException: 'measured-one-term-token-widget' },
        { id: 'formField-phoneNumber', want: p.phone || contact.phone || '', required: true },
    ];
}

/**
 * Wait for the replacement this field causes, then for the page to be quiet.
 *
 * Bounded, and reported by what it saw: if nothing is replaced within the
 * window, nothing was — the wait costs one budget and never a wrong verdict.
 */
async function settleRerender(ids, ctx = {}) {
    const nap = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const held = ids.map((id) => document.querySelector(`[data-automation-id="${id}"]`)).filter(Boolean);
    const replaced = () => held.some((n) => !document.contains(n));
    const by = Date.now() + (ctx.rerenderMs || 1500);
    while (Date.now() < by && !replaced()) await nap(60);
    trace('mdlz.myinfo.rerender', { after: ids.join(','), sawReplacement: replaced() });
    await nap(ctx.settleMs || 120);
}

const present = (id) => {
    try { return !!document.querySelector(`[data-automation-id="${id}"]`); } catch { return false; }
};

/** One planned field → a task the scheduler can run. */
function taskFor(entry, ctx) {
    return {
        id: entry.id,
        run: async () => {
            // Re-resolved at RUN time: Country re-renders the region and postal
            // fields, so a node looked up when the plan was built may already be
            // gone by the time its turn comes.
            const find = () => document.querySelector(`[data-automation-id="${entry.id}"]`);
            if (!find()) {
                // ABSENT, not pending. This runs only after the page reported
                // settled, and a field that is not rendered cannot be required by
                // the form that did not render it — "required" here is the
                // recipe's claim across tenants, not this page's. Returning
                // WAITING_HYDRATION instead would retry forever and park the
                // page, which is the same failure the missing source field
                // caused.
                return { result: RESULT.SKIPPED_OPTIONAL, reason: 'not rendered on this tenant' };
            }
            const f = fingerprintOf(find, { name: entry.id });
            const r = entry.ladder
                ? await answerFromLadder(f, entry.ladder, { ...ctx, isDefault: true })
                : await runField(f, entry.want, {
                    ...ctx, isDefault: !!entry.isDefault,
                    decl: {
                        capability: entry.capability,
                        cardinality: entry.cardinality,
                        contractException: entry.contractException,
                    },
                });
            // A field that replaces others is not finished when its own value
            // lands: the replacement is still coming, and whatever is written
            // in between is written into a node about to be discarded.
            if (entry.rerenders && r.result === RESULT.COMMITTED) await settleRerender(entry.rerenders, ctx);
            return r;
        },
    };
}

/** Is the page finished — asked the way the navigation transaction needs it. */
export function myInfoComplete(ledger, gaps = []) {
    const unfinished = (ledger?.tasks || [])
        .filter((t) => ![RESULT.SATISFIED, RESULT.COMMITTED, RESULT.SKIPPED_OPTIONAL].includes(t.result));
    if (unfinished.length) {
        return { complete: false, reason: `${unfinished[0].id} ended ${unfinished[0].result}` };
    }
    if (gaps.length) return { complete: false, reason: `${gaps[0].id}: ${gaps[0].why}` };
    const errors = errorsIn(typeof document !== 'undefined' ? document.documentElement : null);
    if (errors.length) return { complete: false, reason: errors[0] };
    return { complete: true };
}

export async function runMyInfoPage(ctx = {}) {
    const entries = myInfoPlan(ctx.profile, ctx.cv);
    const gaps = [];
    const tasks = [];
    for (const e of entries) {
        // A ladder IS the answer for its field — it just is not a single value.
        const empty = !e.ladder && (e.want === null || e.want === undefined || e.want === ''
            || (Array.isArray(e.want) && !e.want.filter(Boolean).length));
        if (empty) {
            // Required and unanswerable is a gap to report; optional and absent
            // costs nothing to skip.
            if (e.required) gaps.push({ id: e.id, why: 'neither the profile nor the CV says' });
            continue;
        }
        // An optional field this tenant does not render is not worth a task.
        if (e.optional && !present(e.id)) continue;
        tasks.push(taskFor(e, ctx));
    }

    trace('mdlz.myinfo.plan', {
        fields: tasks.length,
        gaps: gaps.map((g) => g.id).join(',') || '(none)',
        first: tasks.slice(0, 3).map((t) => t.id).join(' · '),
    });

    const ledger = await runSequential(tasks, { sleep: ctx.sleep });
    if (ledger.busy) {
        return { took: false, reason: 'another pass owns this page', report: { matched: false, filled: 0, busy: true } };
    }

    const done = ledger.tasks.filter((t) => t.result === RESULT.COMMITTED);
    const quiet = ledger.tasks.length > 0 && ledger.tasks.every((t) => [RESULT.SATISFIED, RESULT.SKIPPED_OPTIONAL].includes(t.result));
    let navigation = null;
    if (quiet && !ledger.halted && ctx.advance !== false) {
        navigation = await advance({ sleep: ctx.sleep, verifyComplete: () => myInfoComplete(ledger, gaps) });
    }

    trace('mdlz.myinfo.pass', {
        filled: done.length,
        satisfied: ledger.tasks.filter((t) => t.result === RESULT.SATISFIED).length,
        failed: ledger.tasks.filter((t) => ![RESULT.COMMITTED, RESULT.SATISFIED, RESULT.SKIPPED_OPTIONAL].includes(t.result)).length,
        gaps: gaps.length,
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
            step: 'My Information',
            answers: done.map((t) => ({ field: t.id, value: t.detail?.picked || '', source: 'mdlz-v2' })),
            v2: true,
            advancedTo: navigation?.to,
        },
    };
}
