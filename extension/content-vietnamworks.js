/**
 * JobFit AI — Auto Apply Extension
 * Content Script for VietnamWorks
 */

// ─── Detect job detail page ───
function isJobDetailPage() {
    const url = window.location.href;
    return url.includes('vietnamworks.com/') &&
        !url.includes('/viec-lam?') &&
        !url.includes('/login') &&
        document.querySelector('[class*="apply"], .job-detail, .job-header, h1');
}

// ─── Wait for element to appear ───
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
}

// ─── Toast notification ───
function showToast(msg, duration = 3000) {
    const old = document.getElementById('jobfit-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'jobfit-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
}

// ─── Main: Fill VietnamWorks form ───
async function fillVietnamWorksForm(profile) {
    const btn = document.getElementById('jobfit-auto-apply-btn');
    if (btn) { btn.classList.add('filling'); btn.innerHTML = '⏳ Đang điền...'; }

    try {
        // Step 1: Click "Nộp đơn" button
        showToast('🔍 Đang mở form ứng tuyển...');
        const applyBtn = document.querySelector(
            'button[class*="apply"], a[class*="apply"], [class*="btn-apply"], button:has(> span)'
        ) || [...document.querySelectorAll('button, a')].find(
            el => el.textContent?.trim().includes('Nộp đơn') || el.textContent?.trim().includes('Ứng tuyển')
        );

        if (!applyBtn) {
            showToast('❌ Không tìm thấy nút Nộp đơn');
            return;
        }
        applyBtn.click();
        await sleep(2000);

        // Step 2: Skip AI prompt — click "Tiếp tục ứng tuyển"
        const continueBtn = [...document.querySelectorAll('button, a')].find(
            el => el.textContent?.trim().includes('Tiếp tục ứng tuyển')
        );
        if (continueBtn) {
            continueBtn.click();
            await sleep(2000);
        }

        showToast('📝 Đang điền thông tin...');

        // Step 3: Select CV (choose first available radio or uploaded CV)
        const cvRadios = document.querySelectorAll('input[name="apply-type"]');
        if (cvRadios.length > 1) {
            // Prefer uploaded PDF (index 1) over online profile
            cvRadios[cvRadios.length - 1].click();
            await sleep(300);
        }

        // Step 4: Fill personal info
        // Find all visible inputs and fill by placeholder/label
        const allInputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');

        for (const input of allInputs) {
            if (input.offsetParent === null) continue; // hidden
            const placeholder = (input.placeholder || '').toLowerCase();
            const label = input.closest('.form-group, [class*="field"]')?.querySelector('label')?.textContent?.toLowerCase() || '';

            if (placeholder.includes('họ') || label.includes('họ')) {
                fillInput(input, profile.lastName || '');
            } else if (placeholder.includes('tên') || label.includes('tên')) {
                fillInput(input, profile.firstName || '');
            } else if (placeholder.includes('chức danh') || label.includes('chức danh')) {
                fillInput(input, profile.currentTitle || '');
            } else if (placeholder.includes('kinh nghiệm') || label.includes('kinh nghiệm')) {
                fillInput(input, String(profile.yearsOfExperience || 0));
            } else if (placeholder.includes('lương') && !placeholder.includes('mong muốn')) {
                fillInput(input, String(profile.currentSalary || ''));
            } else if (placeholder.includes('địa chỉ') || label.includes('địa chỉ')) {
                fillInput(input, profile.address?.street || '');
            } else if (placeholder.includes('dd/mm/yyyy') || label.includes('ngày sinh')) {
                fillInput(input, profile.dateOfBirth || '');
            }
        }

        // Phone number
        const phoneInput = document.querySelector('input[type="tel"]');
        if (phoneInput && phoneInput.offsetParent !== null) {
            fillInput(phoneInput, profile.phone || '');
        }

        await sleep(500);

        // Step 5: Dropdowns
        // Bằng cấp cao nhất
        const degreeDropdowns = [...document.querySelectorAll('[class*="dropdown"], [class*="select"], [class*="picker"]')].filter(
            el => el.offsetParent !== null && (
                el.closest('[class*="field"]')?.textContent?.includes('Bằng cấp') ||
                el.textContent?.includes('Vui lòng chọn')
            )
        );

        // Try to find and fill degree
        if (profile.highestDegree) {
            const degreeField = [...document.querySelectorAll('*')].find(
                el => el.offsetParent !== null && el.textContent?.trim() === 'Bằng cấp cao nhất' && el.tagName !== 'SCRIPT'
            );
            if (degreeField) {
                const dropdown = degreeField.nextElementSibling || degreeField.parentElement?.querySelector('[class*="select"], [class*="dropdown"]');
                if (dropdown) {
                    await selectDropdownOption(dropdown, profile.highestDegree);
                    await sleep(300);
                }
            }
        }

        // Step 6: Toggle buttons — Gender
        if (profile.gender) {
            const genderSection = [...document.querySelectorAll('*')].find(
                el => el.offsetParent !== null && el.textContent?.trim() === 'Giới tính' && el.tagName !== 'SCRIPT'
            );
            if (genderSection) {
                const container = genderSection.closest('[class*="field"]') || genderSection.parentElement;
                if (container) {
                    const targetBtn = [...container.querySelectorAll('button')].find(
                        b => b.textContent?.trim() === profile.gender
                    );
                    if (targetBtn) targetBtn.click();
                }
            }
        }

        // Marital status
        if (profile.maritalStatus) {
            const maritalSection = [...document.querySelectorAll('*')].find(
                el => el.offsetParent !== null && el.textContent?.trim().includes('Tình trạng hôn nhân') && el.tagName !== 'SCRIPT'
            );
            if (maritalSection) {
                const container = maritalSection.closest('[class*="field"]') || maritalSection.parentElement;
                if (container) {
                    const targetBtn = [...container.querySelectorAll('button')].find(
                        b => b.textContent?.trim() === profile.maritalStatus
                    );
                    if (targetBtn) targetBtn.click();
                }
            }
        }

        await sleep(300);

        // Step 7: Check privacy checkbox
        const privacyCheckbox = document.querySelector('input[type="checkbox"]');
        if (privacyCheckbox && !privacyCheckbox.checked) {
            privacyCheckbox.click();
        }

        await sleep(500);
        showToast('✅ Đã điền xong! Vui lòng kiểm tra và nộp đơn.');

        // Step 8: Show confirmation
        showConfirmation('VietnamWorks', () => {
            // Find and click submit button
            const submitBtn = document.querySelector('.apply-in-form-btn') ||
                [...document.querySelectorAll('button')].find(
                    b => b.textContent?.trim() === 'Ứng tuyển' && b.offsetParent !== null
                );
            if (submitBtn) submitBtn.click();
            showToast('🎉 Đã nộp đơn thành công!');
        }, () => {
            showToast('⏸️ Đã hủy. Bạn có thể chỉnh sửa và nộp thủ công.');
        });

    } catch (err) {
        console.error('[JobFit AI] Error:', err);
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        if (btn) { btn.classList.remove('filling'); btn.innerHTML = '⚡ Auto Apply'; }
    }
}

// ─── Initialize ───
async function init() {
    // Wait for page to fully load
    await sleep(1500);

    if (!isJobDetailPage()) return;

    // ── Check for pending auto-apply from web app ──
    try {
        const data = await new Promise((resolve) => {
            chrome.storage.local.get(['pendingAutoApply', 'jobfitProfile'], resolve);
        });

        if (data.pendingAutoApply && data.jobfitProfile) {
            // Clear the flag immediately to prevent re-triggering
            await new Promise((resolve) => {
                chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl'], resolve);
            });

            showToast('🚀 Auto Apply đang chạy...');
            await sleep(500);

            try {
                await fillVietnamWorksForm(data.jobfitProfile);
                // Report success back to background
                chrome.runtime.sendMessage({
                    type: 'AUTO_APPLY_RESULT',
                    result: { success: true, site: 'VietnamWorks', url: window.location.href }
                }).catch(() => { });
            } catch (err) {
                chrome.runtime.sendMessage({
                    type: 'AUTO_APPLY_RESULT',
                    result: { success: false, site: 'VietnamWorks', error: err.message }
                }).catch(() => { });
            }
            return; // Don't show floating button for auto-apply
        }
    } catch (e) {
        console.warn('[JobFit AI] Auto-apply check failed:', e);
    }

    // ── Normal flow: show floating button ──
    const btn = createFloatingButton('VietnamWorks');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const profile = await getProfile();
        if (!profile) {
            showToast('⚠️ Chưa có profile! Mở Extension popup để nhập thông tin.');
            return;
        }
        await fillVietnamWorksForm(profile);
    });
}

init();
