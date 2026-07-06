/**
 * Copo — Auto Apply Extension — Popup Script
 */

// ─── All field IDs ───
const FIELD_IDS = [
    'lastName', 'firstName', 'fullName', 'email', 'phone',
    'dateOfBirth', 'gender', 'nationality', 'maritalStatus',
    'addressProvince', 'addressDistrict', 'addressStreet',
    'currentTitle', 'currentLevel', 'yearsOfExperience', 'highestDegree',
    'currentSalary', 'currentIndustry', 'currentFields',
    'desiredLocations', 'desiredSalary', 'coverLetter', 'appUrl'
];

// ─── Normalize synced values into the fixed <select> options ───
// CV extraction often returns English ("Male", "Vietnamese", "Single") while
// the selects only have Vietnamese options — assigning a non-existent option
// value leaves the select BLANK and the data silently disappears.
const SELECT_VALUE_MAPS = {
    gender: {
        'male': 'Nam', 'm': 'Nam', 'nam': 'Nam',
        'female': 'Nữ', 'f': 'Nữ', 'nữ': 'Nữ', 'nu': 'Nữ',
    },
    nationality: {
        'vietnamese': 'Người Việt Nam', 'vietnam': 'Người Việt Nam',
        'việt nam': 'Người Việt Nam', 'viet nam': 'Người Việt Nam',
        'người việt nam': 'Người Việt Nam',
    },
    maritalStatus: {
        'single': 'Độc thân', 'độc thân': 'Độc thân', 'doc than': 'Độc thân',
        'married': 'Đã kết hôn', 'đã kết hôn': 'Đã kết hôn', 'da ket hon': 'Đã kết hôn',
    },
};

function setFieldValue(el, id, rawValue) {
    let value = String(rawValue);
    if (el.tagName === 'SELECT' && value) {
        const map = SELECT_VALUE_MAPS[id];
        if (map && map[value.trim().toLowerCase()]) {
            value = map[value.trim().toLowerCase()];
        }
        // Still no matching option → add it dynamically instead of dropping data.
        if (![...el.options].some(o => o.value === value)) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            el.appendChild(opt);
        }
    }
    el.value = value;
}

// ─── Load profile from storage ───
function loadProfile() {
    chrome.storage.local.get(['jobfitProfile', 'jobfitProfileSyncedAt'], (data) => {
        const profile = data.jobfitProfile;
        renderSyncStatus(data.jobfitProfileSyncedAt);
        if (!profile) return;

        // Fill simple fields
        for (const id of FIELD_IDS) {
            const el = document.getElementById(id);
            if (!el) continue;

            // Flat keys (sent by the web app) take precedence over the legacy
            // nested `profile.address.*` shape; fall back so old-shape data
            // still imports.
            let value = profile[id];
            if (value === undefined || value === null || value === '') {
                if (id === 'addressProvince') value = profile.address?.province;
                else if (id === 'addressDistrict') value = profile.address?.district;
                else if (id === 'addressStreet') value = profile.address?.street;
            }

            // Arrays may arrive as either string (web app) or array (legacy).
            if ((id === 'desiredLocations' || id === 'currentFields') && Array.isArray(value)) {
                value = value.join(', ');
            }

            if (value !== undefined && value !== null) {
                setFieldValue(el, id, value);
            }
        }

        updateStatus(profile);
    });
}

// ─── Render the "Synced …" line in the Settings → Status card ───
function renderSyncStatus(syncedAt) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    if (!syncedAt) {
        el.textContent = '⚪ Chưa đồng bộ — mở web app và mở step Edit CV.';
        return;
    }
    const ageMs = Date.now() - syncedAt;
    const ageSec = Math.round(ageMs / 1000);
    let label;
    if (ageSec < 5) label = 'vừa xong';
    else if (ageSec < 60) label = `${ageSec}s trước`;
    else if (ageSec < 3600) label = `${Math.round(ageSec / 60)} phút trước`;
    else label = `${Math.round(ageSec / 3600)} giờ trước`;
    el.textContent = `🟢 Đã đồng bộ từ CV · ${label}`;
}

