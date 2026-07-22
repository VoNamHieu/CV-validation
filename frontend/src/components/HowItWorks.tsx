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

    // The animation below lives in a shadow root, so its narration is invisible to
    // search/answer engines and screen readers. This sr-only block is the crawlable,
    // accessible text alternative (a real-DOM sibling, NOT a child of the shadow
    // host — children of a shadow host aren't rendered/exposed). id="how-it-works"
    // keeps the nav scroll-spy anchor working; z-index lifts the dark band above the
    // landing's fixed background layer (.lp-bg).
    return (
        <>
            <div className="sr-only">
                <h2>Copo hoạt động thế nào</h2>
                <ol>
                    <li>Kéo CV bạn đang có vào Copo, không cần chỉnh sửa gì trước.</li>
                    <li>Copo quét việc làm từ trang tuyển dụng chính thức của doanh nghiệp và chấm điểm độ khớp với hồ sơ của bạn.</li>
                    <li>Copo giữ lại những vị trí thật sự hợp và xếp theo mức độ khớp, thay vì hàng trăm tin.</li>
                    <li>Copo viết lại CV cho khớp từng vị trí mà vẫn không bịa nội dung.</li>
                    <li>Copo tự động mở trang tuyển dụng, điền form, đính CV và nộp hồ sơ ứng tuyển thay bạn.</li>
                </ol>
            </div>
            <div id="how-it-works" ref={hostRef} style={{ position: 'relative', zIndex: 1 }} />
        </>
    );
}
