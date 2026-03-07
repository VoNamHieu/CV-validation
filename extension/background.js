/**
 * JobFit AI — Auto Apply Extension — Background Service Worker
 */



// ─── Listen for external messages from JobFit AI web app ───
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // Existing: export profile from web app
    if (message.type === 'JOBFIT_EXPORT_PROFILE') {
        chrome.storage.local.set({ jobfitProfile: message.profile }, () => {
            sendResponse({ success: true });
            // Notify any open popup
            chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED' }).catch(() => { });
        });
        return true;
    }

    // NEW: Auto Apply — web app triggers apply on a specific job URL
    if (message.type === 'AUTO_APPLY_START') {
        const { jobUrl, profile } = message;
        if (!jobUrl || !profile) {
            sendResponse({ success: false, error: 'Missing jobUrl or profile' });
            return true;
        }

        // Save profile + set pending flag
        chrome.storage.local.set({
            jobfitProfile: profile,
            pendingAutoApply: true,
            autoApplyJobUrl: jobUrl,
        }, () => {
            // Open the job URL in a new tab
            chrome.tabs.create({ url: jobUrl, active: true }, (tab) => {
                console.log('[JobFit AI] Auto Apply: opened tab', tab.id, 'for', jobUrl);
                sendResponse({ success: true, tabId: tab.id });
            });
        });
        return true; // async response
    }

    // NEW: Check extension status (ping from web app)
    if (message.type === 'JOBFIT_PING') {
        sendResponse({ success: true, version: chrome.runtime.getManifest().version });
        return true;
    }
});

// ─── Listen for internal messages from content scripts ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PROFILE') {
        chrome.storage.local.get('jobfitProfile', (data) => {
            sendResponse({ profile: data.jobfitProfile || null });
        });
        return true;
    }

    if (message.type === 'SAVE_PROFILE') {
        chrome.storage.local.set({ jobfitProfile: message.profile }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'GET_APP_URL') {
        chrome.storage.local.get('jobfitAppUrl', (data) => {
            sendResponse({ url: data.jobfitAppUrl || 'http://localhost:3000' });
        });
        return true;
    }

    // NEW: Content script reports auto-apply result
    if (message.type === 'AUTO_APPLY_RESULT') {
        console.log('[JobFit AI] Auto Apply result:', message.result);
        // Clear the pending flag
        chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl']);
        sendResponse({ success: true });
        return true;
    }
});

// ─── Badge: show active status ───
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const isSupported = tab.url.includes('vietnamworks.com') || tab.url.includes('topcv.vn');
        if (isSupported) {
            chrome.action.setBadgeText({ text: '⚡', tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#7C3AED', tabId });
        }
    }
});

// ─── Install event ───
chrome.runtime.onInstalled.addListener(() => {
    console.log('[JobFit AI] Extension installed!');
});
