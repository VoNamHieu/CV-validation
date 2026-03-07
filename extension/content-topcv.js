/**
 * JobFit AI — Auto Apply Extension
 * Content Script for TopCV
 */

// ─── Detect job detail page ───
function isJobDetailPage() {
    const url = window.location.href;
    return url.includes('topcv.vn/viec-lam/') &&
        !url.includes('/viec-lam?') &&
        document.querySelector('.btn-apply-job, [class*="apply"]');
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

// ─── Main: Fill TopCV form ───
async function fillTopCVForm(profile) {
    const btn = document.getElementById('jobfit-auto-apply-btn');
    if (btn) { btn.classList.add('filling'); btn.innerHTML = '⏳ Đang điền...'; }

    try {
        // Step 1: Click "Ứng tuyển ngay" button
        showToast('🔍 Đang mở form ứng tuyển...');
        const applyBtn = document.querySelector('.btn-apply-job') ||
            document.querySelector('a[class*="apply"]') ||
            [...document.querySelectorAll('a, button')].find(
                el => el.textContent?.trim().includes('Ứng tuyển ngay')
            );

        if (!applyBtn) {
            showToast('❌ Không tìm thấy nút Ứng tuyển');
            return;
        }
        applyBtn.click();
        await sleep(2000);

        // Step 2: Wait for modal
        const modal = document.querySelector('#modal-apply-cv') ||
            document.querySelector('.modal.show') ||
            document.querySelector('.modal.fade.show');

        if (!modal) {
            showToast('❌ Form ứng tuyển không xuất hiện. Bạn đã đăng nhập chưa?');
            return;
        }

        showToast('📝 Đang điền thông tin...');

        // Step 3: Fill "Họ và tên"
        const nameInput = modal.querySelector('input[name="fullname"]') ||
            modal.querySelector('input[placeholder*="Họ tên"]');
        if (nameInput) {
            fillInput(nameInput, profile.fullName || `${profile.lastName || ''} ${profile.firstName || ''}`.trim());
        }

        // Step 4: Fill "Email"
        const emailInput = modal.querySelector('input[name="email"]') ||
            modal.querySelector('input[placeholder*="Email"]');
        if (emailInput) {
            fillInput(emailInput, profile.email || '');
        }

        // Step 5: Fill "Số điện thoại"
        const phoneInput = modal.querySelector('input[name="phone"]') ||
            modal.querySelector('input[placeholder*="điện thoại"]');
        if (phoneInput) {
            fillInput(phoneInput, profile.phone || '');
        }

        await sleep(300);

        // Step 6: Fill "Địa điểm làm việc mong muốn" (Select2)
        if (profile.desiredLocations?.length > 0) {
            const locationSelect = modal.querySelector('select[name="listCities[]"]') ||
                modal.querySelector('#list-city-upload');

            if (locationSelect) {
                await fillSelect2(locationSelect, profile.desiredLocations);
            } else {
                // Try clicking the select2 container directly
                const select2Container = modal.querySelector('.select2-container') ||
                    modal.querySelector('[class*="select2"]');
                if (select2Container) {
                    select2Container.click();
                    await sleep(400);
                    const searchField = document.querySelector('.select2-search__field');
                    if (searchField) {
                        for (const loc of profile.desiredLocations) {
                            fillInput(searchField, loc);
                            await sleep(500);
                            const result = document.querySelector('.select2-results__option:not(.select2-results__option--disabled)');
                            if (result) result.click();
                            await sleep(300);
                        }
                    }
                }
            }
        }

        await sleep(300);

        // Step 7: Fill "Thư giới thiệu" (Cover Letter)
        const letterTextarea = modal.querySelector('textarea[name="letter"]') ||
            modal.querySelector('#letter') ||
            modal.querySelector('textarea');
        if (letterTextarea && profile.coverLetter) {
            fillInput(letterTextarea, profile.coverLetter);
        }

        await sleep(300);

        // Step 8: Check terms checkbox
        const termsCheckbox = modal.querySelector('#input-employer-data-protection') ||
            modal.querySelector('input[type="checkbox"]');
        if (termsCheckbox && !termsCheckbox.checked) {
            termsCheckbox.click();
            await sleep(100);
            // Some sites need to dispatch change event
            termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await sleep(500);
        showToast('✅ Đã điền xong! Vui lòng kiểm tra và nộp hồ sơ.');

        // Step 9: Show confirmation
        showConfirmation('TopCV', () => {
            const submitBtn = modal.querySelector('#btn-apply') ||
                modal.querySelector('button[type="submit"]') ||
                [...modal.querySelectorAll('button')].find(
                    b => b.textContent?.trim().includes('Nộp hồ sơ')
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
                await fillTopCVForm(data.jobfitProfile);
                // Report success back to background
                chrome.runtime.sendMessage({
                    type: 'AUTO_APPLY_RESULT',
                    result: { success: true, site: 'TopCV', url: window.location.href }
                }).catch(() => { });
            } catch (err) {
                chrome.runtime.sendMessage({
                    type: 'AUTO_APPLY_RESULT',
                    result: { success: false, site: 'TopCV', error: err.message }
                }).catch(() => { });
            }
            return; // Don't show floating button for auto-apply
        }
    } catch (e) {
        console.warn('[JobFit AI] Auto-apply check failed:', e);
    }

    // ── Normal flow: show floating button ──
    const btn = createFloatingButton('TopCV');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const profile = await getProfile();
        if (!profile) {
            showToast('⚠️ Chưa có profile! Mở Extension popup để nhập thông tin.');
            return;
        }
        await fillTopCVForm(profile);
    });
}

init();
