// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { LLM_TIMEOUT } from './constants.js';
import { spanBucket } from './trace.js';

/**
 * Call the original map-form endpoint (for simple single-step fills).
 */
export async function callLLMMapping(formFields, profileData) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('LLM proxy timeout (65s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_MAP_FORM',
            formFields,
            profileData,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'LLM proxy failed'));
        });
    });
}

/**
 * Call the new agent-plan endpoint for the agentic loop.
 */
export async function callAgentPlan(pageState, profileData, history, hasCV, credentials) {
    // Model time is the other half of a slow run — measured here so the report
    // can say "waiting X, thinking Y" instead of one opaque total.
    const _t0 = Date.now();
    try { return await _callAgentPlan(pageState, profileData, history, hasCV, credentials); }
    finally { try { spanBucket('llmMs', Date.now() - _t0); } catch { /* noop */ } }
}

async function _callAgentPlan(pageState, profileData, history, hasCV, credentials) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Agent plan timeout (65s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_AGENT_PLAN',
            pageState,
            profileData,
            history,
            hasCV,
            // Education / languages, so the planner can INFER the fields a CV
            // never states outright (which qualification a degree list means).
            credentials,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'Agent plan failed'));
        });
    });
}

/**
 * Ask the app to write the short note an ATS's "message to the hiring team" box
 * wants, from the candidate's CV and this job.
 *
 * The web app normally does this BEFORE dispatch, where it holds the parsed JD
 * and the match score — that path produces the better text and is the one that
 * runs for anything applied from the editor. This exists for the applies that
 * never went through it (the popup's "apply on this page"), where the only job
 * context is what is readable on the page.
 *
 * @param {{title: string, company?: string, description?: string}} job
 * @param {object} cv    the structured CV — the ONLY source of claims
 * @param {string} lang  'vi' | 'en'
 */
export async function callApplyMessage(job, cv, lang) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Apply-message timeout (65s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_APPLY_MESSAGE',
            job,
            cv,
            lang,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'Apply-message failed'));
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// Find "Apply" button on page
// ═══════════════════════════════════════════════════════════════════
