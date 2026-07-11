'use client';

import { useEffect, useRef } from 'react';
import { HOW_CSS, HOW_MARKUP, initHow } from './howAnimation';

// "Cách hoạt động" — a self-contained animated walkthrough (ported from the
// standalone copo-section prototype). It carries generic class names (.job,
// .core, .win, .btn…) that would leak if injected globally, so it lives inside
// a shadow root for full CSS isolation. The animation script is (re)initialised
// on every mount and torn down on unmount — StrictMode's double-invoke is safe
// because innerHTML is reset fresh each run before initHow rebuilds the scene.
export default function HowItWorks() {
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${HOW_CSS}</style>${HOW_MARKUP}`;
        let cleanup: (() => void) | undefined;
        try {
            cleanup = initHow(root);
        } catch (e) {
            console.error('[how-it-works] init failed', e);
        }
        return () => {
            try { cleanup?.(); } catch { /* noop */ }
        };
    }, []);

    // id="how" keeps the nav scroll-spy anchor working; z-index lifts the dark
    // band above the landing's fixed background layer (.lp-bg).
    return <div id="how" ref={hostRef} style={{ position: 'relative', zIndex: 1 }} />;
}