// ─── Save profile to storage ───
function saveProfile() {
    const profile = {};

    for (const id of FIELD_IDS) {
        const el = document.getElementById(id);
        if (!el || id === 'appUrl') continue;
        profile[id] = el.value;
    }

    // Parse structured fields
    profile.address = {
        country: 'Việt Nam',
        province: profile.addressProvince || '',
        district: profile.addressDistrict || '',
        street: profile.addressStreet || '',
    };
    delete profile.addressProvince;
    delete profile.addressDistrict;
    delete profile.addressStreet;

    // Parse comma-separated arrays
    profile.desiredLocations = (profile.desiredLocations || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    profile.currentFields = (profile.currentFields || '')
        .split(',').map(s => s.trim()).filter(Boolean);

    // Parse numbers
    profile.yearsOfExperience = parseInt(profile.yearsOfExperience) || 0;
    profile.currentSalary = parseInt(profile.currentSalary) || 0;
    profile.desiredSalary = parseInt(profile.desiredSalary) || 0;

    chrome.storage.local.set({ jobfitProfile: profile }, () => {
        const btn = document.getElementById('saveBtn');
        btn.textContent = '✅ Đã lưu!';
        btn.classList.add('saved');
        setTimeout(() => {
            btn.textContent = '💾 Lưu Profile';
            btn.classList.remove('saved');
        }, 2000);
        updateStatus(profile);
    });

    // Save app URL separately
    const appUrl = document.getElementById('appUrl')?.value;
    if (appUrl) {
        chrome.storage.local.set({ jobfitAppUrl: appUrl });
    }
}

// ─── Update status card ───
function updateStatus(profile) {
    const statusEl = document.getElementById('statusBody');
    if (!statusEl) return;

    const required = ['lastName', 'firstName', 'email', 'phone'];
    const filled = required.filter(k => profile[k]);
    const filledCount = Object.keys(profile).filter(k => {
        const v = profile[k];
        if (typeof v === 'object') return Object.values(v).some(Boolean);
        if (Array.isArray(v)) return v.length > 0;
        return v !== '' && v !== null && v !== undefined && v !== 0;
    }).length;

    // Safe DOM construction (no innerHTML with user data)
    statusEl.textContent = '';

    const reqLine = document.createElement('div');
    reqLine.style.marginBottom = '6px';
    const reqStrong = document.createElement('strong');
    reqStrong.style.color = filled.length === required.length ? '#22c55e' : '#facc15';
    reqStrong.textContent = `${filled.length === required.length ? '✅' : '⚠️'} Bắt buộc: ${filled.length}/${required.length}`;
    reqLine.appendChild(reqStrong);
    statusEl.appendChild(reqLine);

    const countLine = document.createElement('div');
    countLine.textContent = `📊 Đã điền: ${filledCount} fields`;
    statusEl.appendChild(countLine);

    const missingLine = document.createElement('div');
    missingLine.style.marginTop = '4px';
    missingLine.style.fontSize = '11px';
    const missing = [];
    if (!profile.lastName) missing.push('❌ Thiếu Họ');
    if (!profile.firstName) missing.push('❌ Thiếu Tên');
    if (!profile.email) missing.push('❌ Thiếu Email');
    if (!profile.phone) missing.push('❌ Thiếu SĐT');
    missingLine.textContent = missing.join(' ');
    statusEl.appendChild(missingLine);
}

// ─── Import from Copo App ───
async function importFromApp() {
    const appUrl = document.getElementById('appUrl')?.value || 'https://copoai.net';
    const btn = document.getElementById('importFromApp');
    btn.textContent = '⏳ Loading...';
    btn.disabled = true;

    try {
        const res = await fetch(`${appUrl}/api/export-profile`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.profile) {
            chrome.storage.local.set({ jobfitProfile: data.profile }, () => {
                loadProfile();
                btn.textContent = '✅ Imported!';
                setTimeout(() => { btn.textContent = 'Import'; btn.disabled = false; }, 2000);
            });
        }
    } catch (err) {
        btn.textContent = '❌ Error';
        console.error('[Copo] Import error:', err);
        setTimeout(() => { btn.textContent = 'Import'; btn.disabled = false; }, 2000);
    }
}

// ─── Reset all data ───
function resetAll() {
    if (confirm('Xóa toàn bộ dữ liệu profile?')) {
        chrome.storage.local.remove('jobfitProfile', () => {
            for (const id of FIELD_IDS) {
                const el = document.getElementById(id);
                if (el && id !== 'appUrl') {
                    el.value = id === 'nationality' ? 'Người Việt Nam' : '';
                }
            }
            updateStatus({});
        });
    }
}

// ─── Tab switching ───
function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
    const footer = document.querySelector('.footer');

    const applyFooterVisibility = (tabName) => {
        // "Lưu Profile" only makes sense where profile fields live.
        if (footer) footer.style.display = tabName === 'apply' ? 'none' : '';
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            applyFooterVisibility(tab.dataset.tab);
        });
    });

    applyFooterVisibility(document.querySelector('.tab.active')?.dataset.tab);
}

