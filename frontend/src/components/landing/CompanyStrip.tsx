'use client';

import { useState } from 'react';
import { catalog } from '@/lib/db';
import { COMPANIES, type Company } from './content';
import styles from './landing.module.css';

// One logo, resolved in a 3-stage fallback so admin-uploaded brands take
// priority: stored company logo (by domain) → Clearbit CDN guess → wordmark.
// Each stage advances on the previous <img>'s load error.
function LogoItem({ name, domain }: Company) {
    const [stage, setStage] = useState<0 | 1 | 2>(0);
    if (stage === 2) return <span className={styles.logoText}>{name}</span>;
    const src = stage === 0
        ? catalog.companyLogoUrlByDomain(domain)
        : `https://logo.clearbit.com/${domain}`;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            key={stage}
            className={styles.logoImg} alt={name} loading="lazy"
            src={src}
            onError={() => setStage((s) => (s + 1) as 0 | 1 | 2)}
        />
    );
}

export default function CompanyStrip() {
    return (
        <section className={styles.logos}>
            <div className={styles.wrap}>
                <p className={`${styles.logosTitle} ${styles.reveal}`}>
                    Quét trực tiếp từ trang tuyển dụng chính thức của các công ty như:
                </p>
            </div>
            <div className={styles.marquee}>
                <div className={styles.marqueeTrack}>
                    {[...COMPANIES, ...COMPANIES].map((c, i) => (
                        <div className={styles.logoCell} key={`${c.name}-${i}`}>
                            <LogoItem {...c} />
                        </div>
                    ))}
                </div>
            </div>
            <div className={styles.wrap}>
                <p className={styles.logosDisclaim}>
                    Logos are trademarks of their respective owners. Their appearance does not imply endorsement or partnership.
                </p>
            </div>
        </section>
    );
}
