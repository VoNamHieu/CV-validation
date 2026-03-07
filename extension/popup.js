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

// ─── Load profile from storage ───
function loadProfile() {
    chrome.storage.local.get('jobfitProfile', (data) => {
        const profile = data.jobfitProfile;
        if (!profile) return;

        // Fill simple fields
        for (const id of FIELD_IDS) {
            const el = document.getElementById(id);
            if (!el) continue;

            let value = profile[id];

            // Handle nested address
            if (id === 'addressProvince') value = profile.address?.province;
            else if (id === 'addressDistrict') value = profile.address?.district;
            else if (id === 'addressStreet') value = profile.address?.street;

            // Handle arrays
            if (id === 'desiredLocations' && Array.isArray(profile.desiredLocations)) {
                value = profile.desiredLocations.join(', ');
            }
            if (id === 'currentFields' && Array.isArray(profile.currentFields)) {
                value = profile.currentFields.join(', ');
            }

            if (value !== undefined && value !== null) {
                el.value = String(value);
            }
        }

        updateStatus(profile);
    });
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
    const appUrl = document.getElementById('appUrl')?.value || 'http://localhost:3000';
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
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadProfile();

    // Load app URL
    chrome.storage.local.get('jobfitAppUrl', (data) => {
        if (data.jobfitAppUrl) {
            document.getElementById('appUrl').value = data.jobfitAppUrl;
        }
    });

    document.getElementById('saveBtn').addEventListener('click', saveProfile);
    document.getElementById('importFromApp').addEventListener('click', importFromApp);
    document.getElementById('resetAll').addEventListener('click', resetAll);
});
