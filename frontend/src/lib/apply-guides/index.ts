// Registry: company identity → apply guide. A job only gets the "Hướng dẫn
// apply" button when its company resolves here, so adding a company is one
// entry plus a content folder — no UI change.
//
// Matching runs on the NORMALIZED company name (diacritics stripped, đ→d,
// lowercased) because the same employer reaches us spelled several ways:
// "Mondelez Kinh Do" from the ATS ingest, "Mondelēz Kinh Đô" when an admin
// types it into a promoted card. Anchor patterns on the brand token, never the
// full legal name.

import type { ApplyGuide } from './types';

export type { ApplyGuide, GuideBlock, GuideSection } from './types';

export interface ApplyGuideRef {
    id: string;
    /** Button label — kept per-guide so a company can name it differently. */
    label: string;
    /** Content is code-split: nothing loads until the user opens the guide. */
    load: () => Promise<ApplyGuide>;
}

const REGISTRY: (ApplyGuideRef & { match: RegExp })[] = [
    {
        id: 'mondelez',
        label: 'Hướng dẫn apply',
        match: /\bmondelez\b/,
        load: () => import('./mondelez').then((m) => m.mondelezGuide),
    },
];

function normalize(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // combining marks: Mondelēz → Mondelez
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

/** The guide for this employer, or null when we have none (the common case). */
export function resolveApplyGuide(company?: string | null): ApplyGuideRef | null {
    if (!company) return null;
    const key = normalize(company);
    const hit = REGISTRY.find((g) => g.match.test(key));
    return hit ? { id: hit.id, label: hit.label, load: hit.load } : null;
}
