'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Shared keyboard/focus behavior for every modal in the app (they all share
 * one shape: createPortal → overlay div onClick={onClose} → content div).
 * Wires up what native <dialog> gives you for free and our hand-rolled
 * overlay divs don't:
 *   - Escape closes the modal.
 *   - Focus moves into the modal on open, and is trapped inside it (Tab/
 *     Shift+Tab cycle through its own focusable elements only) — otherwise a
 *     keyboard user tabs straight through into the page behind the overlay.
 *   - Focus returns to whatever triggered the modal on close, so keyboard
 *     users don't lose their place in the page.
 *
 * Usage: attach the returned ref to the modal's CONTENT div (not the overlay)
 * and spread `role="dialog" aria-modal="true"` on that same element.
 */
export function useModalA11y<T extends HTMLElement>(onClose: () => void) {
    const ref = useRef<T>(null);
    // Callers typically pass a fresh closure every render; keep a ref to the
    // latest one (updated post-render, not during) so the mount-only effect
    // below never calls a stale onClose that closed over outdated state.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const node = ref.current;

        // Nothing inside to focus (e.g. a modal that's mid-transition-in) —
        // fall back to the content container itself so Escape/Tab still work.
        const focusables = () => node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
        const first = focusables()[0];
        (first ?? node)?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab' || !node) return;
            const items = focusables();
            if (items.length === 0) { e.preventDefault(); return; }
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && active === firstEl) {
                e.preventDefault(); lastEl.focus();
            } else if (!e.shiftKey && active === lastEl) {
                e.preventDefault(); firstEl.focus();
            } else if (!node.contains(active)) {
                // Focus escaped the modal (e.g. programmatic blur) — pull it back.
                e.preventDefault(); firstEl.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);

        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            previouslyFocused?.focus?.();
        };
        // Mount/unmount only — onClose changes are picked up via onCloseRef.
    }, []);

    return ref;
}