// ── Tailor progress stepper (replaces the old in-page toast overlay) ────────
// The pipeline is one long background request (extract → score → optimize,
// ~20–60s), so the steps advance on a timer and the final step keeps spinning
// until the real response lands.
const STEP_ADVANCE_MS = [1500, 6000, 9000, 14000, 18000];
let __stepTimers = [];

function progressSteps() {
    return [...document.querySelectorAll('#progressSteps li')];
}

function startTailorProgress() {
    const card = document.getElementById('tailorProgress');
    const steps = progressSteps();
    __stepTimers.forEach(clearTimeout);
    __stepTimers = [];
    card.hidden = false;
    card.className = 'progress-card running';
    document.getElementById('progressTitle').textContent = 'AI đang tối ưu CV của bạn…';
    document.getElementById('progressTip').textContent = 'Mẹo: quá trình này mất khoảng 20–60 giây.';
    document.getElementById('progressAction').hidden = true;
    steps.forEach(li => li.className = '');
    steps[0].classList.add('active');
    // Advance step i → done, i+1 → active on a rough schedule; the last step
    // never auto-completes — finishTailorProgress() resolves it.
    STEP_ADVANCE_MS.forEach((ms, i) => {
        if (i + 1 >= steps.length) return;
        __stepTimers.push(setTimeout(() => {
            steps[i].className = 'done';
            steps[i + 1].className = 'active';
        }, ms));
    });
}

function finishTailorProgress(success, errorMsg) {
    const card = document.getElementById('tailorProgress');
    const steps = progressSteps();
    __stepTimers.forEach(clearTimeout);
    __stepTimers = [];
    const action = document.getElementById('progressAction');
    if (success) {
        steps.forEach(li => li.className = 'done');
        card.className = 'progress-card success';
        document.getElementById('progressTitle').textContent = '✅ CV đã được tối ưu!';
        document.getElementById('progressTip').textContent = 'Mở Copo App để xem CV và ứng tuyển.';
        action.textContent = 'Mở Copo App để xem CV →';
        action.hidden = false;
    } else {
        const current = steps.findIndex(li => li.classList.contains('active'));
        const failedAt = current === -1 ? 0 : current;
        steps.forEach((li, i) => li.className = i < failedAt ? 'done' : (i === failedAt ? 'error' : ''));
        card.className = 'progress-card failed';
        document.getElementById('progressTitle').textContent = 'Tối ưu CV thất bại';
        // Not everything can be tailored inside the extension (SPA shells,
        // login-walled JDs, etc.) — steer the user to the web app to continue.
        document.getElementById('progressTip').textContent =
            `❌ ${errorMsg || 'Không tailor được'} — vui lòng truy cập web để tiếp tục.`;
        action.textContent = 'Mở Copo App để tiếp tục →';
        action.hidden = false;
    }
}

// ── Mode 1: tell the content script on the active job tab to tailor the CV ──
async function tailorCurrentJob() {
    const statusEl = document.getElementById('tailorStatus');
    const btn = document.getElementById('tailorJobBtn');
    btn.disabled = true; btn.textContent = '⏳ Đang tối ưu…'; statusEl.textContent = '';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Mở một trang job (https) trước.');
        startTailorProgress();
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'RUN_MODE1' });
        finishTailorProgress(!!resp?.success, resp?.error);
    } catch (e) {
        finishTailorProgress(false, e.message || String(e));
    } finally {
        btn.disabled = false; btn.textContent = '✨ Tailor CV cho job đang mở';
    }
}

// ── Site access (optional host permissions) ─────────────────────────────────
// Known hosts (mirror of manifest content_scripts.matches) auto-inject; any
// other job site needs a just-in-time grant. The popup is the reliable,
// gesture-valid place to request/revoke these. We track popup-granted origins
// in storage so the card can list + revoke them.
const KNOWN_HOST_RE = /(^|\.)(topcv\.vn|vietnamworks\.com|itviec\.com|careerbuilder\.vn|careerlink\.vn|careerviet\.vn|vieclam24h\.vn|linkedin\.com|lever\.co|greenhouse\.io|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|breezy\.hr|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com)$/i;

let __activeTab = null;

