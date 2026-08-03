'use client';

// Renderer for the apply-guide block model (see lib/apply-guides/types.ts).
// The guide files carry structure only — every typographic decision lives here,
// so all companies' guides read the same.
import { CheckCircle, Info, Warning, X, Check } from '@phosphor-icons/react';
import type { GuideBlock } from '@/lib/apply-guides';
import styles from './applyGuide.module.css';

/** `depth` picks the sub-heading level: a group inside a group indents once. */
export default function GuideBlocks({ blocks, depth = 0 }: { blocks: GuideBlock[]; depth?: number }) {
    return (
        <>
            {blocks.map((b, i) => <Block key={i} block={b} depth={depth} />)}
        </>
    );
}

function Block({ block, depth }: { block: GuideBlock; depth: number }) {
    switch (block.kind) {
        case 'p':
            return <p className={styles.p}>{block.text}</p>;

        case 'list':
            return (
                <ul className={styles.list}>
                    {block.items.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
            );

        case 'steps':
            return (
                <ol className={styles.steps}>
                    {block.items.map((it, i) => (
                        <li key={i}>
                            <span className={styles.stepNum}>{i + 1}</span>
                            <span>{it}</span>
                        </li>
                    ))}
                </ol>
            );

        case 'checklist':
            return (
                <ul className={styles.checklist}>
                    {block.items.map((it, i) => (
                        <li key={i}>
                            <CheckCircle size={16} weight="bold" className={styles.checkIcon} />
                            <span>{it}</span>
                        </li>
                    ))}
                </ul>
            );

        case 'quote':
            return (
                <figure className={styles.quote}>
                    {block.label && <figcaption className={styles.quoteLabel}>{block.label}</figcaption>}
                    <blockquote className={styles.quoteText}>{block.text}</blockquote>
                </figure>
            );

        case 'compare':
            return (
                <div className={styles.compare}>
                    <div className={styles.compareBad}>
                        <span className={styles.compareTag}><X size={12} weight="bold" /> Chưa tốt</span>
                        <p>{block.bad}</p>
                    </div>
                    <div className={styles.compareGood}>
                        <span className={styles.compareTag}><Check size={12} weight="bold" /> Tốt hơn</span>
                        <p>{block.good}</p>
                    </div>
                </div>
            );

        case 'note': {
            const warn = block.tone === 'warn';
            return (
                <div className={`${styles.note} ${warn ? styles.noteWarn : styles.noteTip}`}>
                    {warn ? <Warning size={16} weight="fill" /> : <Info size={16} weight="fill" />}
                    <span>{block.text}</span>
                </div>
            );
        }

        case 'group':
            return (
                <section className={depth === 0 ? styles.group : styles.subGroup}>
                    {depth === 0
                        ? <h4 className={styles.groupTitle}>{block.title}</h4>
                        : <h5 className={styles.subGroupTitle}>{block.title}</h5>}
                    <GuideBlocks blocks={block.blocks} depth={depth + 1} />
                </section>
            );
    }
}
