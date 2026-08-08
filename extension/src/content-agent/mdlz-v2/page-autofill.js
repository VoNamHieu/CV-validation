/**
 * P1 — Autofill with Resume. One page, one action, and one way to be wrong.
 *
 * Everything here rests on a single measurement, recorded in dom.js beside the
 * definition it produced: WORKDAY INGESTS THE FILE AND CLEARS THE INPUT. So
 * `input.files` reads empty on every pass after the first, and an executor that
 * trusts it uploads the CV again, and again — measured at 5+ duplicate rows in
 * one run. The row markers Workday renders (`file-upload-item` /
 * `file-upload-successful`) are what testifies, and `readFileCommitState` is the
 * one place that says so, shared with the recipe and the observer because two
 * answers to this question once froze a run outright.
 *
 * The rest of the page is small: wait for the input, upload if the file is not
 * already there, prove it landed, and only then leave. The order matters at one
 * point — the proof comes before the advance, because a page left before the
 * parser has the CV is a My Experience that Workday will re-render underneath
 * whoever is filling it.
 *
 * What nobody has measured, and what is therefore NOT a number here: how long
 * the parse takes. The controller waits for the ROW, with a budget it reports
 * rather than a delay it assumes.
 */

import { RESULT, SEL } from './config.js';
import { readFileCommitState, setFileOnInput } from '../dom.js';
import { NAV, advance } from './navigation.js';
import { trace } from '../trace.js';

const napper = (sleep) => sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

async function until(fn, { sleep, budgetMs = 4000, pollMs = 120 } = {}) {
    const nap = napper(sleep);
    const by = Date.now() + budgetMs;
    for (;;) {
        if (fn()) return true;
        if (Date.now() >= by) return false;
        await nap(pollMs);
    }
}

/**
 * Which CV this is, cheaply.
 *
 * Not a hash for its own sake: the question it answers is "did THIS run already
 * hand this file over", and a name plus a size answers it without reading a
 * megabyte of base64 on every pass. A different CV in the same run is a
 * different upload and should happen.
 */
export const cvIdentity = (cvData) => (cvData?.fileName
    ? `${cvData.fileName}:${(cvData.base64 || '').length}`
    : null);

/**
 * What this run has already uploaded — on `window`, like every other claim.
 *
 * A document can hold two copies of the content script, and the copy that did
 * not upload must still know that the other one did. Per document, which is
 * what "per run" means here: a navigation to a new application starts over.
 */
const MEMORY = '__copoUploadedCv';
const win = () => (typeof window !== 'undefined' ? window : globalThis);
export const alreadyUploaded = (id) => !!id && win()[MEMORY] === id;
export const rememberUpload = (id) => { if (id) win()[MEMORY] = id; };
export const forgetUploads = () => { win()[MEMORY] = null; };

/** The upload target, if it is on the page yet. */
const fileInput = () => {
    try { return document.querySelector(SEL.fileInput); } catch { return null; }
};

/** The one definition, asked about this page's input. */
export const resumeState = () => readFileCommitState(fileInput(), document);

/**
 * "The ATS HAS the file" and "the ATS has ACKNOWLEDGED it" are two questions.
 *
 * The shared definition answers the first, and that is the right question for
 * "should I upload?" — a file sitting on the input is a file not to send again.
 * Leaving the page needs the second, and v1's recipe already measured what
 * answers it: advanceWhen is the row markers, with the reason written beside it
 * — "do not leave until the résumé is actually attached; advancing early skips
 * the parse this step exists for, and the parse is what fills My Information."
 *
 * A file on an input Workday has not taken is exactly the state that looks
 * finished and is not.
 */
export const resumeAcknowledged = () => resumeState().uploadedRows > 0;

/**
 * Run the page.
 *
 * Returns the shape every controller returns: what happened, and whether the
 * page was left.
 */