const prettyOrigin = (o) => o === 'https://*/*'
    ? 'Mọi trang tuyển dụng'
    : (o || '').replace(/^(?:\*|https?):\/\//, '').replace(/\/\*$/, '');

async function trackGrant(origin) {
    const { optionalGrants = [] } = await chrome.storage.local.get('optionalGrants');
    if (!optionalGrants.includes(origin)) {
        await chrome.storage.local.set({ optionalGrants: [...optionalGrants, origin] });
    }
}

// Lives in the Settings tab — the Apply-tab perm card only asks for grants.
async function renderGrantedList() {
    const wrap = document.getElementById('grantedList');
    const { optionalGrants = [] } = await chrome.storage.local.get('optionalGrants');
    wrap.innerHTML = '';
    for (const origin of optionalGrants) {
        const has = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
        if (!has) continue;
        const row = document.createElement('div');
        row.className = 'perm-granted-row';
        const label = document.createElement('span');
        label.textContent = prettyOrigin(origin);
        const btn = document.createElement('button');
        btn.className = 'perm-revoke';
        btn.textContent = 'Thu hồi';
        btn.addEventListener('click', async () => {
            await chrome.permissions.remove({ origins: [origin] }).catch(() => { });
            const { optionalGrants: cur = [] } = await chrome.storage.local.get('optionalGrants');
            await chrome.storage.local.set({ optionalGrants: cur.filter(o => o !== origin) });
            renderGrantedList();
            refreshPermUI();
            refreshOnboarding();
        });
        row.append(label, btn);
        wrap.appendChild(row);
    }
    if (!wrap.children.length) {
        const empty = document.createElement('div');
        empty.className = 'perm-granted-empty';
        empty.textContent = 'Chưa cấp quyền cho trang nào.';
        wrap.appendChild(empty);
    }
}

// Reflect the active tab's access state in the card. Once the active tab is
// already covered (known host / all-sites / per-site grant) the whole card
// hides — it only exists to ask for a grant, not to sit there confirming one.
async function refreshPermUI() {
    const card = document.getElementById('permCard');
    const pill = document.getElementById('permPill');
    const siteEl = document.getElementById('permSite');
    const grantBtn = document.getElementById('grantSiteBtn');
    const setPill = (cls, text) => { pill.className = `perm-pill ${cls}`; pill.textContent = text; };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    __activeTab = tab || null;
    let host = '', origin = '', isHttp = false, known = false;
    try {
        const u = new URL(tab?.url || '');
        isHttp = /^https?:$/.test(u.protocol);
        host = u.hostname; origin = `${u.origin}/*`;
        known = KNOWN_HOST_RE.test(host);
    } catch (e) { /* non-web tab */ }

    // "All job sites" opt-in covers everything — the recommended path for the
    // featured pool, whose company career pages live on hundreds of bespoke
    // domains we can't statically allowlist.
    const allGranted = await chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
    if (allGranted) {
        card.hidden = true;
        return;
    }

    if (!isHttp) {
        card.hidden = false;
        siteEl.textContent = 'Mở một trang tuyển dụng (https) để cấp quyền.';
        setPill('muted', '—');
        grantBtn.disabled = true;
        return;
    }

    const siteGranted = known
        || await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
    if (siteGranted) {
        card.hidden = true;
        return;
    }

    card.hidden = false;
    siteEl.textContent = host;
    const grantAllBtn = document.getElementById('grantAllBtn');
    if (grantAllBtn) grantAllBtn.disabled = false;
    setPill('warn', 'Cần cấp quyền');
    grantBtn.disabled = false;
}

async function grantCurrentSite() {
    const statusEl = document.getElementById('grantStatus');
    if (!__activeTab || !/^https?:/.test(__activeTab.url || '')) {
        statusEl.textContent = '⚠️ Mở một trang tuyển dụng (https) trước.';
        return;
    }
    try {
        const origin = `${new URL(__activeTab.url).origin}/*`;
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) { statusEl.textContent = '❌ Bạn đã từ chối cấp quyền.'; return; }
        await trackGrant(origin);
        statusEl.textContent = '✅ Đã cấp — agent có thể chạy trên trang này.';
        // Inject now so a job already open on this tab can start (no-op on known
        // hosts where the declarative content script already loaded).
        try {
            await chrome.scripting.insertCSS({ target: { tabId: __activeTab.id }, files: ['content.css'] });
            await chrome.scripting.executeScript({ target: { tabId: __activeTab.id }, files: ['utils.js', 'content-agent.js'] });
        } catch (e) { /* already present (declarative) — ignore */ }
        renderGrantedList();
        // Let the ✅ line breathe before the card hides itself.
        setTimeout(refreshPermUI, 1400);
    } catch (e) {
        statusEl.textContent = `❌ ${e.message || e}`;
    }
}

async function grantAllSites() {
    const statusEl = document.getElementById('grantStatus');
    try {
        const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
        if (!granted) { statusEl.textContent = '❌ Bạn đã từ chối cấp quyền.'; return; }
        await trackGrant('https://*/*');
        statusEl.textContent = '✅ Đã cấp quyền cho mọi trang tuyển dụng.';
        renderGrantedList();
        setTimeout(refreshPermUI, 1400);
        refreshOnboarding();
    } catch (e) {
        statusEl.textContent = `❌ ${e.message || e}`;
    }
}

