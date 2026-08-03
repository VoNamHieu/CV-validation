// Data model for a company-specific "Hướng dẫn apply".
//
// Guides are structured data, not prose blobs: the renderer owns the typography
// so every company's guide reads the same, and a section can be linked to,
// counted or reordered without touching markup. Blocks nest one or two levels
// via `group` — deeper than that means the section should be split instead.

export type GuideBlock =
    | { kind: 'p'; text: string }
    | { kind: 'list'; items: string[] }
    /** Ordered steps — use when the order actually matters. */
    | { kind: 'steps'; items: string[] }
    /** Tick-box items the reader runs through before acting. */
    | { kind: 'checklist'; items: string[] }
    /** A sample answer / sample sentence, quoted verbatim. */
    | { kind: 'quote'; text: string; label?: string }
    /** A weak-vs-strong pair — the fastest way to teach CV bullet writing. */
    | { kind: 'compare'; bad: string; good: string }
    | { kind: 'note'; text: string; tone?: 'tip' | 'warn' }
    | { kind: 'group'; title: string; blocks: GuideBlock[] };

export interface GuideSection {
    /** Stable slug — used as the nav key and the scroll anchor. */
    id: string;
    title: string;
    /** One line shown under the title in the nav. */
    summary?: string;
    blocks: GuideBlock[];
}

export interface ApplyGuide {
    id: string;
    /** Employer this guide is written for, spelled the way they spell it. */
    company: string;
    title: string;
    intro: string;
    sections: GuideSection[];
}
