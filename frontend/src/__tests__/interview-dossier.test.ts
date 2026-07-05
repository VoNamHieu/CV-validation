import { describe, it, expect } from 'vitest';
import type { CVData, JDData, MatchResult } from '@/lib/types';
import type { BulletVerdict } from '@/lib/verify/backtrack';
import { experienceKey } from '@/lib/verify/facts';
import { buildQuestionSlots } from '@/lib/skills/interview/questions';
import { repairDossier } from '@/lib/skills/interview/repair-dossier';
import type { Question } from '@/lib/skills/interview/types';

const cv = {
    name: 'A', summary: 'Backend engineer.', skills: ['Go', 'Postgres'],
    experience: [{ title: 'Dev', company: 'ACME', duration_months: 24, description: 'built billing system\nled a team of 3' }],
    education: [], projects: [],
    contact: {}, personal: {}, employment: {}, preferences: {},
} as unknown as CVData;

const jd = {
    must_have: ['Go'], nice_to_have: [],
    responsibilities: ['Vận hành hệ thống thanh toán', 'Tối ưu hiệu năng'],
    seniority_expected: 'Senior', domain: 'Fintech',
} as JDData;

const match = {
    overall_score: 70,
    must_have_match: {
        score: 70, reasoning: '', gaps: [],
        requirements: [
            { requirement: 'Golang programming', status: 'met', evidence: '' },
            { requirement: 'billing systems experience', status: 'partial', evidence: '' },
            { requirement: 'Kafka streaming', status: 'missing', evidence: '' },
        ],
    },
    experience_match: { score: 0, reasoning: '', gaps: [] },
    domain_match: { score: 0, reasoning: '', gaps: [] },
    seniority_match: { score: 0, reasoning: '', gaps: [] },
    nice_to_have_match: { score: 0, reasoning: '', gaps: [] },
    strength_summary: '', risk_flags: [],
} as unknown as MatchResult;

const flags: BulletVerdict[] = [{
    section: 'experience',
    entryKey: experienceKey({ title: 'Dev', company: 'ACME' }),
    bulletIndex: 0, text: 'rebuilt the billing platform', provenance: 'rephrased', tier: 'flag',
}];

describe('buildQuestionSlots (deterministic)', () => {
    const slots = buildQuestionSlots(cv, jd, match, flags);
    const bySection = (s: string) => slots.filter(q => q.section === s);

    it('maps requirement coverage to expand/probe/gap', () => {
        expect(bySection('expand').some(s => s.source.requirement === 'Golang programming')).toBe(true);
        expect(bySection('probe').some(s => s.source.requirement === 'billing systems experience')).toBe(true);
        expect(bySection('gap').some(s => s.source.requirement === 'Kafka streaming')).toBe(true);
    });

    it('grounds a probe in the matching CV bullet; a gap has no grounding', () => {
        expect(bySection('probe')[0].grounding).toBe('built billing system');
        expect(bySection('gap')[0].grounding).toBe('');
    });

    it('turns a flag into a translate slot mapped to the right entry index', () => {
        const t = bySection('translate')[0];
        expect(t.source.flag_bullet).toEqual({ entry: 0, bullet: 0 });
        expect(t.grounding).toBe('built billing system');
    });

    it('creates a case slot per JD responsibility', () => {
        expect(bySection('case')).toHaveLength(2);
    });
});

describe('repairDossier', () => {
    const q = (id: string, section: Question['section'], evidence: { quote: string }[]): Question => ({
        id, section, text_vi: 'Q?', why_vi: '', evidence, star_outline: { s: '', t: '', a: '', r: '' }, source: {},
    });

    it('drops non-verbatim evidence but keeps the question', () => {
        const { dossier, repairs } = repairDossier(cv, [
            q('a', 'probe', [{ quote: 'built billing system' }, { quote: 'increased revenue 300%' }]),
        ]);
        expect(dossier.questions).toHaveLength(1);
        expect(dossier.questions[0].evidence.map(e => e.quote)).toEqual(['built billing system']);
        expect(repairs.some(r => r.includes('non-verbatim'))).toBe(true);
    });

    it('drops a company question with no grounded evidence', () => {
        const { dossier } = repairDossier(cv, [
            q('c1', 'company', [{ quote: 'not in company text' }]),
            q('c2', 'company', [{ quote: 'công ty fintech' }]),
        ], 'Chúng tôi là công ty fintech hàng đầu.');
        const company = dossier.questions.filter(x => x.section === 'company');
        expect(company).toHaveLength(1);
        expect(company[0].evidence[0].quote).toBe('công ty fintech');
    });

    it('orders probe before expand (priority) and re-ids sequentially', () => {
        const { dossier } = repairDossier(cv, [
            q('x', 'expand', []),
            q('y', 'probe', []),
        ]);
        expect(dossier.questions.map(x => x.section)).toEqual(['probe', 'expand']);
        expect(dossier.questions.map(x => x.id)).toEqual(['q1', 'q2']);
    });

    it('caps a section at 7', () => {
        const many = Array.from({ length: 10 }, (_, i) => q(`p${i}`, 'probe', []));
        const { dossier, repairs } = repairDossier(cv, many);
        expect(dossier.questions.filter(x => x.section === 'probe')).toHaveLength(7);
        expect(repairs.some(r => r.includes('capped'))).toBe(true);
    });
});
