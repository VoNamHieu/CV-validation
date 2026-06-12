'use client';

import { useRef, useEffect, useCallback } from 'react';

/**
 * Renders the CV template HTML in an iframe and makes every element the
 * template marked with data-f="<path>" directly editable in place.
 * On blur, changed text is reported via onFieldEdit(path, newText) and the
 * parent writes it back into CVData (see lib/cv-inline-edit.ts) — the iframe
 * then re-renders with the committed content.
 *
 * The iframe is deliberately NOT sandboxed: the HTML is generated locally by
 * our own templates with every value escaped (esc()), and same-origin access
 * is required to wire contentEditable from the parent.
 */

const EDIT_STYLE = `
  [data-f] { cursor: text; transition: background 0.12s; border-radius: 2px; }
  [data-f]:hover { background: rgba(99,102,241,0.08); outline: 1px dashed rgba(99,102,241,0.55); outline-offset: 1px; }
  [data-f]:focus { background: rgba(99,102,241,0.06); outline: 2px solid #6366f1; outline-offset: 1px; }
`;

interface EditableTemplateFrameProps {
    html: string;
    onFieldEdit: (path: string, text: string) => void;
    height?: number;
}

export default function EditableTemplateFrame({
    html, onFieldEdit, height = 900,
}: EditableTemplateFrameProps) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    // Latest callback without rewiring listeners on every parent render.
    const onFieldEditRef = useRef(onFieldEdit);
    onFieldEditRef.current = onFieldEdit;
    // Scroll position survives the iframe reload that follows each commit.
    const scrollRef = useRef(0);

    const wire = useCallback(() => {
        const doc = frameRef.current?.contentDocument;
        if (!doc?.body) return;

        const style = doc.createElement('style');
        style.textContent = EDIT_STYLE;
        doc.head.appendChild(style);

        doc.documentElement.scrollTop = scrollRef.current;

        doc.querySelectorAll<HTMLElement>('[data-f]').forEach((el) => {
            const path = el.dataset.f;
            if (!path) return;
            el.contentEditable = 'true';
            el.spellcheck = false;
            const original = el.innerText;

            el.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    el.innerText = original;
                    el.blur();
                    return;
                }
                // Multiline only inside bullet lists / summary — elsewhere
                // Enter commits the edit instead of inserting a line break.
                const multiline = /\.(description)$|^summary$/.test(path);
                if (e.key === 'Enter' && !multiline) {
                    e.preventDefault();
                    el.blur();
                }
            });
            el.addEventListener('blur', () => {
                const text = el.innerText;
                if (text === original) return;
                scrollRef.current = doc.documentElement.scrollTop;
                onFieldEditRef.current(path, text);
            });
        });
    }, []);

    // srcDoc updates retrigger the load event, so each new render is rewired.
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        frame.addEventListener('load', wire);
        // The doc may already be parsed before the effect runs (fast srcDoc).
        if (frame.contentDocument?.readyState === 'complete') wire();
        return () => frame.removeEventListener('load', wire);
    }, [wire]);

    return (
        <iframe
            ref={frameRef}
            title="CV preview"
            srcDoc={html}
            style={{ display: 'block', width: '100%', height, border: 'none' }}
        />
    );
}
