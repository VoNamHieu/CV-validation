/**
 * Copo — Universal Apply Agent (v2 — Autonomous Agent)
 *
 * Replaces the linear single-shot form filler with an agentic loop:
 *   Observe → Plan → Act → Verify → Repeat
 *
 * Capabilities:
 *   - Scroll to discover lazy-loaded fields
 *   - Scan iframes, modals, shadow DOM
 *   - Handle custom dropdowns (React Select, MUI, Ant, Select2)
 *   - Navigate multi-step wizard forms
 *   - Upload CV files
 *   - Detect and recover from validation errors
 *   - Simulate keyboard typing for stubborn frameworks
 */

import { AGENT_MAX_RUNTIME_MS, APPLY_SESSION_TTL_MS, FILL_RETRY_THRESHOLD, POST_ACTION_WAIT_MS } from './constants.js';
import { closeOpenDropdown, safeActivate, setNativeValue, sleep } from './dom.js';
import { removeProgress, showConfirmation, showProgress, showToast } from './ui.js';
import { callAgentPlan, callLLMMapping } from './llm.js';
import { executeFillInstructions } from './fill.js';
import { auditRequiredBlockers, observePageState, scrollAndCollect } from './observe.js';
import { findApplyButton, isApplicationFormPage, summarizeState, waitForJobPageSignal } from './detect.js';
import { detectLoginWall, handleLoginWall } from './login.js';
import { trace, traceClear, traceDump, traceOnce } from './trace.js';
import { applyRecipeFields, atFinalStep, clickRecipeGateway, inferFillDynamicField, loadRecipes, recipeForUrl, recipeOwnedWrappers, recipeReleased } from './recipe.js';
import { checkClick, logDenial } from './policy.js';
import { buildManifest, summarizeGaps, VERDICT } from './needs.js';
import { tenantRefFor } from '../ats/tenant.js';

// Build marker — logs the moment content-agent.js injects on a matched page, so
// you can confirm (in the PAGE / tab console, NOT the service-worker console) that
// the freshly-built dist is actually loaded. If you don't see this line on the
// apply tab, the new build isn't injected (reload the extension + refresh the tab).
const COPO_BUILD = 'prod-final-2026-08-03m';
try { console.log(`%c[Copo] content-agent build ${COPO_BUILD} loaded → ${location.host}`, 'color:#c43b2e;font-weight:700'); } catch { /* noop */ }

/**
 * The CV this apply may upload.
 *
 * A driven apply (batch, or a single apply launched from the web app) uses the
 * document attached to ITS session — and nothing else. There is deliberately no
 * fallback here, because the obvious-looking one is wrong: the global
 * `cvFileBase64` slot is not a generic CV. `buildCvPdfCache` writes whichever
 * job was optimised most recently into it (the filename even carries that job's
 * title), so falling back to it would upload another company's tailored CV —
 * the exact bug session-scoping exists to prevent, one hop removed.
 *
 * A job queued without its own PDF therefore applies text-only, which is what
 * the web app already promises the user when it counts them: "Các công việc
 * thiếu file sẽ ứng tuyển chỉ với văn bản."
 *
 * The global slot is used ONLY when there is no session at all — a manual apply
 * from the floating button, on a page the user opened themselves. There it is
 * the sole candidate, and the most recent CV is the best available guess.
 *
 * @returns {{cv: object|null, driven: boolean}} `driven` marks an apply we were
 *   sent to do (batch / web-app single). Those must carry their own tailored CV;
 *   the caller refuses to apply without one rather than sending a weaker
 *   application that can never be taken back.
 */
async function loadSessionCv() {
    try {
        const { applySession, pendingAutoApply } = await chrome.storage.local.get(['applySession', 'pendingAutoApply']);
        const sid = applySession?.sessionId;
        if (sid) {
            const key = `applyCv:${sid}`;
            const scoped = (await chrome.storage.local.get(key))[key];
            if (scoped?.base64 && scoped?.fileName) {
                return { cv: { base64: scoped.base64, fileName: scoped.fileName, scope: 'session' }, driven: true };
            }
            return { cv: null, driven: true };
        }
        if (pendingAutoApply) {
            // A DRIVEN flow whose session evaporated (worker recycle, sweep
            // race) must NOT fall back to whatever blob is lying around —
            // measured: a fixture PDF got uploaded and Workday parsed its fake
            // employer into a real application. No session, no CV: the driven
            // guard downstream refuses with cv_missing instead.
            return { cv: null, driven: true };
        }
        const g = await chrome.storage.local.get(['cvFileBase64', 'cvFileName']);
        if (g.cvFileBase64 && g.cvFileName) {
            return { cv: { base64: g.cvFileBase64, fileName: g.cvFileName, scope: 'manual' }, driven: false };
        }
    } catch (e) {
        console.warn('[Copo Apply] CV lookup failed:', e?.message);
    }
    return { cv: null, driven: false };
}

/**
 * A page-level failure the ATS says to recover from by reloading — as opposed to
 * a field that failed validation.
 *
 * "Page Error - Error Code: VPS|<guid>" was measured on a live Mondelez apply
 * step: a Workday server error that leaves the step wedged with every field still
 * filled. The recovery only knew the friendlier "Something went wrong / refresh
 * the page" wording, so this variant read as a normal page and the agent kept
 * planning against a form that could not advance.
 */
const WORKDAY_ERROR_CARD_RE =
    /something went wrong|refresh the page and (?:then )?try again|page error\s*-\s*error code|error code:\s*vps\b/i;

/**
 * Main agentic loop: Observe → Plan → Act → Verify.
 */
