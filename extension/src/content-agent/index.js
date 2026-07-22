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

import { AGENT_MAX_ITERATIONS, APPLY_SESSION_TTL_MS, FILL_RETRY_THRESHOLD, POST_ACTION_WAIT_MS } from './constants.js';
import { overlayClick, sleep } from './dom.js';
import { removeProgress, showConfirmation, showProgress, showToast } from './ui.js';
import { callAgentPlan, callLLMMapping } from './llm.js';
import { executeFillInstructions } from './fill.js';
import { observePageState, scrollAndCollect } from './observe.js';
import { findApplyButton, isApplicationFormPage, summarizeState, waitForJobPageSignal } from './detect.js';
import { getApplyCredentials, handleLoginWall } from './login.js';
import { applyRecipeFields, atFinalStep, clickRecipeGateway, loadRecipes, recipeForUrl } from './recipe.js';

/**
 * Main agentic loop: Observe → Plan → Act → Verify.
 */
async function runAgentLoop(profile) {
    const history = [];
    let prevStateHash = '';
    let prevStepCurrent = null;
    let prevUrl = window.location.href;
    const fillAttempts = new Map(); // selector → { count, lastValue }
    const persistentlyUnfilled = new Set();
    // Completion signals present BEFORE we act. Job pages often contain static
    // marketing copy that matches the success regexes ("ứng tuyển thành công
    // trong 1 phút", "Cảm ơn bạn đã quan tâm..."), so only signals that APPEAR
    // after we actually did something count as a submitted application.
    let baselineSignals = null;
    let actionsTaken = 0;
    let loginAttempts = 0;   // cap login-wall retries so a wrong password can't loop forever
    const gatewayClicks = new Map();   // recipe gateway label → click count (loop guard)

    // Load CV data if available
    const cvData = await new Promise(r => {
        chrome.storage.local.get(['cvFileBase64', 'cvFileName'], d => {
            if (d.cvFileBase64 && d.cvFileName) {
                r({ base64: d.cvFileBase64, fileName: d.cvFileName });
            } else {
                r(null);
            }
        });
    });
    const hasCV = !!cvData;
    const applyCreds = await getApplyCredentials();

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

    console.log('[Copo Apply] ▶ runAgentLoop start', {
        url: location.href, host: location.hostname, hasCV, hasCreds: !!applyCreds?.password,
        recipe: recipe?.ats || null, profileFields: Object.keys(profile || {}).length,
    });

    try {
        // Step 0: click an Apply button ONLY if we're not already on the form.
        // On an application form (e.g. Trakstar's ?apply=true) hunting for "Apply"
        // matches a third-party shortcut ("Apply with Indeed") and hijacks the
        // flow into a redirect/reload loop — so when the form is here, fill it.
        showProgress(0, AGENT_MAX_ITERATIONS, 'Kiểm tra trang...');
        await sleep(1000);

        if (isApplicationFormPage()) {
            console.log('[Copo Apply] step0: already on an application form — filling directly (skip Apply hunt)', location.href);
            showProgress(0, AGENT_MAX_ITERATIONS, 'Đã ở form ứng tuyển, bắt đầu điền...');
            await sleep(300);
        } else {
            const applyBtn = findApplyButton();
            if (applyBtn) {
                console.log('[Copo Apply] step0: clicked Apply button:', (applyBtn.innerText || applyBtn.value || '').trim().slice(0, 40));
                overlayClick(applyBtn);
                showProgress(0, AGENT_MAX_ITERATIONS, 'Đã click nút Ứng tuyển, chờ form...');
                await sleep(2000);
            } else {
                console.log('[Copo Apply] step0: no Apply button found — scanning current form');
                showProgress(0, AGENT_MAX_ITERATIONS, 'Không tìm thấy nút Apply, scan form hiện tại...');
                await sleep(500);
            }
        }

        // Scroll to discover all fields
        await scrollAndCollect();

        let sameStateCount = 0;

        for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
            // Keep the background watchdog alive — an iteration can legitimately
            // take minutes (LLM call + waits), the timer should only fire when
            // this page goes silent.
            sendHeartbeat();

            // ── 1. OBSERVE ──
            showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Đang phân tích trang...');
            const state = await observePageState();

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
                const _err = /something went wrong|refresh the page and (?:then )?try again/i.test(_bt);
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

            // ── 2. CHECK TERMINATION ──
            if (baselineSignals === null) baselineSignals = new Set(state.completionSignals);
            const newSignals = state.completionSignals.filter(s => !baselineSignals.has(s));
            // Success = a NEW signal appeared after at least one real action. But a
            // recipe'd multi-step ATS (Workday…) never auto-submits — the agent hands
            // off at the review step — so a completion signal BEFORE the final step is
            // a false positive (e.g. "Successfully uploaded" on the Autofill-with-Resume
            // step reading as the whole application being done). Trust atFinalStep there.
            const midRecipeFlow = !!recipe?.finalStepSelector && !atFinalStep(recipe);
            if (newSignals.length > 0 && actionsTaken > 0 && !midRecipeFlow) {
                showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Phát hiện ứng tuyển thành công!');
                removeProgress();
                reportResult(true, `Success detected: ${newSignals[0]}`, 'submitted');
                showConfirmation(state.totalFields, state.totalFields, true);
                return;
            }

            // ── NEVER AUTO-SUBMIT: stop at the ATS's final review step and hand off.
            // Workday's review "Submit" reuses pageFooterNextButton, so an overlay-aware
            // Next click would otherwise send the application. Fill up to here only.
            if (recipe && atFinalStep(recipe)) {
                removeProgress();
                showToast('✅ Đã điền xong tới bước cuối — kiểm tra rồi bấm "Submit" để nộp.', 7000);
                reportResult(true, 'Reached review step — filled, awaiting user submit', 'filled');
                showConfirmation(state.totalFields, state.totalFields, false);
                return;
            }

            // ── RECIPE GATEWAY: click through a non-form gateway (Workday's "Start
            // Your Application" modal, whose options are <a role="button"> the generic
            // scan misses) to reach the form. Before login/fill; capped so it can't loop.
            if (recipe) {
                const gw = clickRecipeGateway(recipe, hasCV, gatewayClicks);
                if (gw.clicked) {
                    actionsTaken++;
                    showProgress(i + 1, AGENT_MAX_ITERATIONS, `Tiếp tục: ${gw.label}`);
                    await sleep(1500);
                    continue; // re-observe the screen the gateway led to
                }
            }

            // ── Login / sign-up wall: sign in with the user's synced credentials
            // (Workday & friends gate the form behind an account). Do this BEFORE
            // the LLM plan — the planner refuses password fields by design. On
            // submit the page navigates and the redirect-resume re-injects us on
            // the real form. Guarded to a genuine login/signup page inside
            // handleLoginWall, so it no-ops on a normal application form.
            if (applyCreds?.password && document.querySelector('input[type="password"]')) {
                // Fill + submit the sign-in (handleLoginWall clicks the click_filter
                // overlay over Workday's button — pure JS). Two auto passes.
                if (loginAttempts < 2) {
                    loginAttempts++;
                    await handleLoginWall(applyCreds, recipe?.login);
                    actionsTaken++;
                    showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Đăng nhập…');
                    await sleep(3200);
                    continue; // re-observe: a successful submit cleared the wall
                }
                // Still walled after two auto passes (wrong credentials, or an ATS we
                // can't submit) → pre-fill so the user clicks "Sign In" once, then
                // auto-resume when the wall clears. Waits up to 3 min; no burned iters.
                await handleLoginWall(applyCreds, recipe?.login); // (re)fill + submit
                showToast('🔐 Đã điền sẵn email + mật khẩu. Nếu chưa tự đăng nhập, hãy bấm nút "Sign In" — '
                    + 'hệ thống sẽ tự động điền tiếp sau khi bạn đăng nhập.', 0);
                const waitStart = Date.now();
                let cleared = false;
                while (Date.now() - waitStart < 180000) {
                    sendHeartbeat();
                    showProgress(i + 1, AGENT_MAX_ITERATIONS, '⏳ Chờ đăng nhập…');
                    const pwNow = document.querySelector('input[type="password"]');
                    if (!pwNow) { cleared = true; break; }          // signed in → wall gone
                    if (!pwNow.value) await handleLoginWall(applyCreds, recipe?.login); // re-render cleared it
                    await sleep(2000);
                }
                document.getElementById('jobfit-toast')?.remove();
                if (!cleared) {
                    removeProgress();
                    showToast('⚠️ Chưa đăng nhập sau 3 phút. Đăng nhập thủ công rồi bấm Auto Apply lại nhé.', 6000);
                    reportResult(false, 'Manual login timeout');
                    return;
                }
                showToast('✅ Đã đăng nhập — tiếp tục điền hồ sơ...', 3000);
                prevStateHash = ''; fillAttempts.clear(); persistentlyUnfilled.clear();
                await sleep(1500);
                continue; // resume on the post-login step
            }

            // ── RECIPE PRE-FILL: for a known ATS (Workday…), fill the standardized
            // text fields with exact verified selectors BEFORE the LLM plans. It's
            // idempotent (skips already-filled inputs) so it goes quiet once the
            // step is done; when it fills something new we re-observe so the LLM
            // sees the pre-filled state and only handles the rest (dropdowns, Next).
            if (recipe) {
                const rf = await applyRecipeFields(recipe, profile, cvData);
                if (rf.filled > 0) {
                    actionsTaken++;
                    history.push({
                        iteration: i,
                        plan: { action: 'RECIPE', reason: `recipe ${recipe.ats}/${rf.step}` },
                        result: { filled: rf.filled },
                    });
                    showProgress(i + 1, AGENT_MAX_ITERATIONS, `Điền tự động (${recipe.label}) — ${rf.filled} trường`);
                    await sleep(600);
                    continue; // re-observe; LLM handles dropdowns / navigation next
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
                prevStepCurrent = curStep;
                prevUrl = state.url;
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
                    removeProgress();
                    showToast('⚠️ Agent bị stuck — dừng lại. Vui lòng điền thủ công.', 5000);
                    reportResult(false, 'Agent stuck — same state 3 iterations');
                    return;
                }
            } else {
                sameStateCount = 0;
                prevStateHash = stateHash;
            }

            // ── 3. PLAN: Ask LLM what to do next ──
            showProgress(i + 1, AGENT_MAX_ITERATIONS, `AI đang lên kế hoạch (iteration ${i + 1})...`);

            let plan;
            try {
                plan = await callAgentPlan(state, profile, history.slice(-8), hasCV);
            } catch (err) {
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
                } else {
                    removeProgress();
                    showToast(`❌ Lỗi AI: ${err.message}`, 5000);
                    reportResult(false, `Agent plan error: ${err.message}`);
                    return;
                }
            }

            console.log(`[Copo Apply] iter ${i + 1}/${AGENT_MAX_ITERATIONS}: fields=${state.formFields.length} → action=${plan.action}` +
                (plan.reason ? ` (${String(plan.reason).slice(0, 50)})` : '') +
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
                reportResult(true, `Filled ~${filledCount} fields in ${i + 1} iterations — awaiting user submit`, 'filled');
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
            showProgress(i + 1, AGENT_MAX_ITERATIONS, plan.reason || 'Đang thực hiện...');

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
                const filled = await executeFillInstructions(plan.instructions, cvData);
                actionResult = { filled, total: plan.instructions.length };
                if (filled > 0) actionsTaken++;
            } else if (plan.action === 'CLICK' && plan.clickTarget) {
                const target = document.querySelector(plan.clickTarget);
                if (target) {
                    // Overlay-aware: Workday covers Next/Continue/Submit buttons with
                    // a "click_filter" div that owns the handler — a plain .click() on
                    // the button is swallowed, so the agent could never advance a step.
                    overlayClick(target);
                    actionResult = { clicked: plan.clickTarget };
                    actionsTaken++;
                } else {
                    actionResult = { error: `Click target not found: ${plan.clickTarget}` };
                }
            } else if (plan.action === 'SCROLL') {
                await scrollAndCollect();
                actionResult = { scrolled: true };
            } else if (plan.action === 'WAIT') {
                // Just wait
                actionResult = { waited: true };
            }

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

        // Max iterations reached
        removeProgress();
        showToast('⚠️ Đã chạy tối đa iterations. Kiểm tra lại form.', 5000);
        reportResult(false, `Max iterations (${AGENT_MAX_ITERATIONS}) reached`);

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
//        | 'failed'
function reportResult(success, detail, outcome) {
    const o = outcome || (success ? 'filled' : 'failed');
    console.log(`[Copo Apply] ■ result: ${success ? '✅' : '✖'} outcome=${o} | ${detail} | ${window.location.hostname}`);
    chrome.runtime.sendMessage({
        type: 'AUTO_APPLY_RESULT',
        result: {
            success,
            outcome: outcome || (success ? 'filled' : 'failed'),
            site: window.location.hostname,
            url: window.location.href,
            detail,
        },
    }).catch(() => { });
}

// ─── Heartbeat: tell background this job is still actively working ───
function sendHeartbeat() {
    chrome.runtime.sendMessage({ type: 'AUTO_APPLY_HEARTBEAT' }).catch(() => { });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RUN_MODE1') {
        runMode1().then(sendResponse);
        return true; // async
    }
});

init();
