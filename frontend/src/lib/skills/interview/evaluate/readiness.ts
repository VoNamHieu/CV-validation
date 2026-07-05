// Readiness — PURE ARITHMETIC, no LLM, no confidence score. Per topic it's the
// best you've shown across your attempts: max ✓-count over attempts, summed
// across the topic's questions, over the total possible items. A topic groups
// questions by the JD requirement they target; priority topics (probe/gap)
// sort first. The UI only renders this once a topic has ≥2 attempts.

import {
    type Checklist, type Dossier, type Question, type Section,
    SECTION_LABEL_VI, SECTION_ORDER,
} from '@/lib/skills/interview/types';

const ITEMS_PER_QUESTION = 7; // groundedness + specificity + contradiction + S/T/A/R

export interface AttemptLike {
    question_id: string;
    checklist: Checklist;
}

export interface ReadinessTopic {
    topic: string;
    label_vi: string;
    ratio: number;      // 0..1
    attempts: number;
    // The UI gate: only meaningful once the candidate has iterated.
    show: boolean;
}

function checkmarks(c: Checklist): number {
    let n = 0;
    if (c.groundedness?.status === 'pass') n++;
    if (c.specificity?.status === 'pass') n++;
    if (c.contradiction?.status === 'pass') n++;
    if (c.star?.s) n++;
    if (c.star?.t) n++;
    if (c.star?.a) n++;
    if (c.star?.r) n++;
    return n;
}

function topicKey(q: Question): string {
    return q.source.requirement ?? SECTION_LABEL_VI[q.section];
}

export function computeReadiness(dossier: Dossier, attempts: AttemptLike[]): ReadinessTopic[] {
    // question_id → its attempts' checklists
    const byQuestion = new Map<string, Checklist[]>();
    for (const a of attempts) {
        const list = byQuestion.get(a.question_id) ?? [];
        list.push(a.checklist);
        byQuestion.set(a.question_id, list);
    }

    // Group questions into topics; track best ✓ per question + section rank.
    interface Agg { best: number; items: number; attempts: number; section: Section; }
    const topics = new Map<string, Agg>();
    for (const q of dossier.questions) {
        const key = topicKey(q);
        const agg = topics.get(key) ?? { best: 0, items: 0, attempts: 0, section: q.section };
        const cls = byQuestion.get(q.id) ?? [];
        const bestForQ = cls.reduce((m, c) => Math.max(m, checkmarks(c)), 0);
        agg.best += bestForQ;
        agg.items += ITEMS_PER_QUESTION;
        agg.attempts += cls.length;
        // Keep the highest-priority section seen for ordering.
        if (SECTION_ORDER.indexOf(q.section) < SECTION_ORDER.indexOf(agg.section)) agg.section = q.section;
        topics.set(key, agg);
    }

    const out: ReadinessTopic[] = [...topics.entries()].map(([topic, agg]) => ({
        topic,
        label_vi: topic,
        ratio: agg.items > 0 ? agg.best / agg.items : 0,
        attempts: agg.attempts,
        show: agg.attempts >= 2,
    }));

    // Priority sections first, then least-ready first within the same priority.
    const rank = (s: Section) => { const i = SECTION_ORDER.indexOf(s); return i < 0 ? SECTION_ORDER.length : i; };
    const sectionOf = (t: string) => topics.get(t)!.section;
    out.sort((a, b) => rank(sectionOf(a.topic)) - rank(sectionOf(b.topic)) || a.ratio - b.ratio);
    return out;
}
