// Shared plain-text JD → readable blocks renderer. Used by BOTH the public
// landing page (/j/[slug]) and the admin editor's live preview so "what you see
// while editing" is byte-for-byte how the published page will format the JD:
// short lines ending in ":" (or ALL CAPS) become sub-headings, bullet lines
// become a list, everything else is a paragraph. The JD arrives
// newline-separated from the backend's HTML stripper.
import type { ReactNode } from 'react';
import styles from '@/app/j/[slug]/promoted.module.css';

export function renderJd(text: string): ReactNode {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const blocks: ReactNode[] = [];
    let bullets: string[] = [];
    const flush = () => {
        if (bullets.length) {
            blocks.push(
                <ul key={`ul-${blocks.length}`}>
                    {bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>,
            );
            bullets = [];
        }
    };
    for (const line of lines) {
        const isBullet = /^[-•*·+]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
        const isHeading = !isBullet && line.length <= 64 &&
            (/[:：]$/.test(line) || (line === line.toUpperCase() && /\p{L}/u.test(line)));
        if (isBullet) {
            bullets.push(line.replace(/^[-•*·+]\s+/, '').replace(/^\d+[.)]\s+/, ''));
        } else if (isHeading) {
            flush();
            blocks.push(<div key={`h-${blocks.length}`} className={styles.jdBlockHeading}>{line.replace(/[:：]$/, '')}</div>);
        } else {
            flush();
            blocks.push(<p key={`p-${blocks.length}`}>{line}</p>);
        }
    }
    flush();
    return blocks;
}
