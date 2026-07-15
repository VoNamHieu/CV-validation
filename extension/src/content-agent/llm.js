// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { LLM_TIMEOUT } from './constants.js';

/**
 * Call the original map-form endpoint (for simple single-step fills).
 */
export async function callLLMMapping(formFields, profileData) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('LLM proxy timeout (30s)')), LLM_TIMEOUT);
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
export async function callAgentPlan(pageState, profileData, history, hasCV) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Agent plan timeout (30s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_AGENT_PLAN',
            pageState,
            profileData,
            history,
            hasCV,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'Agent plan failed'));
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// Find "Apply" button on page
// ═══════════════════════════════════════════════════════════════════
