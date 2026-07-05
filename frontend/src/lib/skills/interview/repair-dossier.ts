// Deterministic post-validation of the generated dossier — same philosophy as
// repairOptimizedCv: never trust the model's grounding. Every evidence quote
// must appear VERBATIM in its source text (CV, or the company text for company
// questions); non-verbatim quotes are dropped. A company question with no
// grounding evidence is dropped (→ the section disappears). Each section is
// capped and questions are ordered by priority.

import type { CVData } from '@/lib/types';
import { assertVerbatim } from '@/lib/verify/verbatim';
import { type Dossier, type Question, type Section, SECTION_ORDER } from '@/lib/skills/interview/types';

const PER_SECTION_CAP = 7;

function bulletLines(desc: unknown): string[] {
    return String(desc ?? '').split('\n').map(l => l.trim()).filter(Boolean);
}

/** Everything in the CV we allow a quote to be checked against. */
export function flattenCvText(cv: CVData): string {
    const parts: string[] = [cv.summary ?? ''];
    for (const e of cv.experience ?? []) {
        parts.push(e.title ?? '', e.company ?? '', ...bulletLines(e.description));
    }
    for (const p of cv.projects ?? []) parts.push(p.name ?? '', ...bulletLines(p.description));
    parts.push(...(cv.skills ?? []));
    return parts.filter(Boolean).join('\n');
}

export interface RepairDossierResult {
    dossier: Dossier;
    repairs: string[];
}

/**
 * Validate + prune the generated questions against their grounding. `companyText`
 * is the crawled company text (used to verify company-question evidence).
 */
export function repairDossier(cv: CVData, questions: Question[], companyText = ''): RepairDossierResult {
    const cvText = flattenCvText(cv);
    const repairs: string[] = [];

    const kept: Question[] = [];
    for (const q of questions) {
        const source = q.section === 'company' ? companyText : cvText;
        const goodEvidence = q.evidence.filter(e => assertVerbatim(e.quote, source));
        const dropped = q.evidence.length - goodEvidence.length;
        if (dropped > 0) repairs.push(`${q.section}/${q.id}: dropped ${dropped} non-verbatim evidence`);

        // Company questions live or die by their grounding — no evidence, no question.
        if (q.section === 'company' && goodEvidence.length === 0) {
            repairs.push(`company/${q.id}: no grounded evidence, dropped`);
            continue;
        }
        kept.push({ ...q, evidence: goodEvidence });
    }

    // Order by priority, then cap each section.
    const rank = (s: Section) => { const i = SECTION_ORDER.indexOf(s); return i < 0 ? SECTION_ORDER.length : i; };
    kept.sort((a, b) => rank(a.section) - rank(b.section));

    const perSection = new Map<Section, number>();
    const capped: Question[] = [];
    for (const q of kept) {
        const count = perSection.get(q.section) ?? 0;
        if (count >= PER_SECTION_CAP) {
            repairs.push(`${q.section}: capped at ${PER_SECTION_CAP}`);
            continue;
        }
        perSection.set(q.section, count + 1);
        capped.push({ ...q, id: `q${capped.length + 1}` });
    }

    return { dossier: { version: 1, questions: capped }, repairs };
}