async function runAgentLoop(profile) {
    // Deliberately NOT a reset. The agent is re-injected on every navigation, so
    // each page load re-enters here — and the steps worth reading are the ones
    // from before the last navigation. The buffer is cleared when a job's result
    // is reported, not when a page loads.
    trace('loop.enter', { host: location.hostname, hasProfile: !!profile });
    const history = [];
    let prevStateHash = '';
    let prevStepCurrent = null;
    let prevUrl = window.location.href;
    const fillAttempts = new Map(); // selector → { count, lastValue }
    const persistentlyUnfilled = new Set();
    // Deterministic-recovery budget per recipe field (validation error → recipe
    // retries before the planner is asked). Reset when the wizard moves on.
    const fieldRecovery = new Map(); // field label → retry count
    // Needs-pass budget per selector: an instruction that "succeeds" without
    // changing the page re-arms itself every iteration, and its `continue`
    // starves everything downstream — measured: one mis-classified checkbox
    // consumed 22 iterations while the recipe never ran again.
    const needsAttempts = new Map(); // selector → attempts this page
    // Error-persistence breaker: how many consecutive iterations each
    // validation error has survived. A loop that cannot clear an error must
    // SAY SO and stop — measured: "Postal code must be 5 digits" outlived 24
    // rounds of refilling the same mis-formatted profile value.
    const errorStreak = new Map(); // "field|message" → consecutive iterations
    // Completion signals present BEFORE we act. Job pages often contain static
    // marketing copy that matches the success regexes ("ứng tuyển thành công
    // trong 1 phút", "Cảm ơn bạn đã quan tâm..."), so only signals that APPEAR
    // after we actually did something count as a submitted application.
    let baselineSignals = null;
    let actionsTaken = 0;
    // Transient planner failures tolerated before giving up on the job.
    let planFailures = 0;
    // Passes spent waiting for a wizard page to render before planning against it.
    let emptyPageWaits = 0;
    // Passes spent waiting for a step's own precondition (a CV attaching).
    let preconditionWaits = 0;
    // For the two-signal submitted check: a form we have actually seen, and where
    // we started, so "the form is gone" and "we are on a confirmation URL" are
    // statements about a change rather than about the first page we happened to load.
    let sawForm = false;
    const startUrl = window.location.href;
    // Answer provenance, accumulated ACROSS steps — a Workday application spans
    // four pages, and the user reviews it once at the end. Keyed by field so a
    // re-fill on a later pass updates rather than duplicates.
    const reviewAnswers = new Map();
    // Fields this application asked for that no stored data could answer. Sent
    // back with the result so the product can ask the user once rather than
    // discovering the same hole at every company.
    const fieldGaps = new Map();
    const gatewayClicks = new Map();   // recipe gateway label → click count (loop guard)

    // The STRUCTURED CV. Already synced for Mode-1 tailoring and never read by
    // the apply agent, which only ever saw the flattened 23-field profile — so
    // every field the flat shape has no slot for (school, subject, grade,
    // language level, a second education entry, employment rows) was unfillable
    // no matter how correct the selector was.
    const cvStructured = await new Promise(r => {
        chrome.storage.local.get('jobfitCv', d => r(d.jobfitCv || null));
    });

    // The slice of the structured CV the planner needs to INFER answers a CV
    // never states outright — most of all which entry in a degree list a
    // qualification corresponds to. That is derivable from the institution, the
    // subject and the years; it is not a fact invented about the candidate, and
    // it is the difference between an application that reaches review and one
    // that stalls on a required dropdown. Kept small on purpose: education and
    // languages only, never the whole CV.
    const credentials = cvStructured ? {
        education: (cvStructured.education || []).slice(0, 4),
        languages: (cvStructured.languages || []).slice(0, 4),
    } : null;

    // Load the CV FILE for THIS apply session (see loadSessionCv).
    const { cv: cvData, driven } = await loadSessionCv();
    const hasCV = !!cvData;
    if (cvData) console.log(`[Copo Apply] CV: ${cvData.fileName} (${cvData.scope})`);

    // An apply we were SENT to do must carry the CV tailored for this job. If it
    // does not, stop before touching the form.
    //
    // The alternative — apply "text-only" — was the old behaviour, and it is a
    // worse outcome than not applying: an application is one-shot and cannot be
    // withdrawn and re-sent with the right document, so a degraded submission
    // spends the opportunity for good. Reporting it as blocked keeps the job
    // actionable: the user re-renders the PDF and runs the batch again.
    if (driven && !hasCV) {
        console.warn('[Copo Apply] ✋ no tailored CV for this job — refusing to apply');
        reportResult(false, 'Chưa có CV tinh chỉnh cho job này — hãy tối ưu lại rồi chạy lại.',
            'blocked', { blockedReason: 'cv_missing' });
        return;
    }
    // ATS credentials are NOT read from storage any more: the background fetches
    // them from the backend just-in-time, per tenant, and hands them over only
    // when we actually hit a wall (see requestAtsAuth). Nothing here holds a
    // password until that moment, and nothing writes one back to storage.
    let atsAuthDone = false;

    // Per-ATS recipe for THIS host (Workday…): exact verified selectors for the
    // standardized fields, so the reliable text inputs get filled deterministically
    // and the LLM only handles dropdowns / navigation / non-standard questions.
    // Loaded once per page (a redirect to the ATS re-injects the agent → new load).
    let recipe = null;
    try {
        recipe = recipeForUrl(await loadRecipes(), location.href);
        if (recipe) console.log(`[Copo Apply] recipe matched: ${recipe.ats} v${recipe.version} (verified: ${recipe.verified})`);
    } catch (e) {
        console.warn('[Copo Apply] recipe load failed (LLM-only):', e?.message);
    }

    // What the action policy needs to know about where we are, recomputed per
    // call because `atFinalStep` is a live DOM question. Declaring the source is
    // the caller's one job; omitting it means the strictest treatment.
    const policyCtx = (source, extra = {}) => ({
        source,
        atFinalStep: recipe ? atFinalStep(recipe) : false,
        submitSelector: recipe?.submitSelector,
        ...extra,
    });

    // NOTE: no credential state is logged (or even in scope) here — the password
    // is fetched from the background per tenant, at the moment of use. An earlier
    // `hasCreds: !!applyCreds?.password` survived that refactor as a dangling
    // reference and threw a ReferenceError before the try block, killing the loop
    // on its very first line.
    console.log('[Copo Apply] ▶ runAgentLoop start', {
        url: location.href, host: location.hostname, hasCV,
        recipe: recipe?.ats || null, profileFields: Object.keys(profile || {}).length,
    });

    try {
        // Step 0: click an Apply button ONLY if we're not already on the form.
        // On an application form (e.g. Trakstar's ?apply=true) hunting for "Apply"
        // matches a third-party shortcut ("Apply with Indeed") and hijacks the
        // flow into a redirect/reload loop — so when the form is here, fill it.
        showProgress(0, null, 'Kiểm tra trang...');
        await sleep(1000);

        if (isApplicationFormPage()) {
            console.log('[Copo Apply] step0: already on an application form — filling directly (skip Apply hunt)', location.href);
            showProgress(0, null, 'Đã ở form ứng tuyển, bắt đầu điền...');
            await sleep(300);
        } else {
            const applyBtn = findApplyButton();
            if (applyBtn) {
                console.log('[Copo Apply] step0: clicked Apply button:', (applyBtn.innerText || applyBtn.value || '').trim().slice(0, 40));
                // `openingApplication` is safe to assert here and ONLY here: this
                // branch runs when isApplicationFormPage() said there is no form on
                // screen, so a button reading "Nộp hồ sơ" opens one rather than
                // sending one. (VN job boards use the same words for both.)
                safeActivate(applyBtn, policyCtx('gateway', { openingApplication: true }), null);
                showProgress(0, null, 'Đã click nút Ứng tuyển, chờ form...');
                await sleep(2000);
            } else {
                console.log('[Copo Apply] step0: no Apply button found — scanning current form');
                showProgress(0, null, 'Không tìm thấy nút Apply, scan form hiện tại...');
                await sleep(500);
            }
        }

        // Scroll to discover all fields
        await scrollAndCollect();

        let sameStateCount = 0;
        let emptyStreak = 0;   // consecutive empty/error observes → triggers a recovery reload
        let singlePageIdle = 0;     // single-page recipe: consecutive passes with nothing new to fill → hand off
        let singlePagePasses = 0;   // single-page recipe: total passes on the matched form → hard cap (never spin)

        const loopDeadline = Date.now() + AGENT_MAX_RUNTIME_MS;
        for (let i = 0; ; i++) {
            if (Date.now() > loopDeadline) {
                removeProgress();
                showToast('⚠️ Một job chạy quá 15 phút — dừng lại. Kiểm tra form rồi chạy tiếp.', 6000);
                reportResult(false, `Quá ${Math.round(AGENT_MAX_RUNTIME_MS / 60000)} phút cho một job — dừng để không treo phiên`);
                return;
            }
            // Keep the background watchdog alive — an iteration can legitimately
            // take minutes (LLM call + waits), the timer should only fire when
            // this page goes silent.
            sendHeartbeat();

            // ── 1. OBSERVE ──
            showProgress(i + 1, null, 'Đang phân tích trang...');
            const state = await observePageState();

            // ── TRACE: per-iteration snapshot of what the scanner sees — so it's
            // obvious whether the page has the fields and whether they're already
            // filled (recipe + LLM act on this). ──
            const _step = state.stepIndicator ? `${state.stepIndicator.current}/${state.stepIndicator.total}` : '?';
            console.log(`[Copo Apply] ══ iter ${i + 1} ══ …${location.pathname.slice(-42)} · step ${_step} · fields=${state.formFields.length} buttons=${state.buttons.length} errors=${state.errors.length} blockers=${state.blockers.length}`);
            if (state.formFields.length) {
                console.log('[Copo Apply]   fields:', state.formFields.map(f =>
                    `${(f.label || f.name || f.placeholder || f.ariaLabel || '?').trim().slice(0, 22)}[${f.componentType || f.type}${f.value ? '=✓' : ''}${f.required ? ',req' : ''}]`).join('   '));
            }
            if (state.errors.length) {
                console.warn('[Copo Apply] ⚠ validation errors:',
                    state.errors.map(e => `${e.field || e.nearFieldSelector || '?'} — ${e.message}`.slice(0, 90)).join('   |   '));
            }
            // The same snapshot into the trace. The console lines above scroll away
            // with the document on every navigation, so a run that ends three page
            // loads later leaves a dump that says what the agent DID and nothing
            // about what it was looking at — which is the half that explains it.
            trace('loop.iter', {
                n: i + 1,
                step: _step,
                fields: state.formFields.length,
                buttons: state.buttons.length,
                errors: state.errors.length,
                blockers: state.blockers.length,
                labels: state.formFields.slice(0, 8).map(f =>
                    `${(f.label || f.name || f.ariaLabel || '?').trim().slice(0, 18)}[${f.componentType || f.type}${f.value ? '=✓' : ''}${f.required ? ',req' : ''}]`).join(' '),
            });

            // ── DIAG: surface WHY a recipe'd ATS breaks ("Something went wrong").
            // From the isolated world we can't read fetch bodies, but Resource Timing
            // exposes request URLs — and the usual Workday cause (an undefined
            // application id) shows right in the CXS path. Fires only on the error
            // card or a bad CXS URL, so it's quiet on a healthy page.
            try {
                const _bt = document.body?.innerText || '';
                const _cxs = performance.getEntriesByType('resource').map(e => e.name)
                    .filter(u => /\/wday\/.*\/(jobapplication|package)\//.test(u));
                const _undef = _cxs.filter(u => /\/undefined(\/|$|\?)/.test(u));
                const _err = WORKDAY_ERROR_CARD_RE.test(_bt);
                if (_err || _undef.length) {
                    console.warn('[Copo Apply][DIAG]', _err ? 'ATS error card shown' : 'undefined-appId CXS call', {
                        url: location.href,
                        step: state.stepIndicator,
                        fields: state.formFields.length,
                        unfilledRequired: state.unfilledRequired,
                        badCxsUrls: _undef.slice(-8),
                        recentCxs: _cxs.slice(-8),
                        recentActions: history.slice(-6).map(h => ({ it: h.iteration, act: h.plan?.action, reason: h.plan?.reason, filled: h.result?.filled })),
                    });
                }
            } catch { /* diagnostics must never break the loop */ }

            // ── RECOVERY: reload a broken / empty page instead of giving up. A
            // recipe'd ATS often lands on Workday's "Something went wrong" (an
            // undefined appId after a mid-flow login) or a blank apply shell; both
            // self-heal on a fresh authenticated load (Workday literally says
            // "refresh"). The agent has no reload action otherwise, so it used to
            // stall here. Guarded via sessionStorage (survives the reload) so a page
            // that stays broken can't reload-loop forever.
            {
                const bt = document.body?.innerText || '';
                const errCard = WORKDAY_ERROR_CARD_RE.test(bt);
                // "Empty apply shell" = the form area never rendered (e.g. Workday paints
                // only its header + footer, blank body). The OLD check required
                // buttons.length===0, but the persistent header/footer chrome (Sign In,
                // Careers Page, social links) always leaves buttons > 0 — so a truly empty
                // form never reloaded. Detect it by the absence of ANY fillable form
                // content instead (and no recipe step on screen), ignoring nav buttons.
                const hasFormContent = !!document.querySelector(
                    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, '
                    + '[data-automation-id^="formField-"], [data-automation-id*="applyFlow"], [data-test^="personal-info"]');
                // A recipe STEP or a recipe GATEWAY on screen means this page is
                // doing its job, whatever the field count says.
                //
                // Gateways were missing from this test, and Workday's "Start Your
                // Application" modal is exactly the shape that trips the
                // empty-shell heuristic: three buttons, no inputs, no formField
                // wrappers. So the agent decided the page was broken and RELOADED
                // it — closing the modal it was supposed to click, twice, before
                // giving up with "Trang lỗi/rỗng".
                const recipeTargets = [
                    ...(recipe?.steps || []).map(s => s.detect),
                    ...(recipe?.gateways || []).map(g => g.detect),
                ].filter(Boolean);
                const recipeStepPresent = recipeTargets.some((sel) => {
                    try { return !!document.querySelector(sel); } catch { return false; }
                });
                // A JOB POSTING is not an empty shell. It legitimately has no form
                // fields — the form is behind its Apply button — and treating it as
                // a broken page made the agent RELOAD it: three page loads on one
                // URL inside twenty seconds, each reporting "trang rỗng" about a
                // page that was fine. The reload is for a genuinely blank or
                // wedged ATS page, so anything the agent could still act on
                // disqualifies it.
                const somethingToClick = (() => {
                    try { return !!findApplyButton(); } catch { return false; }
                })();
                const emptyShell = state.formFields.length === 0 && !hasFormContent
                    && !recipeStepPresent && !state.blockers.length && !somethingToClick;
                if (errCard || emptyShell) emptyStreak++; else emptyStreak = 0;
                // Error card → reload now; a bare empty shell → wait 2 observes first
                // (it may still be mid-bootstrap, not actually broken).
                const wantReload = errCard || emptyStreak >= 2;
                let reloads = 0;
                try { reloads = parseInt(sessionStorage.getItem('copoApplyReloads') || '0', 10) || 0; } catch { /* ignore */ }
                // Reload IS the recovery Workday itself prescribes for its error
                // card, and it keeps the session: measured twice on Mondelez, a
                // reload on "Something went wrong" came back signed in with the
                // draft intact and the flow advanced to the next step. (An earlier
                // run showed Create Account after a reload and looked like session
                // loss; the same URL rendered the signed-in flow moments later, so
                // that was a transient render, not a dropped session.)
                //
                // What must not happen is reloading INTO an auth wall and grinding
                // there, so past the login wall we allow one attempt, not two, and
                // the login-wall branch below stops the agent if we land on one.
                const pastAuthWall = !!tenantRefFor(location.href) && atsAuthDone;
                const reloadBudget = pastAuthWall ? 1 : 2;
                if (wantReload && reloads >= reloadBudget && pastAuthWall) {
                    console.warn('[Copo Apply] page error persists after reload — stopping '
                        + 'rather than looping on a broken ATS page');
                    removeProgress();
                    showToast('⚠️ Trang ứng tuyển báo lỗi hệ thống sau khi tải lại. '
                        + 'Hồ sơ đã điền vẫn còn — hãy thử lại trên tab này.', 9000);
                    reportResult(false, 'ATS page error persists after reload',
                        'blocked', { blockedReason: 'manual' });
                    return;
                }
                if (wantReload && reloads < reloadBudget) {
                    try { sessionStorage.setItem('copoApplyReloads', String(reloads + 1)); } catch { /* ignore */ }
                    console.warn(`[Copo Apply] recovery: ${errCard ? 'error card' : 'empty page'} → reload ${reloads + 1}/${reloadBudget}`, location.href);
                    showProgress(i + 1, null, 'Trang lỗi/rỗng — tải lại…');
                    await sleep(600);
                    location.reload();
                    return;   // the reload re-injects the agent on a fresh load
                }
            }

            // ── 2. CHECK TERMINATION ──
            if (baselineSignals === null) baselineSignals = new Set(state.completionSignals);
            const newSignals = state.completionSignals.filter(s => !baselineSignals.has(s));
            // Success = a NEW signal appeared after at least one real action. But a
            // recipe'd multi-step ATS (Workday…) never auto-submits — the agent hands
            // off at the review step — so a completion signal BEFORE the final step is
            // a false positive (e.g. "Successfully uploaded" on the Autofill-with-Resume
            // step reading as the whole application being done). Trust atFinalStep there.
            const midRecipeFlow = !!recipe?.finalStepSelector && !atFinalStep(recipe);

            // TWO independent signals are required before we claim an application
            // was sent, because the agent does not send one — so `submitted` can
            // only be the user submitting manually, or an ATS auto-submitting, and
            // in both cases the page changes structurally.
            //
            // One signal is not enough: "Successfully uploaded", "Information
            // saved" and "Profile updated" all match the success vocabulary and
            // all appear mid-flow. Reporting those as submitted writes "đã nộp"
            // into the user's history for an application still sitting half-filled
            // in an open tab — a false success, which is the failure mode that
            // costs the most to discover.
            if (state.formFields.length >= 3) sawForm = true;
            const formGone = sawForm && state.formFields.length === 0;
            const confirmationUrl = state.url !== startUrl
                && /thank|success|confirm|complete|submitted|hoan-?tat|thanh-?cong/i.test(state.url);
            const structuralSignal = formGone || confirmationUrl;

            if (newSignals.length > 0 && actionsTaken > 0 && !midRecipeFlow && !structuralSignal) {
                console.log('[Copo Apply] completion text seen but the form is still here — not calling this submitted:',
                    newSignals[0]);
            }
            if (newSignals.length > 0 && actionsTaken > 0 && !midRecipeFlow && structuralSignal) {
                showProgress(i + 1, null, 'Phát hiện ứng tuyển thành công!');
                removeProgress();
                reportResult(true,
                    `Submitted: "${newSignals[0]}" + ${formGone ? 'form gone' : 'confirmation URL'}`,
                    'submitted');
                showConfirmation(state.totalFields, state.totalFields, true);
                return;
            }

            // ── NEVER AUTO-SUBMIT: stop at the ATS's final review step and hand off.
            // Workday's review "Submit" reuses pageFooterNextButton, so an overlay-aware
            // Next click would otherwise send the application. Fill up to here only.
            if (recipe && atFinalStep(recipe)) {
                removeProgress();
                showToast('✅ Đã điền xong tới bước cuối — kiểm tra rồi bấm "Submit" để nộp.', 7000);
                reportResult(true, 'Reached review step — filled, awaiting user submit', 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                showConfirmation(state.totalFields, state.totalFields, false);
                return;
            }

            // ── RECIPE GATEWAY: click through a non-form gateway (Workday's "Start
            // Your Application" modal, whose options are <a role="button"> the generic
            // scan misses) to reach the form. Before login/fill; capped so it can't loop.
            if (recipe) {
                let gw = clickRecipeGateway(recipe, hasCV, gatewayClicks);
                if (gw.clicked) {
                    actionsTaken++;
                    showProgress(i + 1, null, `Tiếp tục: ${gw.label}`);
                    trace('gateway.click', { label: gw.label, chained: 0 });
                    // A gateway usually OPENS the next gateway — "Apply" raises the
                    // "Start Your Application" modal, whose own option is the thing
                    // that actually reaches the form. Take it in the SAME pass while
                    // it is on screen, instead of dropping out to a full re-observe
                    // and hoping the modal survives the round trip. It often did not:
                    // anything that pressed Escape in between dismissed it, and the
                    // agent then reported a modal that was no longer there.
                    for (let chain = 1; chain <= 2; chain++) {
                        await sleep(900);
                        gw = clickRecipeGateway(recipe, hasCV, gatewayClicks);
                        if (!gw.clicked) break;
                        actionsTaken++;
                        trace('gateway.click', { label: gw.label, chained: chain });
                        showProgress(i + 1, null, `Tiếp tục: ${gw.label}`);
                    }
                    await sleep(1200);
                    continue; // re-observe the screen the gateway led to
                }
            }

            // ── Login / sign-up wall: sign in with the user's synced credentials
            // (Workday & friends gate the form behind an account). Do this BEFORE
            // the LLM plan — the planner refuses password fields by design. On
            // submit the page navigates and the redirect-resume re-injects us on
            // the real form. Guarded to a genuine login/signup page inside
            // handleLoginWall, so it no-ops on a normal application form.
            //
            // Gated on tenantRefFor: candidate accounts only exist for vendors we
            // actually support (Workday today). detectLoginWall is deliberately
            // vendor-agnostic — a password box + "sign in" wording matches iCIMS,
            // Taleo, or an inline account step at the END of a normal form. Without
            // this gate the agent asked the background for a credential it could
            // never resolve and closed out the whole job as 'blocked' with the
            // self-contradicting "Trang này không cần tài khoản". Anywhere else the
            // wall stays a state.blockers entry and the planner keeps filling the
            // fields it CAN reach, which is the documented policy.
            // Why the auth branch is or is not entered, recorded either way. A run
            // that never tried to log in left a trace with no auth step at all —
            // indistinguishable from one where the branch was never reached, and
            // that difference is the whole diagnosis. The checks are cheap; the
            // ambiguity cost a round trip.
            const _tenant = tenantRefFor(location.href);
            const _wall = (_tenant && !atsAuthDone) ? detectLoginWall(recipe?.login) : null;
            if (_tenant && !atsAuthDone && !_wall) {
                const pw = [...document.querySelectorAll('input[type="password"]')];
                // Once per page, not once per iteration: the loop re-asks every
                // pass and the answer only changes on navigation.
                traceOnce(`auth.skip:${location.pathname}`, 'auth.skip', {
                    why: 'no login wall detected',
                    tenant: _tenant.tenantKey,
                    pwTotal: pw.length,
                    pwVisible: pw.filter(e => e.offsetParent !== null).length,
                    bodyHead: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
                });
            } else if (_tenant && atsAuthDone) {
                traceOnce(`auth.done:${location.pathname}`, 'auth.skip',
                    { why: 'already authenticated this page-load', tenant: _tenant.tenantKey });
            }

            if (!atsAuthDone && _tenant && _wall) {
                // Let the form finish rendering BEFORE asking for a credential.
                // The grant spends the tenant's attempt, so asking for one we
                // cannot use is how a tenant runs out of logins without the ATS
                // ever seeing a submission.
                trace('auth.wall', {
                    tenant: tenantRefFor(location.href)?.tenantKey,
                    passwordFields: document.querySelectorAll('input[type="password"]').length,
                    iteration: i + 1,
                });
                const ready = await waitForLoginFormReady(recipe?.login);
                if (!ready) {
                    trace('auth.notReady', { waitedMs: 8000, action: 'retry next iteration' });
                    await sleep(1000);
                    continue;
                }

                // Ask the background for this tenant's credential + which operation
                // it's allowed to run (signup for a tenant we've never authenticated
                // at, login for one we have). It owns the attempt budget, because a
                // content script dies on every navigation and can't count.
                const grant = await requestAtsAuth();
                trace('auth.grant', {
                    ok: !!grant?.ok,
                    operation: grant?.operation,
                    reason: grant?.reason,
                    detail: grant?.detail,
                    email: grant?.credentials?.email,
                });

                if (!grant?.ok) {
                    // No credential we can use, or the budget is spent. Don't sit on
                    // a wall for three minutes — hand the tenant back so the batch
                    // moves on and the user gets one actionable row.
                    removeProgress();
                    reportResult(false, grant?.detail || 'Cần tài khoản để ứng tuyển',
                        'blocked', { blockedReason: grant?.reason || 'manual' });
                    return;
                }

                showProgress(i + 1, null,
                    grant.operation === 'signup' ? 'Tạo tài khoản…' : 'Đăng nhập…');

                let result = await handleLoginWall(grant.credentials, recipe?.login, grant.operation);
                trace('auth.attempt', { pass: 1, outcome: result?.outcome, pending: result?.pending, result: result === null ? 'null' : undefined });
                // A form switch (sign-in ⇄ create account) isn't an attempt; run the
                // real one on the form we asked for.
                if (result?.pending) {
                    await sleep(1200);
                    result = await handleLoginWall(grant.credentials, recipe?.login, grant.operation);
                    trace('auth.attempt', { pass: 2, outcome: result?.outcome, result: result === null ? 'null' : undefined });
                }

                // Null means handleLoginWall found no wall to act on — it went away
                // between the check above and the fill, or was never really there.
                // Nothing was typed and nothing was submitted, so this is NOT an
                // attempt: give it back and let the loop look again. Treating it as
                // a verdict is what used to end the job on a page that had simply
                // not finished loading, and leave the tenant with no logins left.
                if (!result) {
                    await abandonAtsAuth(grant.operation, 'no login form to act on');
                    trace('auth.refund', { operation: grant.operation, why: 'handleLoginWall returned null' });
                    await sleep(1200);
                    continue;
                }
                actionsTaken++;

                // Report the verdict; the background persists it, so every remaining
                // job on this tenant inherits it instead of re-probing.
                const verdict = await reportAtsAuth(result);
                trace('auth.verdict', {
                    outcome: result.outcome, source: result.source, sourceCode: result.sourceCode,
                    state: verdict?.state, blocked: verdict?.reason,
                });
                atsAuthDone = true;

                if (result?.outcome === 'success') {
                    showToast('✅ Đã đăng nhập — tiếp tục điền hồ sơ...', 3000);
                    prevStateHash = ''; fillAttempts.clear(); persistentlyUnfilled.clear();
                    await sleep(1500);
                    continue;                       // resume on the post-login step
                }
                if (result?.outcome === 'account_exists') {
                    // Expected on signup-first: the account is already there, so sign
                    // in instead. This is the second (and last) allowed operation.
                    atsAuthDone = false;
                    await sleep(1000);
                    continue;
                }
                // Anything else needs the user (verify an email, supply a different
                // password, solve a challenge). Close out cleanly — the verify wall
                // sits BEFORE the form, so there is no progress worth preserving and
                // no reason to keep a tab parked.
                removeProgress();
                reportResult(false, ATS_BLOCK_DETAIL[verdict?.reason || 'manual'],
                    'blocked', { blockedReason: verdict?.reason || 'manual' });
                return;
            }

            // ── NEEDS PASS: scan the form FIRST, then decide what data to pull ──
            //
            // Runs ahead of the recipe on purpose. A recipe is a per-ATS list of
            // selectors with requiredness baked in, and requiredness is per-TENANT:
            // "How Did You Hear About Us?" is a button at 3M and a search box at
            // Mondelez, My Experience wants one field at one company and six at the
            // next. Anything derived from that list is wrong somewhere by
            // construction.
            //
            // So the page decides what is needed, and the recipe that follows only
            // contributes exact selectors for controls whose labels are ambiguous,
            // plus the step/advance structure. Filling is idempotent, so whatever
            // this pass already answered the recipe simply skips.
            //
            // One pass replaces what used to be three disconnected ones: the
            // recipe bound selectors to values, a rule table answered screening
            // questions, and nothing at all checked what the ATS had already
            // filled. That last gap is the expensive one — the recipe treats any
            // non-empty value as finished, so a parser that read the job title as
            // "Consultant" when the CV says "Product Owner" was left standing.
            {
                const manifest = buildManifest(state.formFields, { profile, cv: cvStructured });

                // The candidate's own data wins. A mismatch the pipeline can
                // correct unambiguously IS corrected; one it cannot (a repeated
                // concept, a committed dropdown) is reported instead, because
                // there the risk is not our data but our aim.
                const correctable = new Set(manifest.override.map(o => o.selector));
                for (const v of manifest.verify) {
                    if (v.verdict !== VERDICT.MISMATCH) continue;
                    const willFix = correctable.has(v.selector);
                    reviewAnswers.set(`mismatch::${v.label}`, {
                        field: v.label, value: willFix ? v.expected : v.actual,
                        source: willFix ? 'CORRECTED' : 'ATS_PARSED',
                        expected: v.expected, wasParsedAs: v.actual, verdict: v.verdict,
                    });
                    console.warn(`[Copo Needs] ${willFix ? '✎ correcting' : '⚠ flagged'} ${v.label}: `
                        + `form "${String(v.actual).slice(0, 28)}" vs CV "${String(v.expected).slice(0, 28)}"`);
                }

                if (manifest.gaps.length) {
                    const g = summarizeGaps(manifest);
                    console.log('[Copo Needs] gaps →', JSON.stringify({ userOnly: g.userOnly, inferable: g.inferable }));
                }

                // Corrections go out with the fills, in the same pass.
                let todo = [...manifest.override, ...manifest.fill];
                // Ownership: needs RESOLVES answers, but a field the active recipe
                // step covers is the recipe's to EXECUTE — its widget knowledge is
                // what commits a value (a generic fill typed free text into the
                // "How Did You Hear" prompt: looked answered, committed nothing).
                // Fields the recipe has RELEASED (FAIL/absent — stale selector,
                // different tenant shape, exhausted strategies) fall through to
                // needs, so the fallback flexibility is kept.
                if (recipe && todo.length) {
                    const owned = recipeOwnedWrappers(recipe);
                    if (owned.size) {
                        const deferred = [];
                        todo = todo.filter(a => {
                            const el = document.querySelector(a.selector);
                            const wrap = el?.closest?.('[data-automation-id^="formField-"]');
                            const label = wrap ? owned.get(wrap) : null;
                            if (!label || recipeReleased(label)) return true;
                            deferred.push(`${a.label}→${label}`);
                            return false;
                        });
                        if (deferred.length) {
                            console.log('[Copo Needs] recipe-owned, deferring to the recipe:', deferred.join(' · '));
                        }
                    }
                }
                // The starvation fuse: two tries per control per page. A fill
                // that took would read as answered next pass and never re-arm;
                // one that keeps re-arming is not going to work a third time,
                // and its `continue` was costing every pass the recipe.
                todo = todo.filter(a => (needsAttempts.get(a.selector) || 0) < 2);
                if (todo.length) {
                    for (const a of todo) needsAttempts.set(a.selector, (needsAttempts.get(a.selector) || 0) + 1);
                    console.log('[Copo Needs] applying:', todo.map(a => `${a.label}=${String(a.value).slice(0, 20)}[${a.source}]`).join(' · '));
                    showProgress(i + 1, null,
                        manifest.override.length
                            ? `Sửa ${manifest.override.length} trường lệch + điền ${manifest.fill.length}…`
                            : `Điền ${manifest.fill.length} trường từ hồ sơ…`);
                    const instructions = todo.map(a => ({
                        selector: a.selector,
                        action: a.componentType === 'radio-group' ? 'radio'
                            : a.componentType === 'checkbox' ? 'checkbox'
                            : a.componentType === 'native-select' ? 'select'
                            : (a.componentType && a.componentType !== 'native') ? 'custom-select' : 'fill',
                        value: a.value, componentType: a.componentType, fieldLabel: a.label,
                    }));
                    for (const a of manifest.fill) {
                        reviewAnswers.set(`answer::${a.label}`, { field: a.label, value: a.value, source: a.source });
                    }
                    // Remember what this page asked for that stored data could not
                    // answer, so the app can collect it ONCE instead of stalling at
                    // every company that asks.
                    for (const g of manifest.gaps) {
                        fieldGaps.set(g.key || g.label, { key: g.key, label: g.label, userOnly: g.userOnly });
                    }
                    const n = await executeFillInstructions(instructions, cvData, policyCtx('recipe'));
                    if (n > 0) {
                        actionsTaken++;
                        history.push({ iteration: i, plan: { action: 'NEEDS', reason: 'deterministic field resolution' }, result: { filled: n } });
                        await sleep(600);
                        continue;   // re-observe before spending an LLM call
                    }
                }

                // ── FREE-ANSWER screening selects (user-approved 2026-08-02).
                // A required dropdown nothing stored answers is no longer a user
                // gap by default: the model reads the CV/profile and picks from
                // the options the WIDGET actually offers — "years of experience
                // in X?" has its answer in the CV, and stalling on it was pure
                // friction. Selects only (a model may choose, never type);
                // recipe-owned fields stay with the recipe until released;
                // demographic/consent never reach the gap list at all.
                const openSelects = (manifest.gaps || [])
                    .filter(g => ['custom-dropdown', 'native-select', 'radio-group'].includes(g.componentType) && !g.userOnly);
                if (openSelects.length) {
                    const owned = recipe ? recipeOwnedWrappers(recipe) : new Map();
                    let inferred = 0;
                    for (const g of openSelects.slice(0, 4)) {
                        const el = document.querySelector(g.selector);
                        const wrap = el?.closest?.('[data-automation-id^="formField-"]');
                        const ownerLabel = wrap ? owned.get(wrap) : null;
                        if (ownerLabel && !recipeReleased(ownerLabel)) continue;
                        const r = await inferFillDynamicField(g, profile, cvStructured);
                        trace('gap.inferFill', { label: String(g.label || '').slice(0, 50), ok: !!r.ok, matched: r.matched || null, why: r.reason || null });
                        if (r.ok) {
                            inferred++;
                            reviewAnswers.set(`answer::${g.label}`, { field: g.label, value: r.matched, source: 'AGENT_DEFAULT' });
                        }
                    }
                    if (inferred > 0) {
                        actionsTaken++;
                        history.push({ iteration: i, plan: { action: 'NEEDS', reason: 'model picked from on-widget options' }, result: { filled: inferred } });
                        await sleep(600);
                        continue;   // re-observe with the new answers committed
                    }
                }
            }

            // ── RECIPE PRE-FILL: for a known ATS (Workday…), fill the standardized
            // text fields with exact verified selectors BEFORE the LLM plans. It's
            // idempotent (skips already-filled inputs) so it goes quiet once the
            // step is done; when it fills something new we re-observe so the LLM
            // sees the pre-filled state and only handles the rest (dropdowns, Next).
            if (recipe) {
                const rf = await applyRecipeFields(recipe, profile, cvData, cvStructured);
                for (const a of rf.answers || []) {
                    reviewAnswers.set(`${rf.step || '?'}::${a.field}`, { ...a, step: rf.step });
                }
                console.log(`[Copo Apply] recipe(${recipe.ats} v${recipe.version}): ${rf.matched ? `step="${rf.step || '—'}" filled=${rf.filled}` : 'no step matched → LLM handles'}`);
                // Single-page hard cap: even if a field won't stick and we keep
                // re-filling it (rf.filled>0 every pass), never spin forever — hand off
                // after N passes on the form for the user to finish + submit.
                if (recipe.singlePage && rf.matched) {
                    singlePagePasses++;
                    if (singlePagePasses > 6) {
                        removeProgress();
                        const miss = (state.unfilledRequired || []).slice(0, 4).join(', ');
                        showToast(`✅ Đã điền hồ sơ${miss ? ` — kiểm tra lại: ${miss}` : ''}. Tích ô đồng ý điều khoản rồi bấm "Submit" để nộp.`, 10000);
                        reportResult(true, `${recipe.label} filled (pass cap) — awaiting user consent + submit`, 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                        showConfirmation(state.totalFields, state.totalFields, false);
                        return;
                    }
                }
                if (rf.filled > 0) {
                    actionsTaken++;
                    history.push({
                        iteration: i,
                        plan: { action: 'RECIPE', reason: `recipe ${recipe.ats}/${rf.step}` },
                        result: { filled: rf.filled },
                    });
                    if (recipe.singlePage) singlePageIdle = 0;   // progress made → reset idle
                    showProgress(i + 1, null,
                        rf.uploadedParser ? '📄 Đã tải CV — chờ hệ thống tự điền hồ sơ…'
                            : `Điền tự động (${recipe.label}) — ${rf.filled} trường`);
                    // After uploading the CV to SR's parser, WAIT ~5s so it finishes
                    // populating the whole form (personal info + experience + education)
                    // before we touch anything — filling DURING the parse makes SR
                    // discard it. Otherwise just a short re-scan delay.
                    await sleep(rf.uploadedParser ? 5000 : (recipe.singlePage ? 1600 : 600));
                    continue;
                }
                // ── SINGLE-PAGE FORM (SmartRecruiters): one page, no wizard. The flow
                // is: upload the CV to the parser field (done in applyRecipeFields) →
                // SR auto-fills most fields + attaches the résumé → we fill any still-
                // empty fields → hand off. The LLM CAN'T reach SR's shadow-DOM inputs,
                // so we must NOT fall through to the planner here — that just spins on
                // an unchanging state until the stuck-detector fires. Instead wait a
                // couple STABLE passes (rf.filled===0, letting the async parser finish)
                // then hand off for the user to review + tick consent + Submit. Never
                // auto-submit, never auto-tick consent.
                if (recipe.singlePage) {
                    if (rf.matched) {
                        singlePageIdle++;
                        if (singlePageIdle < 2) {
                            showProgress(i + 1, null, 'Rà soát & điền các ô còn trống…');
                            await sleep(1600);
                            continue;   // give the parser another pass, then re-scan
                        }
                        removeProgress();
                        const miss = (state.unfilledRequired || []).slice(0, 4).join(', ');
                        showToast(`✅ Đã điền hồ sơ${miss ? ` — kiểm tra lại: ${miss}` : ''}. Tích ô đồng ý điều khoản rồi bấm "Submit" để nộp.`, 10000);
                        reportResult(true, `${recipe.label} filled — awaiting user consent + submit`, 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                        showConfirmation(state.totalFields, state.totalFields, false);
                        return;
                    }
                    // Host matches but the form isn't on screen yet — wait for it to
                    // render (or for the "I'm interested" gateway to land us on it)
                    // rather than handing the empty page to the LLM.
                    showProgress(i + 1, null, 'Chờ form ứng tuyển…');
                    await sleep(1500);
                    continue;
                }
                // A wizard page that has not rendered yet is not a page to plan
                // against. The comment two branches up says exactly this — "rather
                // than handing the empty page to the LLM" — but that guard sat
                // inside `if (recipe.singlePage)`, so it only ever protected
                // SmartRecruiters. On Workday an empty Create Account/Sign In step
                // went straight to the planner, which correctly reported that there
                // was nothing to fill and no credentials in the profile, and
                // NEED_HUMAN ended the run. One iteration later the password fields
                // exist and the login flow handles it — measured: pwTotal 0 on pass
                // 1, five fields on pass 2.
                if (!rf.matched && state.formFields.length === 0 && emptyPageWaits < 4) {
                    emptyPageWaits++;
                    trace('page.settling', {
                        pass: emptyPageWaits,
                        buttons: state.buttons.length,
                        step: state.stepIndicator
                            ? `${state.stepIndicator.current}/${state.stepIndicator.total}` : null,
                    });
                    showProgress(i + 1, null, 'Chờ form ứng tuyển…');
                    await sleep(1500);
                    continue;
                }

                // Recipe step fully filled (nothing new this pass) + nothing required
                // left → ADVANCE deterministically instead of burning a slow/overloaded
                // LLM call just to click "Save and Continue". Close a leftover dropdown
                // popup first (it overlays the footer + eats the click).
                // Why the deterministic advance did or did not fire. Every term
                // here has stalled a run at least once — an unmatched step means no
                // `advance` selector, one unfilled required field withholds the
                // click entirely, and a false-positive final step denies it. From
                // outside all three look identical: the page simply does not move.
                const _stepNow = (recipe.steps || []).find(s => s.detect && document.querySelector(s.detect));
                const _adv = _stepNow?.advance ? document.querySelector(_stepNow.advance) : null;
                // A step may name a precondition for leaving it. The résumé-upload
                // page does: advancing before the file attaches skips the parse the
                // step exists for. Only enforced when we actually have a CV — a
                // text-only apply must not deadlock waiting for an upload that was
                // never going to happen.
                const _waitingFor = (_stepNow?.advanceWhen && hasCV
                    && !document.querySelector(_stepNow.advanceWhen)) ? _stepNow.advanceWhen : null;
                trace('advance.check', {
                    recipeMatched: rf.matched,
                    step: _stepNow?.name || _stepNow?.detect || null,
                    unfilledRequired: state.unfilledRequired.length,
                    // Full names + component type, not counts — "unfilledRequired=3"
                    // cost a debug session that "Work To Month | …" answers, and
                    // "? [file-upload]" names a phantom blocker instantly.
                    unfilledLabels: state.unfilledRequired.slice(0, 6).map(f =>
                        `${(f.label || f.placeholder || f.selector || '?').slice(0, 40)}${f.componentType ? ` [${f.componentType}]` : ''}`).join(' | '),
                    errors: state.errors.length,
                    errorDetail: state.errors.slice(0, 4).map(e => `${e.field || '?'}: ${String(e.message || '').slice(0, 40)}`).join(' | '),
                    atFinalStep: atFinalStep(recipe),
                    advSelector: _stepNow?.advance || null,
                    advFound: !!_adv,
                    advVisible: !!(_adv && _adv.offsetParent !== null),
                    advLabel: _adv ? (_adv.textContent || '').trim().slice(0, 28) : null,
                    waitingFor: _waitingFor,
                });
                // Waiting on a precondition is NOT a page to plan against. The
                // résumé-upload step withholds its Continue until the file
                // attaches, and execution then fell straight through to the
                // planner — which sees a page with no fields, reports that it
                // cannot proceed, and ends the run. The same empty-page failure as
                // before, reached down a different branch.
                if (_waitingFor && preconditionWaits < 8) {
                    preconditionWaits++;
                    trace('advance.waiting', {
                        step: _stepNow?.name || null,
                        pass: preconditionWaits,
                        selector: _waitingFor,
                        filledThisPass: rf.filled,
                    });
                    showProgress(i + 1, null, 'Chờ đính kèm CV…');
                    await sleep(1500);
                    continue;
                }
                if (rf.matched && !_waitingFor && state.unfilledRequired.length === 0
                    && state.errors.length === 0 && !atFinalStep(recipe)) {
                    const stepNow = _stepNow;
                    const adv = _adv;
                    if (adv && adv.offsetParent !== null) {
                        // Only a real open listbox, and never when the modal is the
                        // topmost layer — Escape would dismiss the step instead.
                        if (closeOpenDropdown()) await sleep(250);
                        console.log(`[Copo Apply] recipe advance → ${stepNow.advance}`);
                        // The surrounding condition already excludes the review
                        // step; the policy re-checks it anyway, because on Workday
                        // this same selector IS the submit button there.
                        // A refused advance is not progress. Incrementing
                        // `actionsTaken` anyway told the completion check that we
                        // had acted, and let the loop continue as if the step had
                        // moved on.
                        const advanced = safeActivate(adv, policyCtx('recipe'), stepNow.advance);
                        trace('advance.click', { selector: stepNow.advance, activated: advanced });
                        if (!advanced) {
                            removeProgress();
                            showToast('✅ Đã điền xong — kiểm tra rồi tự bấm nộp để hoàn tất.', 8000);
                            reportResult(true, 'Policy stopped the step advance — awaiting user submit', 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                            showConfirmation(state.totalFields, state.totalFields, false);
                            return;
                        }
                        actionsTaken++;
                        await sleep(1500);
                        continue;
                    }
                }
            }

            // ── GENERIC ADVANCE (hybrid): tenants reshape Workday's steps, and a
            // page no recipe step recognises still has to MOVE once complete —
            // before this, only the planner could click Next there, so an
            // unknown page shape on an unreachable planner ended the run.
            // pageFooterNextButton is Workday PLATFORM chrome (tenant-neutral);
            // the text scan covers other ATSes. The policy layer judges the
            // click as always (submit labels refused), and a visible review
            // page is never advanced generically.
            {
                const insideApply = !!state.stepIndicator || /\/apply(\/|$)/.test(location.pathname);
                const stepMatched = !!(recipe && (recipe.steps || []).find(s => s.detect && document.querySelector(s.detect)));
                const onReview = (recipe && atFinalStep(recipe))
                    || !!document.querySelector('[data-automation-id="applyFlowReviewPage"]');
                if (insideApply && !stepMatched && !onReview
                    && state.unfilledRequired.length === 0 && state.errors.length === 0
                    && state.formFields.length > 0) {
                    const adv = document.querySelector('[data-automation-id="pageFooterNextButton"]')
                        || [...document.querySelectorAll('button, [role="button"]')]
                            .filter(b => b.offsetParent !== null)
                            .find(b => /^(save and continue|continue|next|tiếp tục|lưu và tiếp tục)$/i.test((b.textContent || '').replace(/\s+/g, ' ').trim()));
                    if (adv && adv.offsetParent !== null) {
                        if (closeOpenDropdown()) await sleep(250);
                        const okAdv = safeActivate(adv, policyCtx('recipe'), '[generic-advance]');
                        trace('advance.generic', { label: (adv.textContent || '').trim().slice(0, 28), activated: okAdv });
                        if (okAdv) { actionsTaken++; await sleep(1500); continue; }
                    }
                }
            }

            // Blockers (captcha, login wall) are reported to the LLM via state.blockers
            // (see line 1138). Don't bail here — let the LLM keep filling non-blocker
            // fields and decide NEED_HUMAN itself only when there's nothing left to fill.

            // Step changed (multi-step wizard advanced) or URL changed → reset
            // stuck-detection state so a fresh page doesn't trip false positives.
            const curStep = state.stepIndicator?.current ?? null;
            if (curStep !== prevStepCurrent || state.url !== prevUrl) {
                prevStateHash = '';
                fillAttempts.clear();
                persistentlyUnfilled.clear();
                fieldRecovery.clear();
                needsAttempts.clear();
                errorStreak.clear();
                prevStepCurrent = curStep;
                prevUrl = state.url;
                // A new page gets its own grace to render. Without this the budget
                // is spent by whichever step happened to be slow first, and every
                // later step is planned against before it exists.
                emptyPageWaits = 0;
                preconditionWaits = 0;
            }

            // Detect fields the LLM previously tried to fill but stayed empty.
            // Pass these back so the LLM can try a different strategy or escalate.
            for (const [selector, attempt] of fillAttempts) {
                const field = state.formFields.find(f => f.selector === selector);
                if (!field) continue;
                const stillEmpty = !field.value || String(field.value).trim() === '';
                if (stillEmpty && attempt.count >= FILL_RETRY_THRESHOLD) {
                    persistentlyUnfilled.add(selector);
                }
            }
            state.persistentlyUnfilled = [...persistentlyUnfilled];

            // No fields and no actionable buttons
            if (state.formFields.length === 0 && state.buttons.length === 0) {
                // Retry once — form might still be loading
                await sleep(2000);
                const retry = await observePageState();
                if (retry.formFields.length === 0) {
                    removeProgress();
                    showToast('❌ Không tìm thấy form ứng tuyển trên trang này.', 5000);
                    reportResult(false, 'No form found');
                    return;
                }
            }

            // Stuck detection: same state 3 times
            const stateHash = JSON.stringify(summarizeState(state));
            if (stateHash === prevStateHash) {
                sameStateCount++;
                if (sameStateCount >= 3) {
                    // Don't just give up "stuck" — audit WHY the step won't advance
                    // (which required fields are still empty / what validation errors
                    // are shown) so the user (and the log) knows what to complete.
                    const blockers = auditRequiredBlockers();
                    const miss = blockers.slice(0, 6).map(b => b.kind === 'error' ? b.label : `${b.label} (${b.kind})`).join(', ');
                    console.warn('[Copo Apply] STUCK — required blockers:', blockers.length ? blockers : '(none detected — likely a captcha / login / unknown widget)');
                    removeProgress();
                    showToast(miss
                        ? `⚠️ Không qua được bước này — còn thiếu: ${miss}. Điền nốt rồi bấm tiếp.`
                        : '⚠️ Agent dừng — không xác định được ô còn thiếu. Vui lòng điền thủ công.', 9000);
                    reportResult(false, `Stuck — blockers: ${miss || 'unknown'}`);
                    return;
                }
            } else {
                sameStateCount = 0;
                prevStateHash = stateHash;
            }

            // ── ERROR-PERSISTENCE BREAKER: the loop must READ its errors, not
            // outlast them. An error that survives four straight iterations of
            // needs + recipe + recovery + planner is not going to yield to a
            // fifth — the VALUE is wrong for this tenant's rule ("Postal code
            // must be 5 digits" outlived 24 rounds), and the only useful move
            // is to stop and name it for the user.
            {
                const keyOf = (e) => `${String(e.field || '').toLowerCase()}|${String(e.message || '').toLowerCase()}`.slice(0, 140);
                const nowKeys = new Set(state.errors.map(keyOf));
                for (const k of nowKeys) errorStreak.set(k, (errorStreak.get(k) || 0) + 1);
                for (const k of [...errorStreak.keys()]) if (!nowKeys.has(k)) errorStreak.delete(k);
                const stubborn = state.errors.find(e => (errorStreak.get(keyOf(e)) || 0) >= 4);
                if (stubborn) {
                    const msg = `${stubborn.field ? stubborn.field + ': ' : ''}${(stubborn.message || '').slice(0, 140)}`;
                    trace('error.stubborn', { error: msg, iterations: errorStreak.get(keyOf(stubborn)) });
                    removeProgress();
                    showToast(`⚠️ Form từ chối giá trị hiện tại — cần bạn sửa dữ liệu: ${msg}`, 10000);
                    reportResult(false, `Need human: form keeps rejecting the value — ${msg}`,
                        'blocked', { blockedReason: 'manual', review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                    return;
                }
            }

            // ── Deterministic recovery: a validation error on a RECIPE-OWNED
            // field is the recipe's to fix. Re-running its pass costs seconds; a
            // planner call costs ~25s and resolves the same field with less
            // widget knowledge (measured: ten planner calls against one stuck
            // "How Did You Hear"). Per-field, the evidence decides:
            //   no commit + error → FALSE_DONE — retry the recipe (its entry
            //                       guards clear any uncommitted rubble first)
            //   commit + error    → the error may simply be stale: settle the
            //                       widget (close popup, blur), let the form
            //                       revalidate, and only a SURVIVING error next
            //                       pass counts as real
            // Budget 2 retries per field; exhausted or unmapped errors fall
            // through to the planner as before.
            if (recipe && state.errors.length) {
                const normL = (s) => String(s || '').toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();
                const owned = recipeOwnedWrappers(recipe);
                const entries = [...owned.entries()];
                const mapped = state.errors.map(e => {
                    // Field AND message: a summary entry arrives as field="Page
                    // Error" with the real subject only in the text ("Enter a
                    // postal code in the valid format…").
                    const en = normL(`${e.field || ''} ${e.message || ''}`);
                    const hit = entries.find(([w, label]) => {
                        // The recipe's short name rarely matches the page's long
                        // question ("Salary expectations" vs "What is your
                        // expected monthly salary range?") — the wrapper's OWN
                        // legend is the page's wording, so compare both.
                        const ln = normL(label);
                        const pageLbl = normL(w?.querySelector?.('legend, label')?.textContent);
                        return (ln && en && (en.includes(ln) || ln.includes(en)))
                            || (pageLbl && en && (en.includes(pageLbl) || pageLbl.includes(en)));
                    });
                    return hit ? { wrap: hit[0], label: hit[1] } : null;
                }).filter(Boolean);
                const retryable = mapped.filter(m => (fieldRecovery.get(m.label) || 0) < 2);
                if (retryable.length) {
                    for (const m of retryable) fieldRecovery.set(m.label, (fieldRecovery.get(m.label) || 0) + 1);
                    const hasCommit = (wrap) => {
                        const chipList = wrap?.querySelector?.('[data-automation-id="selectedItemList"]');
                        if (chipList && chipList.children.length) return true;
                        return !!(wrap?.querySelector?.('button')?.getAttribute('value') || '').trim();
                    };
                    const revalidate = retryable.filter(m => hasCommit(m.wrap));
                    if (revalidate.length) {
                        if (closeOpenDropdown()) await sleep(200);
                        try { document.activeElement?.blur?.(); } catch { /* noop */ }
                    }
                    // Attempt #2 on a persisting error: the committed VALUE is
                    // what the form rejects, and a summary-only error ("Page
                    // Error: postal code…") never reaches the wrapper — so the
                    // field's own value+no-error guard keeps reading it as
                    // done. Clear it; the next recipe pass re-enters fresh.
                    for (const m of retryable) {
                        if ((fieldRecovery.get(m.label) || 0) >= 2) {
                            const inp = m.wrap?.querySelector?.('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
                            const was = inp ? String(inp.value || '').trim() : '';
                            if (inp && was) {
                                setNativeValue(inp, '', { quiet: true });
                                trace('recover.cleared', { field: m.label, was: was.slice(0, 20) });
                            }
                        }
                    }
                    console.log(`[Copo Apply] recovery: ${retryable.length} error(s) on recipe fields — `
                        + retryable.map(m => `${m.label}:${revalidate.includes(m) ? 'revalidate' : 'retry'}`).join(', ')
                        + ' — skipping planner');
                    trace('recover.recipe', {
                        fields: retryable.map(m => `${m.label}#${fieldRecovery.get(m.label)}`).join(' | '),
                        revalidating: revalidate.length,
                        errors: state.errors.length,
                    });
                    await sleep(800);
                    continue;
                }
            }

            // ── 3. PLAN: Ask LLM what to do next ──
            //
            // One guard at the choke point, because guarding each branch has not
            // held: a zero-field page has now reached the planner three separate
            // ways — an unrendered wizard step, a step whose Continue was withheld
            // pending the CV upload, and the original Create Account page. Every
            // time, the planner correctly reports it cannot proceed, NEED_HUMAN
            // ends the run, and the next branch to leak is found the same way.
            //
            // On a host with a recipe, no fields means the page is not ready, not
            // that the application is unanswerable. Wait here rather than asking.
            // Only INSIDE the apply flow. A job posting has no form fields by
            // design and the planner's job there is to click through to the form,
            // so waiting for fields that will never appear on that page just
            // burns iterations. The wizard's step indicator is the discriminator:
            // measured, a job page reports none and every apply step reports one.
            const insideApplyFlow = !!state.stepIndicator || /\/apply(\/|$)/.test(location.pathname);
            if (recipe && insideApplyFlow && state.formFields.length === 0 && emptyPageWaits < 6) {
                emptyPageWaits++;
                trace('plan.skipped', {
                    reason: 'no form fields to plan against',
                    pass: emptyPageWaits,
                    buttons: state.buttons.length,
                });
                await sleep(1500);
                continue;
            }
            showProgress(i + 1, null, `AI đang lên kế hoạch (iteration ${i + 1})...`);

            let plan;
            const _planT0 = Date.now();
            console.log(`[Copo Apply] → LLM plan request (fields=${state.formFields.length}, unfilledRequired=${state.unfilledRequired.length})…`);
            try {
                plan = await callAgentPlan(state, profile, history.slice(-8), hasCV, credentials);
            } catch (err) {
                console.warn(`[Copo Apply] ✖ LLM plan FAILED in ${Date.now() - _planT0}ms: ${err.message}`);
                // Fallback: use simple map-form for the first iteration
                if (i === 0 && state.formFields.length > 0) {
                    console.warn('[Copo Agent] Agent plan failed, falling back to map-form:', err.message);
                    try {
                        const result = await callLLMMapping(state.formFields, profile);
                        plan = {
                            action: 'FILL',
                            instructions: result.instructions || [],
                            reason: 'Fallback to map-form',
                            waitMs: POST_ACTION_WAIT_MS,
                        };
                    } catch (fallbackErr) {
                        removeProgress();
                        showToast(`❌ Lỗi AI: ${fallbackErr.message}`, 5000);
                        reportResult(false, `LLM error: ${fallbackErr.message}`);
                        return;
                    }
                } else if (/timed? ?out|network|failed to fetch|429|50\d/i.test(err.message || '')
                    && ++planFailures < 3) {
                    // A slow model is not a broken form. This used to end the job
                    // outright on any iteration past the first, so one overloaded
                    // LLM call threw away a completed login and a filled step — and
                    // the recipe, which needs no planner at all, never got its next
                    // pass. Let the loop come round again: the recipe re-runs every
                    // iteration and is idempotent, so it keeps making progress while
                    // the planner is unavailable.
                    trace('plan.transient', { attempt: planFailures, error: err.message });
                    showProgress(i + 1, null, 'AI phản hồi chậm — thử lại…');
                    await sleep(1500);
                    continue;
                } else {
                    removeProgress();
                    showToast(`❌ Lỗi AI: ${err.message}`, 5000);
                    reportResult(false, `Agent plan error: ${err.message}`);
                    return;
                }
            }

            console.log(`[Copo Apply] ← LLM plan in ${Date.now() - _planT0}ms: action=${plan.action}` +
                (plan.reason ? ` (${String(plan.reason).slice(0, 60)})` : '') +
                (Array.isArray(plan.instructions) ? ` [${plan.instructions.length} instr]` : ''));

            // ── 4. CHECK ACTION ──
            if (plan.action === 'DONE') {
                removeProgress();
                const filledCount = history.filter(h => h.plan?.action === 'FILL').reduce(
                    (sum, h) => sum + (h.result?.filled || 0), 0
                );
                // DONE means "form is filled, awaiting human review & submit" —
                // the agent never clicks Submit itself. Report 'filled' (not
                // 'submitted') so the batch UI doesn't claim applications were
                // sent. Report BEFORE the confirmation overlay: awaiting the
                // user's click here would stall the whole batch queue.
                reportResult(true, `Filled ~${filledCount} fields in ${i + 1} iterations — awaiting user submit`, 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                showConfirmation(filledCount, state.totalFields, false);
                return;
            }

            if (plan.action === 'NEED_HUMAN') {
                removeProgress();
                showToast(`⚠️ Cần người dùng: ${plan.reason}`, 8000);
                reportResult(false, `Need human: ${plan.reason}`);
                return;
            }

            // ── 5. ACT ──
            let actionResult = {};
            showProgress(i + 1, null, plan.reason || 'Đang thực hiện...');

            if (plan.action === 'FILL' && plan.instructions?.length > 0) {
                // Track each fill attempt by selector so we can detect
                // persistently-unfilled fields on the next observation.
                for (const inst of plan.instructions) {
                    if (!inst.selector) continue;
                    const prior = fillAttempts.get(inst.selector) || { count: 0, lastValue: '' };
                    fillAttempts.set(inst.selector, {
                        count: prior.count + 1,
                        lastValue: inst.value,
                    });
                }
                const filled = await executeFillInstructions(plan.instructions, cvData, policyCtx('planner'));
                actionResult = { filled, total: plan.instructions.length };
                if (filled > 0) actionsTaken++;
            } else if (plan.action === 'CLICK' && plan.clickTarget) {
                const target = document.querySelector(plan.clickTarget);
                if (target) {
                    // Log what we're clicking + whether an open dropdown/popup is
                    // covering the footer (its promptOptions would swallow a Next click).
                    const info = {
                        sel: plan.clickTarget,
                        aid: target.getAttribute?.('data-automation-id') || null,
                        text: (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28),
                        disabled: !!(target.disabled || target.getAttribute?.('aria-disabled') === 'true'),
                        visible: target.offsetParent !== null,
                        openDropdownOptions: document.querySelectorAll('[data-automation-id="promptOption"]').length,
                    };
                    console.log('[Copo Apply] CLICK →', info);
                    // Judge the click BEFORE acting on it, so the refusal (and its
                    // code) lands in history. safeActivate would refuse it anyway,
                    // but silently — and a planner that can't see why its action
                    // did nothing just proposes the same one again next iteration.
                    const clickCtx = policyCtx('planner');
                    const verdict = checkClick(target, clickCtx, plan.clickTarget);
                    if (!verdict.allowed) {
                        logDenial(verdict, target, clickCtx);
                        actionResult = { blockedByPolicy: verdict.code, reason: verdict.reason, ...info };
                        history.push({
                            iteration: i,
                            state: summarizeState(state),
                            plan: { action: plan.action, reason: plan.reason },
                            result: actionResult,
                        });
                        // A refused submit ends the run as SUCCESS only when there
                        // is something to hand over. Reporting "✅ đã điền xong"
                        // after filling nothing — which is what happened when the
                        // policy refused the Apply button on a job-description page
                        // — is a false success: the batch row said done, the user
                        // believed it, and the application had not been started.
                        if (verdict.code === 'submit_application' || verdict.code === 'final_review_step') {
                            removeProgress();
                            if (actionsTaken > 0) {
                                showToast('✅ Đã điền xong — kiểm tra rồi tự bấm nộp để hoàn tất.', 8000);
                                reportResult(true, `Policy stop at ${verdict.code} — awaiting user submit`, 'filled', { review: summarizeAnswers(reviewAnswers), fieldGaps: [...fieldGaps.values()] });
                                showConfirmation(state.totalFields, state.totalFields, false);
                            } else {
                                showToast('⚠️ Chưa mở được form ứng tuyển trên trang này — hãy bấm Apply thủ công.', 8000);
                                reportResult(false, `Blocked before filling anything (${verdict.code})`, 'blocked',
                                    { blockedReason: 'manual' });
                            }
                            return;
                        }
                        await sleep(plan.waitMs || POST_ACTION_WAIT_MS);
                        continue;
                    }
                    // A leftover open Workday dropdown popup overlays the page footer
                    // and eats the Next/Continue click — close it before clicking.
                    if (info.openDropdownOptions > 0 && closeOpenDropdown()) await sleep(250);
                    // Overlay-aware: Workday covers Next/Continue/Submit buttons with
                    // a "click_filter" div that owns the handler — a plain .click() on
                    // the button is swallowed, so the agent could never advance a step.
                    if (!safeActivate(target, clickCtx, plan.clickTarget)) { await sleep(POST_ACTION_WAIT_MS); continue; }
                    actionResult = { clicked: plan.clickTarget, ...info };
                    actionsTaken++;
                } else {
                    console.warn('[Copo Apply] CLICK target NOT FOUND:', plan.clickTarget);
                    actionResult = { error: `Click target not found: ${plan.clickTarget}` };
                }
            } else if (plan.action === 'SCROLL') {
                await scrollAndCollect();
                actionResult = { scrolled: true };
            } else if (plan.action === 'WAIT') {
                // Just wait
                actionResult = { waited: true };
            }

            console.log(`[Copo Apply] exec ${plan.action} →`, actionResult);

            // ── 6. RECORD HISTORY ──
            history.push({
                iteration: i,
                state: summarizeState(state),
                plan: { action: plan.action, reason: plan.reason },
                result: actionResult,
            });

            // ── 7. WAIT for page to react ──
            await sleep(plan.waitMs || POST_ACTION_WAIT_MS);
        }

    } catch (err) {
        removeProgress();
        showToast(`❌ Lỗi: ${err.message}`, 5000);
        reportResult(false, err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Confirmation Overlay
// ═══════════════════════════════════════════════════════════════════

// ─── Report result back to background ───
// outcome: 'submitted' (new success signal seen after our actions)
//        | 'filled'    (form filled, awaiting the user's review + submit)
//        | 'blocked'   (waiting on the USER — verify an email, supply a password;
//                       NOT a failure, and never shown as one)
//        | 'failed'
function summarizeAnswers(reviewAnswers) {
    const all = [...reviewAnswers.values()];
    const defaults = all.filter(a => a.source === 'AGENT_DEFAULT');
    // Values the ATS parsed that disagree with the candidate's own CV. They are
    // reported, never silently corrected — and they are the single most useful
    // thing on a review page, because they are the errors a person reading their
    // own filled form is least likely to notice.
    const mismatches = all.filter(a => a.verdict === 'MISMATCH');
    return {
        answered: all.length,
        agentDefaults: defaults.length,
        mismatches: mismatches.length,
        mismatchFields: mismatches.map(a => ({ field: a.field, expected: a.expected, actual: a.value })).slice(0, 10),
        // Named, not just counted: "4 giá trị mặc định" tells the user there is
        // something to check but not what, which is the same as telling them to
        // re-read the whole form.
        agentDefaultFields: defaults.map(a => a.field).slice(0, 10),
        corrected: all.filter(a => a.source === 'CORRECTED').length,
    };
}

/**
 * True when this content script has been orphaned by an extension reload.
 *
 * `chrome.runtime.sendMessage(...).catch()` does NOT cover this: with the context
 * gone `chrome.runtime` is undefined, so reading `.sendMessage` throws
 * synchronously — before there is a promise to catch — and the throw escapes into
 * whatever was driving the loop.
 */
function contextGone() {
    try { return !(chrome && chrome.runtime && chrome.runtime.id); } catch { return true; }
}

function reportResult(success, detail, outcome, extra = {}) {
    const o = outcome || (success ? 'filled' : 'failed');
    console.log(`[Copo Apply] ■ result: ${success ? '✅' : '✖'} outcome=${o} | ${detail} | ${window.location.hostname}`);
    // A run that did not finish is the one worth explaining, and the reason is
    // usually several navigations back — where the console for it no longer
    // exists. Print the whole trace here so a failure is one paste, not an
    // archaeology exercise.
    trace('run.end', { success, outcome: o, detail, ...extra });
    if (!success) traceDump(`${o} — ${detail}`);
    traceClear();   // this job is over; the next one starts from an empty buffer
    if (contextGone()) {
        console.warn('[Copo Apply] extension was reloaded — this tab is orphaned, result not reported');
        return;
    }
    chrome.runtime.sendMessage({
        type: 'AUTO_APPLY_RESULT',
        result: {
            success,
            outcome: o,
            site: window.location.hostname,
            url: window.location.href,
            detail,
            ...extra,
        },
    }).catch(() => { });
}

// ─── ATS auth (candidate accounts) ───
// The background owns the credential and the per-tenant attempt budget; the
// content script only drives the form. Keeping the decision there means a
// navigation (which kills this script) can't reset the count.

/** User-facing wording per block reason. Blocked ≠ failed. */
const ATS_BLOCK_DETAIL = {
    verification: 'Chờ bạn xác minh email của công ty này',
    credential: 'Cần thông tin đăng nhập riêng cho công ty này',
    manual: 'Cần bạn xử lý trực tiếp trên trang này',
};

/** Ask for this tenant's credential + the operation we're allowed to run. */
async function requestAtsAuth() {
    try {
        return await chrome.runtime.sendMessage({
            type: 'ATS_AUTH_REQUEST', url: window.location.href,
        });
    } catch {
        return { ok: false, reason: 'manual', detail: 'Không liên lạc được với extension' };
    }
}

/** Hand back a credential we never used, so the attempt is not counted. */
async function abandonAtsAuth(operation, why) {
    try {
        await chrome.runtime.sendMessage({
            type: 'ATS_AUTH_ABANDON', url: window.location.href, operation, why,
        });
    } catch { /* worker gone — the batch is over anyway */ }
}

/**
 * Wait until the login form can actually be filled.
 *
 * `detectLoginWall` answers on a password box plus sign-in wording, and on
 * Workday both appear a beat before the form is usable — so the agent asked for
 * a credential, spent the tenant's attempt, and then found nothing to type into.
 * Requesting the grant is the commitment point, so it has to happen after this,
 * not before.
 */
async function waitForLoginFormReady(login, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    const vis = (e) => !!(e && e.offsetParent !== null);
    while (Date.now() < deadline) {
        const wall = detectLoginWall(login);
        if (wall) {
            const hasText = [...document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')]
                .some(vis);
            const hasSubmit = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
                .some(vis);
            if (hasText && hasSubmit) return wall;
        }
        await sleep(300);
    }
    return null;
}

/** Hand the normalized verdict back so it's persisted for the whole tenant. */
async function reportAtsAuth(result) {
    if (!result) return null;
    try {
        return await chrome.runtime.sendMessage({
            type: 'ATS_AUTH_RESULT', url: window.location.href, result,
        });
    } catch {
        return null;
    }
}

// ─── Heartbeat: tell background this job is still actively working ───
function sendHeartbeat() {
    if (contextGone()) return;
    try { chrome.runtime.sendMessage({ type: 'AUTO_APPLY_HEARTBEAT' }).catch(() => { }); } catch { /* orphaned */ }
}

// ═══════════════════════════════════════════════════════════════════
// Job-page detection — only show the button on actual job/apply pages
// ═══════════════════════════════════════════════════════════════════

function injectFloatingButton(profile) {
    if (document.getElementById('jobfit-auto-apply-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'jobfit-auto-apply-btn';
    btn.textContent = '⚡ Auto Apply';
    btn.title = 'Copo — Auto Apply Agent';
    Object.assign(btn.style, {
        position: 'fixed', bottom: '80px', right: '20px', zIndex: '99999',
        background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
        color: 'white', border: 'none', borderRadius: '14px',
        padding: '12px 20px', fontSize: '14px', fontWeight: '700',
        cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
        transition: 'transform 0.2s, box-shadow 0.2s',
    });
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; };
    btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
    btn.addEventListener('click', () => runAgentLoop(profile));
    document.body.appendChild(btn);
}

// ═══════════════════════════════════════════════════════════════════
// Initialize
// ═══════════════════════════════════════════════════════════════════

async function init() {
    // Small grace period so we don't race with the very first paint.
    await sleep(800);

    try {
        const data = await new Promise(r => {
            chrome.storage.local.get(['pendingAutoApply', 'jobfitProfile', 'batchMode', 'applySession'], r);
        });

        // Auto-apply was triggered from the web app / batch flow → run immediately,
        // do NOT gate on heuristics (the user already chose this URL).
        if (data.pendingAutoApply && data.jobfitProfile) {
            const sess = data.applySession || {};
            const fresh = sess.startedAt && (Date.now() - sess.startedAt < APPLY_SESSION_TTL_MS);

            // Tab-scope guard: only auto-run in the tab the user actually launched
            // auto-apply in (or one it redirected / spawned into). Otherwise a
            // still-live pendingAutoApply flag fires the agent on ANY known-host
            // page the user opens — e.g. their LinkedIn feed. A content script
            // can't read its own tabId, so ask the background which owns the
            // apply-session tab id.
            const isApplyTab = fresh && await new Promise(r => {
                chrome.runtime.sendMessage({ type: 'IS_APPLY_TAB' }, (resp) => {
                    r(!chrome.runtime.lastError && !!(resp && resp.isApplyTab));
                });
            });

            if (!fresh) {
                // Stale flag → clear and fall through to manual mode.
                chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl', 'batchMode', 'applySession']);
            } else if (!isApplyTab) {
                // Live apply session, but this is NOT its tab — do NOT auto-run.
                // Leave the flag intact for the real apply tab; behave as manual mode here.
                console.log('[Copo Agent] pendingAutoApply is set but this is not the apply tab — skipping auto-run', location.hostname);
            } else if (window.__copoAgentStarted) {
                // This document already has an agent running (e.g. declarative +
                // a programmatic re-inject after a redirect) — don't double-run.
                return;
            } else {
                window.__copoAgentStarted = true;
                const isBatch = data.batchMode === true;

                // IMPORTANT: do NOT clear pendingAutoApply here. It must survive a
                // full-page redirect (job page → "Apply" → the form on another ATS
                // domain) so the agent re-injected on the landing page RESUMES the
                // fill. Background owns the flag's lifecycle: it clears it on
                // AUTO_APPLY_RESULT, on the apply tab closing, or when the redirect
                // chain exceeds its hop budget.
                console.log(`[Copo Agent] Auto-apply triggered (batch: ${isBatch}, host: ${location.hostname})`);

                showToast(isBatch
                    ? '🚀 Batch Apply — Đang xử lý job này...'
                    : '🚀 Copo Agent đang xử lý...', 0);
                await sleep(500);
                document.getElementById('jobfit-toast')?.remove();

                await runAgentLoop(data.jobfitProfile);
                return;
            }
        }
    } catch (e) {
        console.warn('[Copo Agent] Auto-apply check failed:', e);
        reportResult(false, `Init error: ${e.message}`);
    }

    // Manual mode: only inject the floating button on pages that look like
    // job/apply pages. Re-evaluate on SPA navigation.
    const profile = await new Promise(r => {
        chrome.storage.local.get('jobfitProfile', d => r(d.jobfitProfile || null));
    });
    if (!profile) return;

    const evaluateAndInject = async () => {
        const isJobPage = await waitForJobPageSignal();
        if (isJobPage) {
            injectFloatingButton(profile);
        } else {
            console.log('[Copo Agent] Page does not look like a job/apply page, skipping button.');
        }
    };

    await evaluateAndInject();

    // Handle SPA route changes (history.pushState / popstate) — re-check once
    // the URL changes so the button can appear/disappear correctly.
    let lastUrl = location.href;
    const onRouteChange = () => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        document.getElementById('jobfit-auto-apply-btn')?.remove();
        evaluateAndInject();
    };
    window.addEventListener('popstate', onRouteChange);
    const _push = history.pushState;
    history.pushState = function (...args) {
        const ret = _push.apply(this, args);
        setTimeout(onRouteChange, 100);
        return ret;
    };
}

// ═══════════════════════════════════════════════════════════════════
// ── MODE 1 — Tailor CV for THIS job page ──
//    Triggered from the popup ("Tailor CV for this job"). Reads the JD
//    text off the page + the synced rich CV, mints an opaque source_ref,
//    and asks the background to run the no-store /api/ai/tailor pipeline.
//    The JD text only ever leaves via that endpoint; the job URL never
//    leaves the browser (stored under source_ref by the background).
// ═══════════════════════════════════════════════════════════════════
function _newSourceRef() {
    try {
        if (crypto?.randomUUID) return crypto.randomUUID();
    } catch { /* not a secure context */ }
    return 'sr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Debug logging for the tailor-on-job-board flow. Page-side logs show in the
// JOB BOARD tab's DevTools console (filter: "Mode1"). Background-side logs show
// in the extension's service-worker console (chrome://extensions → Copo →
// "service worker"). Both share the [Copo Mode1] prefix.
const M1 = '[Copo Mode1]';

async function runMode1() {
    const t0 = Date.now();
    console.log(`${M1} ▶ start`, { url: location.href, host: location.hostname });

    const cv = await new Promise(r => {
        chrome.storage.local.get(['jobfitCv', 'jobfitCvSyncedAt'], d =>
            r({ cv: d.jobfitCv || null, syncedAt: d.jobfitCvSyncedAt }));
    });
    if (!cv.cv) {
        console.warn(`${M1} ✖ no CV synced — open Copo and sync first`);
        return { success: false, error: 'Chưa có CV. Hãy mở Copo và đồng bộ CV trước.' };
    }
    console.log(`${M1} ✓ CV synced`, {
        name: cv.cv.name || cv.cv.full_name || '(unnamed)',
        skills: Array.isArray(cv.cv.skills) ? cv.cv.skills.length : 0,
        syncedAt: cv.syncedAt ? new Date(cv.syncedAt).toISOString() : 'unknown',
    });

    const jdText = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, 15000);
    console.log(`${M1} JD extracted from page`, {
        chars: jdText.length,
        head: jdText.slice(0, 140).replace(/\n/g, ' '),
    });
    if (jdText.length < 80) {
        console.warn(`${M1} ✖ JD too short (${jdText.length} chars) — page may be an SPA shell or wrong tab`);
        return { success: false, error: 'Không đọc được JD trên trang này.' };
    }

    const sourceRef = _newSourceRef();
    // No in-page toast here — the popup's Apply tab owns all progress UI for
    // Mode 1 (the old fixed toast doubled up with the popup stepper).
    console.log(`${M1} → sending MODE1_TAILOR to background`, { sourceRef, jdChars: jdText.length });
    try {
        const resp = await chrome.runtime.sendMessage({
            type: 'MODE1_TAILOR',
            cv: cv.cv,
            jdText,
            sourceRef,
            jobUrl: location.href,
            jobTitle: (document.title || '').trim().slice(0, 200),
            options: { length: 'concise' },
        });
        const ms = Date.now() - t0;
        if (resp?.success) {
            const v0 = resp.data?.variants?.[0];
            console.log(`${M1} ✅ tailored in ${ms}ms`, {
                variants: resp.data?.variants?.length ?? 0,
                improvements: v0?.improvements?.length ?? 0,
                score: resp.data?.match?.overall_score,
            });
        } else {
            console.warn(`${M1} ✖ tailor failed in ${ms}ms:`, resp?.error, resp);
        }
        return resp || { success: false, error: 'no response' };
    } catch (e) {
        console.error(`${M1} ✖ exception after ${Date.now() - t0}ms:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * Run ONE pass on whatever page is already open, and report what happened.
 *
 * Debugging a single step through the full flow costs a login, a résumé upload
 * and two or three wizard pages before the step under test is even reached — and
 * every fix to that step pays the toll again. Worse, the toll is where most of
 * the noise lives, so a failure on page 4 arrives wrapped in three pages of
 * unrelated trace.
 *
 * So this deliberately does LESS than the agent: no login wall, no gateway click,
 * no navigation, no iteration, and no advance unless asked for by name. It fills
 * the recipe step for the current page once and describes the result. Nothing
 * here can submit — `advance` goes through the same policy choke point as the
 * agent's own click, which refuses the review step and the submit control.
 *
 * @param {{fill?: boolean, advance?: boolean}} opts
 *   `fill:false` observes without touching the page (what does the agent SEE?).
 *   `advance:true` clicks the step's Next once, after filling.
 */
async function runSingleStep(opts = {}) {
    const { fill = true, advance = false } = opts;
    try {
        const [profile, cvStructured] = await Promise.all([
            new Promise(r => chrome.storage.local.get('jobfitProfile', d => r(d.jobfitProfile || null))),
            new Promise(r => chrome.storage.local.get('jobfitCv', d => r(d.jobfitCv || null))),
        ]);
        if (!profile) return { ok: false, error: 'no jobfitProfile in storage — sync from the web app first' };
        const { cv: cvData } = await loadSessionCv();

        const recipes = await loadRecipes();
        const recipe = recipeForUrl(recipes, location.href);
        if (!recipe) return { ok: false, error: `no recipe matches ${location.host}` };

        const before = await observePageState();
        const step = (recipe.steps || []).find(s => s.detect && document.querySelector(s.detect));
        const manifest = buildManifest(before.formFields, { profile, cv: cvStructured });
        const gaps = summarizeGaps(manifest);

        let rf = null;
        if (fill) rf = await applyRecipeFields(recipe, profile, cvData, cvStructured);
        // Colliding with the live loop is the one failure that looks like a page
        // bug but is ours: say so instead of reporting the other pass's numbers.
        if (rf?.busy) {
            return { ok: false, error: 'a fill is already running in this tab (Auto Apply loop?) — '
                + 'stop it or wait for the pass to finish, then copoStep() again' };
        }
        const after = fill ? await observePageState() : before;

        let advanced = null;
        if (advance && step?.advance) {
            const btn = document.querySelector(step.advance);
            advanced = btn ? safeActivate(btn, policyCtxFor(recipe), step.advance) : false;
        }

        return {
            ok: true,
            url: location.pathname.slice(-60),
            recipe: `${recipe.label} v${recipe.version}`,
            step: step?.name || '(no recipe step matches this page)',
            atFinalStep: atFinalStep(recipe),
            filled: rf?.filled ?? null,
            fields: after.formFields.length,
            unfilledRequired: after.unfilledRequired,
            errors: after.errors.map(e => `${e.field || '?'}: ${e.message}`.slice(0, 90)),
            mismatches: gaps.mismatches.map(m => `${m.field}: ours="${m.expected}" page="${m.actual}"`),
            gapsUserOnly: gaps.userOnly,
            gapsInferable: gaps.inferable,
            advanced,
            hint: 'trace steps are in the console above; copoStep({advance:true}) to move on',
        };
    } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
    }
}

/** Policy context for a manual single-step run — same rules, source declared. */
function policyCtxFor(recipe) {
    return {
        source: 'recipe',
        atFinalStep: recipe ? atFinalStep(recipe) : false,
        submitSelector: recipe?.submitSelector,
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RUN_MODE1') {
        runMode1().then(sendResponse);
        return true; // async
    }
    if (message?.type === 'AGENT_TEST_STEP') {
        runSingleStep(message.opts || {}).then(sendResponse);
        return true; // async
    }
});

init();
