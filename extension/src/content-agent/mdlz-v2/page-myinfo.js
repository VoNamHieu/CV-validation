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
import { runField } from './executors.js';
import { fingerprintOf } from './fingerprint.js';
import { NAV, advance } from './navigation.js';
import { errorsIn } from './row.js';
import { runSequential } from './scheduler.js';
import { trace } from '../trace.js';

/** Vietnam's generic postal code, five digits — see the 2018 note above. */
export const VN_POSTAL = '10000';

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
        { id: 'formField-candidateIsPreviousWorker', want: 'No', why: 'agent default' },
        { id: 'formField-legalName--firstName', want: first, required: true },
        { id: 'formField-legalName--lastName', want: last, required: true },
        { id: 'formField-legalName--firstNameLocal', want: first, optional: true },
        { id: 'formField-legalName--lastNameLocal', want: last, optional: true },
        // MEASURED: picking Country re-renders the region and postal fields. It
        // goes first for that reason, and what it replaces is named here so the
        // fields after it are not filled into nodes about to be thrown away.
        { id: 'formField-country', want: p.nationality || 'Vietnam', required: true, rerenders: ['formField-countryRegion', 'formField-postalCode'] },
        { id: 'formField-addressLine1', want: p.addressStreet || contact.address_street || city, required: true },
        { id: 'formField-city', want: p.addressDistrict || contact.address_district || city, required: true },
        { id: 'formField-countryRegion', want: p.addressProvince || city, optional: !city },
        { id: 'formField-postalCode', want: p.postalCode || VN_POSTAL, required: true },
        { id: 'formField-phoneType', want: 'Mobile - Personal', why: 'agent default' },
        { id: 'formField-countryPhoneCode', want: [p.phoneCountry || 'Vietnam'], required: true },
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
                return entry.optional
                    ? { result: RESULT.SKIPPED_OPTIONAL, reason: 'not on this tenant' }
                    : { result: RESULT.WAITING_HYDRATION, reason: 'the field is not on the page' };
            }
            const f = fingerprintOf(find, { name: entry.id });
            const r = await runField(f, entry.want, ctx);
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
        const empty = e.want === null || e.want === undefined || e.want === ''
            || (Array.isArray(e.want) && !e.want.filter(Boolean).length);
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
