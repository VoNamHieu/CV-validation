import { describe, it, expect } from 'vitest';
import type { CVData } from '@/lib/types';
import { runPreChecks } from '@/lib/skills/interview/evaluate/pre-checks';
import { buildCoaching } from '@/lib/skills/interview/evaluate/coaching';
import { computeReadiness, type AttemptLike } from '@/lib/skills/interview/evaluate/readiness';
import type { Checklist, Dossier, Question } from '@/lib/skills/interview/types';

const CV_ENTRY = 'tăng tỷ lệ chuyển đổi từ 22% lên 54%';
const cv = {
    name: 'A', summary: 'Growth engineer.', skills: ['SQL'],
    experience: [{ title: 'Dev', company: 'ACME', duration_months: 24, description: CV_ENTRY }],
    education: [], projects: [],
    contact: {}, personal: {}, employment: {}, preferences: {},
} as unknown as CVData;

const q = (over: Partial<Question> = {}): Question => ({
    id: 'q1', section: 'probe', text_vi: '?', why_vi: '',
    evidence: [{ quote: CV_ENTRY }], star_outline: { s: '', t: '', a: '', r: '' }, source: {}, ...over,
});

describe('runPreChecks', () => {
    it('specificity: passes when every number is in the CV', () => {
        const pre = runPreChecks('Tôi đã tăng từ 22% lên 54%', q(), cv);
        expect(pre.specificity.status).toBe('pass');
    });

    it('specificity: fails a fabricated number and quotes the CV', () => {
        const pre = runPreChecks('Tôi đã tăng lên 63%', q(), cv);
        expect(pre.specificity.status).toBe('fail');
        expect(pre.specificity.detail_vi).toContain('63%');
        expect(pre.specificity.cv_quote).toBe(CV_ENTRY);
    });

    it('specificity: partial when the answer has no numbers', () => {
        expect(runPreChecks('Tôi cải thiện chuyển đổi', q(), cv).specificity.status).toBe('partial');
    });

    it('contradiction: flags a percentage that collides with the CV figure (22%→54% garble)', () => {
        const pre = runPreChecks('Tôi đã tăng chuyển đổi lên 40%', q(), cv);
        expect(pre.contradiction.status).toBe('fail');
        expect(pre.contradiction.cv_quote).toBe(CV_ENTRY);
    });

    it('groundedness: passes when the answer echoes the evidence, fails when unrelated', () => {
        expect(runPreChecks('Tôi tăng tỷ lệ chuyển đổi đáng kể', q(), cv).groundedness.status).toBe('pass');
        expect(runPreChecks('Tôi thích chơi bóng đá cuối tuần', q(), cv).groundedness.status).toBe('fail');
    });
});

describe('buildCoaching', () => {
    const failChecklist = (over: Partial<Checklist> = {}): Checklist => ({
        groundedness: { status: 'pass' },
        specificity: { status: 'fail' },
        contradiction: { status: 'pass' },
        star: { s: true, t: true, a: true, r: true },
        ...over,
    });

    it('recommends editing the bullet when substance stays none by attempt 2', () => {
        const question = q({ section: 'translate', source: { flag_bullet: { entry: 0, bullet: 1 } } });
        const c = buildCoaching(failChecklist({ substance: 'none' }), question, 2);
        expect(c.recommend_bullet_edit).toEqual({ entry: 0, bullet: 1 });
    });

    it('does NOT recommend an edit on the first attempt', () => {
        const question = q({ section: 'translate', source: { flag_bullet: { entry: 0, bullet: 1 } } });
        expect(buildCoaching(failChecklist({ substance: 'none' }), question, 1).recommend_bullet_edit).toBeUndefined();
    });

    it('praises self-reflection that names the failed axis', () => {
        const c = buildCoaching(failChecklist(), q(), 1, 'Mình biết câu trả lời còn thiếu số liệu cụ thể');
        expect(c.praise_vi).toBeTruthy();
    });

    it('gives no praise for an off-target reflection', () => {
        const c = buildCoaching(failChecklist(), q(), 1, 'Mình thấy trả lời khá ổn');
        expect(c.praise_vi).toBeUndefined();
    });
});

describe('computeReadiness', () => {
    const dossier: Dossier = {
        version: 1,
        questions: [
            q({ id: 'q1', section: 'probe', source: { requirement: 'SQL' } }),
            q({ id: 'q2', section: 'probe', source: { requirement: 'SQL' } }),
            q({ id: 'q3', section: 'expand', source: { requirement: 'Docs' } }),
        ],
    };
    const perfect: Checklist = {
        groundedness: { status: 'pass' }, specificity: { status: 'pass' }, contradiction: { status: 'pass' },
        star: { s: true, t: true, a: true, r: true },
    };

    it('computes max-over-attempts / total-items per topic', () => {
        const attempts: AttemptLike[] = [
            { question_id: 'q1', checklist: perfect },  // 7/7 for q1
            { question_id: 'q1', checklist: { ...perfect, specificity: { status: 'fail' } } }, // worse; max wins
        ];
        const topics = computeReadiness(dossier, attempts);
        const sql = topics.find(t => t.topic === 'SQL')!;
        // q1 best = 7, q2 unattempted = 0 → 7 / (7*2 items) = 0.5
        expect(sql.ratio).toBeCloseTo(0.5, 5);
        expect(sql.attempts).toBe(2);
    });

    it('orders priority (probe) topics before expand', () => {
        const topics = computeReadiness(dossier, [{ question_id: 'q1', checklist: perfect }]);
        expect(topics[0].topic).toBe('SQL');
    });

    it('gates show on ≥2 attempts', () => {
        const one = computeReadiness(dossier, [{ question_id: 'q1', checklist: perfect }]);
        expect(one.find(t => t.topic === 'SQL')!.show).toBe(false);
        const two = computeReadiness(dossier, [
            { question_id: 'q1', checklist: perfect }, { question_id: 'q2', checklist: perfect },
        ]);
        expect(two.find(t => t.topic === 'SQL')!.show).toBe(true);
    });
});
