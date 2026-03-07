/**
 * JobFit AI — Auto Apply Extension
 * Shared utility functions for form filling
 */

// ─── Delay helper ───
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Set text input value and trigger React/Vue change events ───
function fillInput(el, value) {
    if (!el || !value) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
        nativeSetter.call(el, value);
    } else {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
}

// ─── Click a custom dropdown, wait for list, then click matching option ───
async function selectDropdownOption(triggerEl, optionText, waitMs = 500) {
    if (!triggerEl) return false;
    triggerEl.click();
    await sleep(waitMs);

    // Look for radio buttons or list items containing the text
    const allLabels = document.querySelectorAll('label, li, [role="option"], .option-item');
    for (const label of allLabels) {
        if (label.offsetParent !== null && label.textContent?.trim().includes(optionText)) {
            const radio = label.querySelector('input[type="radio"], input[type="checkbox"]');
            if (radio) {
                radio.click();
            } else {
                label.click();
            }
            await sleep(200);
            return true;
        }
    }
    return false;
}

// ─── Click a toggle button by its text ───
function clickToggleButton(containerSelector, buttonText) {
    const container = typeof containerSelector === 'string'
        ? document.querySelector(containerSelector)
        : containerSelector;
    if (!container) return false;

    const buttons = container.querySelectorAll('button, [role="button"], .btn');
    for (const btn of buttons) {
        if (btn.textContent?.trim() === buttonText) {
            btn.click();
            return true;
        }
    }
    return false;
}

// ─── Search in a searchable dropdown picker ───
async function searchAndSelect(triggerEl, searchText, waitMs = 500) {
    if (!triggerEl) return false;
    triggerEl.click();
    await sleep(waitMs);

    // Find search input that appeared
    const searchInput = document.querySelector(
        '.search-input, [type="search"], input[placeholder*="Tìm"], input[placeholder*="tìm"], input[placeholder*="Search"]'
    );
    if (searchInput) {
        fillInput(searchInput, searchText);
        await sleep(600); // wait for filter

        // Click first matching result
        const results = document.querySelectorAll('li, [role="option"], .option-item, label');
        for (const result of results) {
            if (result.offsetParent !== null && result.textContent?.trim().includes(searchText)) {
                const input = result.querySelector('input[type="radio"], input[type="checkbox"]');
                if (input) input.click();
                else result.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

// ─── Fill Select2 dropdown (TopCV style) ───
async function fillSelect2(selectEl, values, waitMs = 400) {
    if (!selectEl) return false;

    // Find the select2 container
    const container = selectEl.closest('.form-group')
        || selectEl.parentElement;
    const select2Input = container?.querySelector('.select2-search__field')
        || container?.querySelector('.select2-search input');

    if (select2Input) {
        for (const val of (Array.isArray(values) ? values : [values])) {
            select2Input.focus();
            select2Input.click();
            await sleep(300);
            fillInput(select2Input, val);
            await sleep(waitMs);

            // Click matching result in dropdown
            const results = document.querySelectorAll('.select2-results__option');
            for (const r of results) {
                if (r.textContent?.trim().includes(val)) {
                    r.click();
                    await sleep(200);
                    break;
                }
            }
        }
        return true;
    }
    return false;
}

// ─── Create floating action button ───
function createFloatingButton(siteName) {
    // Don't add if already exists
    if (document.getElementById('jobfit-auto-apply-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'jobfit-auto-apply-btn';
    btn.innerHTML = `⚡ Auto Apply`;
    btn.title = `JobFit AI — Auto Apply (${siteName})`;
    document.body.appendChild(btn);
    return btn;
}

// ─── Create confirmation overlay ───
function showConfirmation(siteName, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.id = 'jobfit-confirm-overlay';
    overlay.innerHTML = `
    <div class="jobfit-confirm-card">
      <div class="jobfit-confirm-header">
        <span>⚡</span> JobFit AI — Auto Apply
      </div>
      <div class="jobfit-confirm-body">
        <p>Form đã được điền tự động trên <strong>${siteName}</strong>.</p>
        <p style="color: #facc15; font-size: 13px;">⚠️ Vui lòng kiểm tra lại thông tin trước khi nộp.</p>
      </div>
      <div class="jobfit-confirm-actions">
        <button class="jobfit-btn-cancel">Hủy</button>
        <button class="jobfit-btn-submit">✅ Nộp đơn</button>
      </div>
    </div>
  `;
    document.body.appendChild(overlay);

    overlay.querySelector('.jobfit-btn-submit').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });

    overlay.querySelector('.jobfit-btn-cancel').addEventListener('click', () => {
        overlay.remove();
        if (onCancel) onCancel();
    });

    return overlay;
}

// ─── Get stored profile from chrome.storage ───
function getProfile() {
    return new Promise((resolve) => {
        chrome.storage.local.get('jobfitProfile', (data) => {
            resolve(data.jobfitProfile || null);
        });
    });
}

// ─── Save profile to chrome.storage ───
function saveProfile(profile) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ jobfitProfile: profile }, resolve);
    });
}
