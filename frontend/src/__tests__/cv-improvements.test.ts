import { describe, it, expect } from 'vitest';
import { diffCvChanges } from '@/lib/cv-improvements';
import type { CVData } from '@/lib/types';
import {
    EMPTY_CONTACT, EMPTY_PERSONAL, EMPTY_EMPLOYMENT, EMPTY_PREFERENCES,
} from '@/lib/types';

function makeCv(over: Partial<CVData> = {}): CVData {
    return {
        name: 'A',
        summary: 'Base summary',
        skills: ['Go', 'Postgres'],
        experience: [{
            title: 'Dev', company: 'ACME', duration_months: 24,
            description: 'built billing\nled team',
        }],
        education: [],
        projects: [{ name: 'P', description: 'shipped v1' }],
        contact: { ...EMPTY_CONTACT },
        personal: { ...EMPTY_PERSONAL },
        employment: { ...EMPTY_EMPLOYMENT },
        preferences: { ...EMPTY_PREFERENCES },
        ...over,
    };
}

describe('diffCvChanges', () => {
    it('returns empty for an identical CV (the "not actually optimized" case)', () => {
        const cv = makeCv();
        expect(diffCvChanges(cv, makeCv())).toEqual([]);
    });

    it('ignores whitespace/case-only differences', () => {
        const optimized = makeCv({ summary: '  base   SUMMARY ' });
        expect(diffCvChanges(makeCv(), optimized)).toEqual([]);
    });

    it('detects a rewritten summary', () => {
        const changes = diffCvChanges(makeCv(), makeCv({ summary: 'Tailored for fintech' }));
        expect(changes.some(c => c.includes('mục tiêu nghề nghiệp'))).toBe(true);
    });

    it('counts reworded experience bullets', () => {
        const optimized = makeCv({
            experience: [{
                title: 'Dev', company: 'ACME', duration_months: 24,
                description: 'rebuilt billing end-to-end\nled team',
            }],
        });
        const changes = diffCvChanges(makeCv(), optimized);
        expect(changes.some(c => c.includes('gạch đầu dòng') && c.includes('ACME'))).toBe(true);
    });

    it('detects reordered bullets without rewording', () => {
        const optimized = makeCv({
            experience: [{
                title: 'Dev', company: 'ACME', duration_months: 24,
                description: 'led team\nbuilt billing',
            }],
        });
        const changes = diffCvChanges(makeCv(), optimized);
        expect(changes.some(c => c.toLowerCase().includes('sắp xếp lại'))).toBe(true);
    });

    it('detects reordered skills as reordering, not edits', () => {
        const optimized = makeCv({ skills: ['Postgres', 'Go'] });
        const changes = diffCvChanges(makeCv(), optimized);
        expect(changes.some(c => c.includes('Đưa lên đầu danh sách kỹ năng'))).toBe(true);
    });

    it('detects project description changes', () => {
        const optimized = makeCv({ projects: [{ name: 'P', description: 'shipped v1 to 10k users' }] });
        const changes = diffCvChanges(makeCv(), optimized);
        expect(changes.some(c => c.includes('dự án'))).toBe(true);
    });
});