export async function runAutofillPage(ctx = {}) {
    const { sleep, cvData } = ctx;
    const id = cvIdentity(cvData);

    // 1. The input can render after the page does — that is hydration, not a
    //    missing page, and it is worth waiting for rather than failing on.
    const haveInput = await until(() => !!fileInput(), { sleep, budgetMs: ctx.inputMs || 4000 });
    const before = resumeState();

    // 2. Acknowledged already? Then this is a re-entry and the correct amount of
    //    work is none. Reading the INPUT here would say "empty" about a file
    //    Workday has already taken.
    if (before.uploadedRows > 0) {
        trace('mdlz.autofill', { state: 'already attached', rows: before.uploadedRows, files: before.nativeFiles });
        rememberUpload(id);
        return finish({ ...ctx, result: RESULT.SATISFIED, detail: before });
    }

    if (!haveInput) {
        // Measured: the file input is ABSENT on the first pass and appears on
        // the second. A page without it is early, not broken.
        trace('mdlz.autofill', { state: 'no upload target yet' });
        return { took: true, result: RESULT.WAITING_HYDRATION, reason: 'the file input has not rendered' };
    }

    // 3. HANDED OVER, NOT YET ACKNOWLEDGED — either the file is still sitting on
    //    the input (the state before the ingest that clears it) or this run
    //    uploaded it and the row has not arrived. Both are the window the
    //    duplicates lived in, and the answer to both is to WAIT, never to send
    //    the file again. What this run uploaded is remembered on `window`, where
    //    the other copy of the content script can see it too.
    if (before.nativeFiles > 0 || alreadyUploaded(id)) {
        rememberUpload(id);
        const landed = await until(resumeAcknowledged, { sleep, budgetMs: ctx.commitMs || 8000 });
        trace('mdlz.autofill', {
            state: landed ? 'acknowledged on a later pass' : 'still ingesting',
            onInput: before.nativeFiles, uploadedThisRun: alreadyUploaded(id),
        });
        if (!landed) return { took: true, result: RESULT.WAITING_HYDRATION, reason: 'the upload has not been acknowledged yet' };
        return finish({ ...ctx, result: RESULT.SATISFIED, detail: resumeState() });
    }

    if (!cvData?.base64 || !cvData?.fileName) {
        return { took: true, result: RESULT.USER_REQUIRED, reason: 'no CV file to upload' };
    }

    // 5. Upload, through the shared implementation. Its own note is worth
    //    keeping in mind: these events are isTrusted:false, so a parser that
    //    gates on trust is not fully satisfied by them.
    const el = fileInput();
    let ok = false;
    try { ok = setFileOnInput(el, cvData.base64, cvData.fileName); } catch { ok = false; }
    if (!ok) return { took: true, result: RESULT.COMMIT_FAILED, reason: 'the file would not go onto the input' };
    rememberUpload(id);

    // 6. Prove it landed — by the ROW, never by the input we just wrote to.
    const landed = await until(resumeAcknowledged, { sleep, budgetMs: ctx.commitMs || 8000 });
    const after = resumeState();
    trace('mdlz.autofill', {
        state: landed ? 'attached' : 'never acknowledged',
        rows: after.uploadedRows, files: after.nativeFiles, scoped: after.scoped,
    });
    if (!landed) {
        return { took: true, result: RESULT.COMMIT_FAILED, reason: 'no upload row appeared', detail: after };
    }
    return finish({ ...ctx, result: RESULT.COMMITTED, detail: after });
}

/**
 * Leave — but only on the proof, not on the upload.
 *
 * A page left before the parser has the CV is a My Experience that Workday
 * re-renders underneath whoever is filling it, which is the whole reason this
 * page is worth owning separately.
 */
async function finish(ctx) {
    const { result, detail } = ctx;
    const navigation = ctx.advance === false ? null : await advance({
        sleep: ctx.sleep,
        verifyComplete: () => (resumeAcknowledged()
            ? { complete: true }
            : { complete: false, reason: 'the résumé is not acknowledged yet' }),
    });
    return {
        took: true,
        result,
        detail,
        navigation,
        advanced: navigation?.result === NAV.ADVANCED,
        report: {
            matched: true,
            filled: result === RESULT.COMMITTED ? 1 : 0,
            step: 'Autofill with Resume',
            answers: [],
            v2: true,
            advancedTo: navigation?.to,
        },
    };
}
