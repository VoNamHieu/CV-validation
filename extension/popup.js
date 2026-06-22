/**
 * JobFit AI — Auto Apply Extension — Popup Script
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

// ─── Import from JobFit AI App ───
async function importFromApp() {
    const appUrl = document.getElementById('appUrl')?.value || 'https://cv-validation.vercel.app';
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
        console.error('[JobFit AI] Import error:', err);
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

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

// ─── Init ───
// ── Debug capture ──────────────────────────────────────────────────────────
// Runs IN the page (injected) and returns a snapshot of the rendered DOM so we
// can build/repair extractors against what a real browser actually sees.
function __captureSnapshot() {
    const firstLine = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
    const anchors = [...document.querySelectorAll('a[href]')].slice(0, 1500).map(a => ({
        href: a.href,
        text: firstLine(a.innerText).slice(0, 160),
    }));
    const tables = [...document.querySelectorAll('table')].slice(0, 20).map(t =>
        [...t.querySelectorAll('tr')].slice(0, 80).map(r =>
            [...r.querySelectorAll('th,td')].map(c => firstLine(c.innerText).slice(0, 120))
        )
    );
    const nd = document.getElementById('__NEXT_DATA__');
    const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .slice(0, 10).map(s => (s.textContent || '').slice(0, 100000));
    return {
        url: location.href,
        title: document.title || '',
        html: document.documentElement.outerHTML,
        anchors,
        tables,
        nextData: nd ? (nd.textContent || '').slice(0, 500000) : '',
        jsonld,
    };
}

async function captureForDebug() {
    const statusEl = document.getElementById('debugStatus');
    const btn = document.getElementById('debugCaptureBtn');
    const backendUrl = (document.getElementById('debugBackendUrl').value || '').trim().replace(/\/+$/, '');
    const token = (document.getElementById('debugToken').value || '').trim();
    if (!backendUrl || !token) {
        statusEl.textContent = '⚠️ Nhập Backend URL + Token trước.';
        return;
    }
    chrome.storage.local.set({ debugBackendUrl: backendUrl, debugToken: token });
    btn.disabled = true; btn.textContent = '⏳ Đang chụp…'; statusEl.textContent = '';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Tab không hợp lệ');
        const [{ result: snap }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: __captureSnapshot,
        });
        const res = await fetch(`${backendUrl}/debug/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Token': token },
            body: JSON.stringify(snap),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        statusEl.textContent = `✅ Đã gửi ${data.host} · ${Math.round((data.bytes || 0) / 1024)}KB · ${data.anchors} links · ${data.tables} bảng`;
    } catch (e) {
        statusEl.textContent = `❌ ${e.message || e}`;
    } finally {
        btn.disabled = false; btn.textContent = '🐞 Gửi DOM để debug';
    }
}

const __sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function __waitTabComplete(tabId, timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.status === 'complete') return true;
        } catch (e) {
            return false; // tab gone
        }
        await __sleep(400);
    }
    return false;
}

// Walk the backend's target list: open each in a background tab, let the SPA
// render, capture the DOM, POST it, close the tab. One at a time so we don't
// spawn 17 tabs at once.
async function batchCapture() {
    const statusEl = document.getElementById('debugStatus');
    const btn = document.getElementById('debugBatchBtn');
    const backendUrl = (document.getElementById('debugBackendUrl').value || '').trim().replace(/\/+$/, '');
    const token = (document.getElementById('debugToken').value || '').trim();
    if (!backendUrl || !token) { statusEl.textContent = '⚠️ Nhập Backend URL + Token trước.'; return; }
    chrome.storage.local.set({ debugBackendUrl: backendUrl, debugToken: token });
    btn.disabled = true;
    const hdr = { 'X-Debug-Token': token };
    let targets;
    try {
        const res = await fetch(`${backendUrl}/debug/capture/targets`, { headers: hdr });
        targets = (await res.json()).targets || [];
    } catch (e) {
        statusEl.textContent = `❌ Không lấy được target: ${e.message || e}`;
        btn.disabled = false; return;
    }
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        statusEl.textContent = `⏳ ${i + 1}/${targets.length} ${t.name}…  (✅${ok} ❌${fail})`;
        let tab;
        try {
            tab = await chrome.tabs.create({ url: t.url, active: false });
            await __waitTabComplete(tab.id);
            await __sleep(6500); // let the SPA fetch + render its jobs
            const [{ result: snap }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id }, func: __captureSnapshot,
            });
            const r = await fetch(`${backendUrl}/debug/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...hdr },
                body: JSON.stringify(snap),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            ok++;
        } catch (e) {
            fail++;
        } finally {
            if (tab) { try { await chrome.tabs.remove(tab.id); } catch (e) { /* noop */ } }
        }
    }
    statusEl.textContent = `✅ Xong: ${ok} gửi, ${fail} lỗi / ${targets.length} site.`;
    btn.disabled = false;
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

    // Load app URL
    chrome.storage.local.get('jobfitAppUrl', (data) => {
        if (data.jobfitAppUrl) {
            document.getElementById('appUrl').value = data.jobfitAppUrl;
        }
    });

    document.getElementById('saveBtn').addEventListener('click', saveProfile);
    document.getElementById('importFromApp').addEventListener('click', importFromApp);
    document.getElementById('resetAll').addEventListener('click', resetAll);

    // Debug capture: restore saved backend URL + token, wire the button.
    chrome.storage.local.get(['debugBackendUrl', 'debugToken'], (d) => {
        if (d.debugBackendUrl) document.getElementById('debugBackendUrl').value = d.debugBackendUrl;
        if (d.debugToken) document.getElementById('debugToken').value = d.debugToken;
    });
    document.getElementById('debugCaptureBtn').addEventListener('click', captureForDebug);
    document.getElementById('debugBatchBtn').addEventListener('click', batchCapture);

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
