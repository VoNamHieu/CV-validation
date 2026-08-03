'use client';

// The "Hướng dẫn apply" reader. One section at a time (nav left, content right)
// rather than one long scroll — the guide is ~6 stages of a funnel and a user
// mid-application only wants the stage they're on.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, SpinnerGap, BookOpen } from '@phosphor-icons/react';
import type { ApplyGuide, ApplyGuideRef } from '@/lib/apply-guides';
import { useModalA11y } from '@/lib/useModalA11y';
import GuideBlocks from './GuideBlocks';
import styles from './applyGuide.module.css';

export default function ApplyGuideModal({ guide: ref, onClose }: { guide: ApplyGuideRef; onClose: () => void }) {
    const [guide, setGuide] = useState<ApplyGuide | null>(null);
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState(0);
    const dialogRef = useModalA11y<HTMLDivElement>(onClose);

    // Content is code-split, so it arrives one tick after the modal opens.
    useEffect(() => {
        let alive = true;
        ref.load()
            .then((g) => { if (alive) setGuide(g); })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [ref]);

    // The page behind must not scroll while the reader is open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    if (typeof document === 'undefined') return null;

    const section = guide?.sections[active];
    const next = guide?.sections[active + 1];

    return createPortal(
        <div
            className={styles.overlay}
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="apply-guide-title"
                tabIndex={-1}
            >
                <header className={styles.head}>
                    <div className={styles.headText}>
                        <span className={styles.eyebrow}><BookOpen size={13} weight="fill" /> Hướng dẫn apply</span>
                        <h2 id="apply-guide-title" className={styles.title}>
                            {guide?.title || 'Đang mở hướng dẫn…'}
                        </h2>
                        {guide && <p className={styles.intro}>{guide.intro}</p>}
                    </div>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">
                        <X size={18} weight="bold" />
                    </button>
                </header>

                {failed ? (
                    <div className={styles.state}>Không mở được hướng dẫn lúc này. Đóng rồi thử lại nhé.</div>
                ) : !guide || !section ? (
                    <div className={styles.state}>
                        <SpinnerGap size={24} weight="bold" className={styles.spin} />
                        <span>Đang tải hướng dẫn…</span>
                    </div>
                ) : (
                    <div className={styles.body}>
                        <nav className={styles.nav} aria-label="Các phần của hướng dẫn">
                            {guide.sections.map((s, i) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    className={`${styles.navItem} ${i === active ? styles.navItemActive : ''}`}
                                    onClick={() => setActive(i)}
                                    aria-current={i === active ? 'true' : undefined}
                                >
                                    <span className={styles.navNum}>{i + 1}</span>
                                    <span className={styles.navText}>
                                        <span className={styles.navTitle}>{s.title}</span>
                                        {s.summary && <span className={styles.navSummary}>{s.summary}</span>}
                                    </span>
                                </button>
                            ))}
                        </nav>

                        {/* key={section.id} remounts on section change so the pane
                            starts at the top instead of keeping the old scroll. */}
                        <article key={section.id} className={styles.content}>
                            <h3 className={styles.sectionTitle}>{section.title}</h3>
                            <GuideBlocks blocks={section.blocks} />

                            {next && (
                                <button type="button" className={styles.nextBtn} onClick={() => setActive(active + 1)}>
                                    Tiếp: {next.title} <ArrowRight size={15} weight="bold" />
                                </button>
                            )}
                        </article>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
