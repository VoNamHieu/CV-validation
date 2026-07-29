import styles from './landing.module.css';

// The "đừng đi ⟍xin⟍ việc" motif: a hand-drawn seal-red stroke through a word,
// animated on mount. `d` is the SVG path so each usage can vary the line.
export default function Strike({ children, d }: { children: React.ReactNode; d: string }) {
    return (
        <span className={styles.strike}>
            {children}
            <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
                <path pathLength={1} d={d} />
            </svg>
        </span>
    );
}
