import { describe, it, expect } from 'vitest';
import { repairOptimizedCv } from '@/lib/cv-optimize';
import { dateRangeLabel } from '@/lib/cv-templates/types';

const original = {
    name: 'Nguyen Van A',
    summary: 'Backend engineer with 5 years of experience.',
    skills: ['Go', 'Postgres', 'Docker'],
    experience: [
        {
            title: 'Senior Dev', company: 'ACME', duration_months: 24,
            start_date: '01/2022', end_date: 'Hiện tại',
            description: 'built the billing system\nled a team of 3\nreduced latency by 40%',
        },
    ],
    education: [{ degree: 'BSc CS', institution: 'HUST', year: '2020' }],
    projects: [{ name: 'Proj X', description: 'designed schema\nshipped v1' }],
    certifications: [{ name: 'AWS SAA', issuer: 'Amazon', year: '2023' }],
    languages: [{ language: 'English', level: 'IELTS 7.0' }],
    contact: { email: 'a@b.c' },
    personal: { gender: 'Nam' },
    employment: { current_title: 'Senior Dev' },
    preferences: { desired_salary: '2000' },
};

describe('repairOptimizedCv', () => {
    it('keeps a faithful optimization untouched except facts', () => {
        const optimized = {
            name: 'NGUYEN VAN A (renamed)',
            summary: 'Rewritten summary.',
            skills: ['Postgres', 'Go', 'Docker'],
            experience: [{
                title: 'Lead Dev (inflated)', company: 'ACME Corp (changed)', duration_months: 99,
                description: 'rebuilt the billing system end-to-end\nled and mentored a team of 3\ncut latency by 40%',
            }],
            education: [{ degree: 'changed', institution: 'changed', year: 'changed' }],
            projects: [{ name: 'renamed', description: 'redesigned schema\nshipped v1 to production' }],
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(repairs).toEqual([]);
        expect(cv.summary).toBe('Rewritten summary.');
        // Facts restored from the original:
        expect(cv.name).toBe('Nguyen Van A');
        expect(cv.education).toEqual(original.education);
        const exp = (cv.experience as Record<string, unknown>[])[0];
        expect(exp.title).toBe('Senior Dev');
        expect(exp.company).toBe('ACME');
        expect(exp.duration_months).toBe(24);
        expect(exp.start_date).toBe('01/2022');
        expect(exp.end_date).toBe('Hiện tại');
        // Rewritten wording kept:
        expect(exp.description).toContain('rebuilt the billing system');
        const proj = (cv.projects as Record<string, unknown>[])[0];
        expect(proj.name).toBe('Proj X');
        // Untouched sections merged back:
        expect(cv.certifications).toEqual(original.certifications);
        expect(cv.languages).toEqual(original.languages);
        expect(cv.contact).toEqual(original.contact);
    });

    it('restores a description whose bullet count shrank', () => {
        const optimized = {
            name: 'A', summary: 's', skills: ['Go', 'Postgres', 'Docker'],
            experience: [{
                title: 'Senior Dev', company: 'ACME', duration_months: 24,
                description: 'did everything, summarized into one bullet',
            }],
            education: [], projects: [{ name: 'Proj X', description: 'one line only' }],
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(repairs.some(r => r.startsWith('experience[0]: bullets 1 < 3'))).toBe(true);
        expect(repairs.some(r => r.startsWith('projects[0]: bullets 1 < 2'))).toBe(true);
        expect((cv.experience as Record<string, unknown>[])[0].description)
            .toBe(original.experience[0].description);
        expect((cv.projects as Record<string, unknown>[])[0].description)
            .toBe(original.projects[0].description);
    });

    it('allows bullets to grow (detailed mode splitting)', () => {
        const optimized = {
            name: 'A', summary: 's', skills: ['Go', 'Postgres', 'Docker'],
            experience: [{
                title: 'Senior Dev', company: 'ACME', duration_months: 24,
                description: 'a\nb\nc\nd',
            }],
            education: [], projects: [{ name: 'Proj X', description: 'a\nb\nc' }],
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(repairs).toEqual([]);
        expect((cv.experience as Record<string, unknown>[])[0].description).toBe('a\nb\nc\nd');
    });

    it('restores the whole array when an entry was dropped', () => {
        const optimized = {
            name: 'A', summary: 's', skills: ['Go', 'Postgres', 'Docker'],
            experience: [],
            education: [], projects: [{ name: 'Proj X', description: 'x\ny' }],
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(repairs.some(r => r.includes('experience: entry count 0 != 1'))).toBe(true);
        expect(cv.experience).toEqual(original.experience);
    });

    it('appends dropped skills back (case-insensitive)', () => {
        const optimized = {
            name: 'A', summary: 's', skills: ['go', 'Docker'],
            experience: original.experience,
            education: [], projects: original.projects,
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(repairs.some(r => r.includes('skills: 1 dropped (Postgres)'))).toBe(true);
        expect(cv.skills).toEqual(['go', 'Docker', 'Postgres']);
    });

    it('restores an empty summary', () => {
        const optimized = {
            name: 'A', summary: '  ', skills: ['Go', 'Postgres', 'Docker'],
            experience: original.experience,
            education: [], projects: original.projects,
        };
        const { cv } = repairOptimizedCv(original, optimized);
        expect(cv.summary).toBe(original.summary);
    });
});

// Regression probes proven by hand against the live optimizer. P1/P2 target the
// two deterministic repair bugs; P3/P4 (verifier tiers) live in verify.test.ts.
describe('repairOptimizedCv — verified probes', () => {
    // P1 — the model REORDERED experience entries. Facts must be restored to the
    // correct entry by content key, not spliced across roles by array index.
    it('P1: matches reordered experience entries by key, not index', () => {
        const orig = {
            name: 'A', summary: 's', skills: ['Go'],
            experience: [
                { title: 'Senior Dev', company: 'ACME', duration_months: 24, start_date: '01/2022', end_date: 'Hiện tại', description: 'built billing\nled team of 3' },
                { title: 'Junior Dev', company: 'Beta', duration_months: 12, start_date: '01/2020', end_date: '12/2020', description: 'fixed bugs\nwrote tests' },
            ],
            education: [], projects: [],
        };
        const optimized = {
            name: 'A', summary: 's', skills: ['Go'],
            experience: [
                // Beta first now, with tampered duration the repair must overwrite.
                { title: 'Junior Dev', company: 'Beta', duration_months: 99, description: 'squashed bugs\nauthored tests' },
                { title: 'Senior Dev', company: 'ACME', duration_months: 99, description: 'rebuilt billing\nmentored team of 3' },
            ],
            education: [], projects: [],
        };
        const { cv } = repairOptimizedCv(orig, optimized);
        const exp = cv.experience as Record<string, unknown>[];
        // Beta (index 0) keeps Beta's facts — NOT ACME's, which index-matching gave.
        expect(exp[0].company).toBe('Beta');
        expect(exp[0].duration_months).toBe(12);
        expect(exp[0].start_date).toBe('01/2020');
        expect(exp[1].company).toBe('ACME');
        expect(exp[1].duration_months).toBe(24);
        expect(exp[1].end_date).toBe('Hiện tại');
    });

    // P2 — the model ADDED a skill the candidate never listed. Guardrail #2 says
    // add no new skills, so it must be stripped (not merely reordered/appended).
    it('P2: strips a fabricated skill and logs it', () => {
        const optimized = {
            name: 'A', summary: 's', skills: ['Go', 'Kubernetes', 'Postgres', 'Docker'],
            experience: original.experience,
            education: [], projects: original.projects,
        };
        const { cv, repairs } = repairOptimizedCv(original, optimized);
        expect(cv.skills).not.toContain('Kubernetes');
        expect(cv.skills).toEqual(['Go', 'Postgres', 'Docker']);
        expect(repairs.some(r => r.includes('fabricated stripped (Kubernetes)'))).toBe(true);
    });
});

describe('dateRangeLabel', () => {
    it('prefers verbatim start–end dates', () => {
        expect(dateRangeLabel({ start_date: '03/2021', end_date: '05/2023', duration_months: 26 }))
            .toBe('03/2021 – 05/2023');
    });
    it('normalizes ongoing markers to "Hiện tại"', () => {
        expect(dateRangeLabel({ start_date: '03/2021', end_date: 'Present' }))
            .toBe('03/2021 – Hiện tại');
        expect(dateRangeLabel({ start_date: '03/2021', end_date: 'now' }))
            .toBe('03/2021 – Hiện tại');
    });
    it('falls back to duration when dates are missing', () => {
        expect(dateRangeLabel({ duration_months: 27 })).toBe('2 năm 3 tháng');
        expect(dateRangeLabel({ start_date: '', end_date: '', duration_months: 12 })).toBe('1 năm');
        expect(dateRangeLabel({})).toBe('');
    });
    it('shows a lone date without a dangling dash', () => {
        expect(dateRangeLabel({ start_date: '03/2021', duration_months: 5 })).toBe('03/2021');
    });
});