// ── One-time all-sites onboarding ───────────────────────────────────────────
// The banner is the frictionless path to a single "https://*/*" grant, which
// makes ensureHostAccess() pass on every job site forever — no per-site prompt.
// Shown until the user grants it (permission check) or explicitly dismisses.
async function refreshOnboarding() {
    const banner = document.getElementById('allSitesOnboard');
    if (!banner) return;
    const allGranted = await chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
    const { allSitesOnboardDismissed = false } = await chrome.storage.local.get('allSitesOnboardDismissed');
    banner.hidden = allGranted || allSitesOnboardDismissed;
}

async function onboardGrantAll() {
    const statusEl = document.getElementById('onboardStatus');
    const btn = document.getElementById('onboardGrantBtn');
    try {
        // Must run synchronously off the click gesture — request first, then UI.
        const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
        btn.disabled = true;
        if (!granted) {
            statusEl.textContent = '❌ Bạn đã từ chối — có thể bật lại trong tab Apply job bất cứ lúc nào.';
            btn.disabled = false;
            return;
        }
        await trackGrant('https://*/*');
        statusEl.textContent = '✅ Đã bật! Auto Apply chạy được trên mọi trang tuyển dụng.';
        renderGrantedList();
        refreshPermUI();
        setTimeout(refreshOnboarding, 1400);
    } catch (e) {
        statusEl.textContent = `❌ ${e.message || e}`;
        btn.disabled = false;
    }
}

async function dismissOnboarding() {
    await chrome.storage.local.set({ allSitesOnboardDismissed: true });
    refreshOnboarding();
}


document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadProfile();

    // Live-refresh when background.js writes a new profile (auto-sync from web app).
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'PROFILE_UPDATED') {
            loadProfile();
        }
    });
    // Keep the relative timestamp ("3 phút trước") fresh while the popup is open.
    setInterval(() => {
        chrome.storage.local.get('jobfitProfileSyncedAt', (data) => {
            renderSyncStatus(data.jobfitProfileSyncedAt);
        });
    }, 15000);

    // Load app URL + point the header links ("Copo" logo + "Mở app") at it, so
    // the quick-jump matches whatever App URL the user configured. Falls back to
    // the production URL already hardcoded in the markup.
    chrome.storage.local.get('jobfitAppUrl', (data) => {
        if (data.jobfitAppUrl) {
            document.getElementById('appUrl').value = data.jobfitAppUrl;
            const href = data.jobfitAppUrl.replace(/\/+$/, '') + '/';
            document.querySelectorAll('[data-app-link]').forEach((a) => { a.href = href; });
        }
    });

    document.getElementById('saveBtn').addEventListener('click', saveProfile);
    document.getElementById('importFromApp').addEventListener('click', importFromApp);
    document.getElementById('resetAll').addEventListener('click', resetAll);
    document.getElementById('tailorJobBtn').addEventListener('click', tailorCurrentJob);
    document.getElementById('grantSiteBtn').addEventListener('click', grantCurrentSite);
    document.getElementById('grantAllBtn').addEventListener('click', grantAllSites);
    document.getElementById('onboardGrantBtn').addEventListener('click', onboardGrantAll);
    document.getElementById('onboardDismissBtn').addEventListener('click', dismissOnboarding);
    refreshPermUI();
    refreshOnboarding();
    renderGrantedList();

    // CV upload
    const cvFileInput = document.getElementById('cvFileInput');
    const uploadCvBtn = document.getElementById('uploadCvBtn');
    const cvFileNameEl = document.getElementById('cvFileName');

    // Load existing CV name
    chrome.storage.local.get('cvFileName', (data) => {
        if (data.cvFileName) {
            cvFileNameEl.textContent = data.cvFileName;
            uploadCvBtn.textContent = 'Change';
        }
    });

    uploadCvBtn.addEventListener('click', () => cvFileInput.click());
    cvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            alert('File quá lớn (tối đa 5MB).');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data:...;base64, prefix
            chrome.storage.local.set({
                cvFileBase64: base64,
                cvFileName: file.name,
            }, () => {
                cvFileNameEl.textContent = file.name;
                uploadCvBtn.textContent = '✅ Uploaded';
                setTimeout(() => { uploadCvBtn.textContent = 'Change'; }, 2000);
            });
        };
        reader.readAsDataURL(file);
    });
});
