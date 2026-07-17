// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { setFileOnInput, setNativeValue, simulateTyping, sleep } from './dom.js';

/**
 * Handle React Select: click to open, type to search, select matching option.
 */
export async function handleReactSelect(el, value) {
    const container = el.closest('[class*="react-select"]') || el.parentElement;
    if (!container) return false;

    // Click the control to open
    const control = container.querySelector('[class*="-control"]') || container;
    control.click();
    await sleep(400);

    // Find the input inside
    const input = container.querySelector('input');
    if (input) {
        setNativeValue(input, value);
        await sleep(500);
    }

    // Click the first matching option
    const options = document.querySelectorAll('[class*="-option"]');
    for (const opt of options) {
        if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

/**
 * Handle MUI Autocomplete/Select.
 */
export async function handleMuiAutocomplete(el, value) {
    const container = el.closest('[class*="MuiAutocomplete"]') || el.closest('.MuiSelect-root') || el.parentElement;
    if (!container) return false;

    const input = container.querySelector('input') || el;
    input.focus();
    input.click();
    await sleep(400);

    if (input.tagName === 'INPUT') {
        setNativeValue(input, value);
        await sleep(500);
    }

    // Look for MUI listbox options
    const listbox = document.querySelector('[role="listbox"]');
    if (listbox) {
        const options = listbox.querySelectorAll('[role="option"], li');
        for (const opt of options) {
            if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
                opt.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

/**
 * Handle Ant Design Select.
 */
export async function handleAntSelect(el, value) {
    const container = el.closest('.ant-select') || el.parentElement;
    if (!container) return false;

    const selector = container.querySelector('.ant-select-selector') || container;
    selector.click();
    await sleep(400);

    const searchInput = document.querySelector('.ant-select-dropdown input, .ant-select-search__field');
    if (searchInput) {
        setNativeValue(searchInput, value);
        await sleep(500);
    }

    const options = document.querySelectorAll('.ant-select-item-option');
    for (const opt of options) {
        if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

/**
 * Handle Select2 dropdown.
 */
export async function handleSelect2(el, value) {
    const container = el.closest('.form-group') || el.parentElement;
    // Operator precedence: `||` binds tighter than `?:`, so this needs explicit grouping
    // to avoid select2Container always being el.nextElementSibling.
    const fromContainer = container?.querySelector('.select2-container') || null;
    const fromSibling = el.nextElementSibling?.classList?.contains('select2-container')
        ? el.nextElementSibling
        : null;
    const select2Container = fromContainer || fromSibling;

    if (select2Container) {
        select2Container.click();
        await sleep(400);
    } else {
        // Try opening via the hidden select
        const event = new Event('select2:open', { bubbles: true });
        el.dispatchEvent(event);
        await sleep(400);
    }

    const searchInput = document.querySelector('.select2-search__field, .select2-search input');
    if (searchInput) {
        setNativeValue(searchInput, value);
        await sleep(500);

        const results = document.querySelectorAll('.select2-results__option');
        for (const r of results) {
            if (r.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
                r.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

/**
 * Handle custom dropdown (role=combobox, etc).
 */
export async function handleCustomDropdown(el, value) {
    el.click();
    await sleep(400);

    const allOptions = document.querySelectorAll(
        '[role="option"], li, label, .option-item, [class*="option"]'
    );
    for (const opt of allOptions) {
        if (opt.offsetParent !== null && opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            const radio = opt.querySelector('input[type="radio"], input[type="checkbox"]');
            if (radio) radio.click();
            else opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

/**
 * Handle a radio group: click the radio whose label/value matches `value`.
 * Accepts either the group name (when called with a name string selector)
 * or any radio element in the group.
 */
export async function handleRadioGroup(elOrName, value) {
    const name = typeof elOrName === 'string'
        ? elOrName
        : (elOrName.name || '');
    const radios = name
        ? document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)
        : (elOrName instanceof Element ? [elOrName] : []);
    if (!radios.length) return false;

    const lower = String(value ?? '').toLowerCase().trim();
    if (!lower) return false;

    let match = null;
    let fallback = null;
    for (const r of radios) {
        const lblEl = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
        const lblText = (lblEl?.textContent?.trim() ||
            r.closest('label')?.textContent?.trim() ||
            r.value || '').toLowerCase();
        if (String(r.value).toLowerCase() === lower) { match = r; break; }
        if (lblText === lower) { match = r; break; }
        if (!fallback && (lblText.includes(lower) || lower.includes(lblText))) fallback = r;
    }
    const target = match || fallback;
    if (!target) return false;

    target.click();
    if (!target.checked) {
        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}

/**
 * Handle a checkbox: toggle to match `value` (truthy → checked).
 */
export async function handleCheckbox(el, value) {
    const want = value === true || value === 1 ||
        ['true', 'yes', '1', 'on', 'checked', 'có', 'đồng ý'].includes(
            String(value ?? '').toLowerCase().trim()
        );
    if (el.checked !== want) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: File Upload
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a single fill instruction, choosing the right strategy based on component type.
 */
export async function executeSingleInstruction(inst, cvData) {
    const el = document.querySelector(inst.selector);
    if (!el) {
        console.warn(`[Copo Agent] Selector not found: ${inst.selector}`);
        return false;
    }

    const action = inst.action;
    const value = inst.value;
    const componentType = inst.componentType || 'native';

    // Never fill credential inputs — profile data must not end up in a
    // password box, and page text can't talk the planner into it (the server
    // also filters these, this is the last line of defense).
    if (el.type === 'password') {
        console.warn(`[Copo Agent] Refusing to fill password field: ${inst.selector}`);
        return false;
    }

    try {
        // File upload
        if (action === 'upload') {
            if (cvData?.base64 && cvData?.fileName) {
                return setFileOnInput(el, cvData.base64, cvData.fileName);
            }
            console.warn('[Copo Agent] Upload requested but no CV data available');
            return false;
        }

        // Click (for buttons, navigation)
        if (action === 'click') {
            el.click();
            return true;
        }

        // Radio group
        if (action === 'radio' || componentType === 'radio-group') {
            return await handleRadioGroup(inst.name || el, value);
        }

        // Checkbox
        if (action === 'checkbox' || componentType === 'checkbox') {
            return await handleCheckbox(el, value);
        }

        // Custom select based on componentType
        if (action === 'custom-select' || action === 'select') {
            switch (componentType) {
                case 'react-select': return await handleReactSelect(el, value);
                case 'mui-autocomplete': return await handleMuiAutocomplete(el, value);
                case 'ant-select': return await handleAntSelect(el, value);
                case 'select2': return await handleSelect2(el, value);
                case 'custom-dropdown': return await handleCustomDropdown(el, value);
                case 'native-select':
                default:
                    if (el.tagName === 'SELECT') {
                        // Match by option value first, then by visible text — the LLM
                        // often returns the label rather than the underlying value.
                        const wanted = String(value).trim().toLowerCase();
                        const opt = [...el.options].find(o =>
                            o.value.trim().toLowerCase() === wanted ||
                            o.textContent.trim().toLowerCase() === wanted
                        ) || [...el.options].find(o =>
                            o.textContent.trim().toLowerCase().includes(wanted)
                        );
                        if (!opt) return false;  // no match — report failure so retry logic kicks in
                        el.value = opt.value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    // If it's action=select but not a native select, try custom
                    return await handleCustomDropdown(el, value);
            }
        }

        // Datepicker
        if (action === 'datepicker') {
            // Try native value set first
            setNativeValue(el, value);
            await sleep(200);
            // Verify
            if (el.value === value) return true;
            // Fallback: simulate typing. Datepickers routinely reformat what we
            // type (2024-01-02 → 02/01/2024), so "non-empty" is the honest check.
            await simulateTyping(el, value);
            return String(el.value || '').trim() !== '';
        }

        // Fill / Type (text input, textarea)
        if (action === 'fill' || action === 'type') {
            setNativeValue(el, value);
            await sleep(100);

            // Verify the value stuck
            if (el.value === value) return true;

            // Fallback: simulate typing
            console.log('[Copo Agent] Value did not stick, trying keyboard simulation');
            await simulateTyping(el, value);
            // Verify again — claiming success here without checking inflates the
            // `filled` count the planner sees and hides persistently-broken fields.
            // Input masks may reformat (phone → "(+84) ..."), so accept any
            // non-empty value as "stuck".
            if (el.value === value) return true;
            return String(el.value || '').trim() !== '';
        }

        console.warn(`[Copo Agent] Unknown action: ${action}`);
        return false;
    } catch (err) {
        console.warn(`[Copo Agent] Failed to execute:`, inst, err);
        return false;
    }
}

/**
 * Execute a batch of fill instructions.
 */
export async function executeFillInstructions(instructions, cvData) {
    let filled = 0;
    for (const inst of instructions) {
        const success = await executeSingleInstruction(inst, cvData);
        if (success) filled++;
        await sleep(150);
    }
    return filled;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Observe Page State
// ═══════════════════════════════════════════════════════════════════
