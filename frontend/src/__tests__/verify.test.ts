import { describe, it, expect } from 'vitest';
import { extractNumerals, extractFacts, diffFacts } from '@/lib/verify/facts';
import { assertVerbatim } from '@/lib/verify/verbatim';
import { verifyOptimizedCv, enforceVerdicts } from '@/lib/verify/backtrack';

describe('extractNumerals', () => {
    it('extracts percentages and normalizes ranges to atomic tokens', () => {
        // A written range and its reworded prose form must yield the same facts,
        // so rephrasing "22%→54%" as "from 22% to 54%" is not seen as new.
        expect([...extractNumerals('tăng từ 22%→54%')].sort()).toEqual(['22%', '54%']);
        expect([...extractNumerals('grew from 22% to 54%')].sort()).toEqual(['22%', '54%']);
    });
    it('folds VN/EN thousands separators to the same number', () => {
        expect(extractNumerals('10.000+ người dùng').has('10000')).toBe(true);
        expect(extractNumerals('10,000 users').has('10000')).toBe(true);
    });
    it('tags duration units', () => {
        expect(extractNumerals('3 năm kinh nghiệm').has('3y')).toBe(true);
        expect(extractNumerals('3 years of experience').has('3y')).toBe(true);
    });
});

describe('diffFacts', () => {
    it('reports a numeral present only in the output as added', () => {
        const src = extractFacts('reduced latency by 40%');
        const out = extractFacts('reduced cost by 30%');
        const { added, missing } = diffFacts(src, out);
        expect(added).toContain('30%');
        expect(missing).toContain('40%');
    });
    it('does not report a token present in both source and output', () => {
        const src = extractFacts('built the Go service', { skills: ['Go', 'Postgres'] });
        const out = extractFacts('rebuilt the Go service', { skills: ['Go', 'Postgres'] });
        expect(diffFacts(src, out).added).toEqual([]);
    });
});

describe('assertVerbatim', () => {
    it('is whitespace- and accent-insensitive', () => {
        expect(assertVerbatim('led a  team', 'I led a team of 3')).toBe(true);
        expect(assertVerbatim('Kỹ năng', 'co ky nang tot')).toBe(true);
    });
    it('rejects genuine wording changes', () => {
        expect(assertVerbatim('managed the team', 'led a team of 3')).toBe(false);
    });
});

// Shared fixture for the backtrack probes.
const origCv = {
    skills: ['Go', 'Postgres', 'Docker'],
    experience: [{
        title: 'Senior Dev', company: 'ACME', duration_months: 24,
        description: 'built the billing system\nled a team of 3\nreduced latency by 40%',
    }],
    projects: [{ name: 'Proj X', description: 'designed schema\nshipped v1' }],
};

describe('verifyOptimizedCv — verified probes', () => {
    // P3 — the model INVENTED a metric ("30%") the source never mentioned. The
    // bullet must be classed new_facts/never and the entry description reverted.
    it('P3: flags a fabricated numeral as never and reverts the entry', () => {
        const optimized = {
            skills: origCv.skills,
            experience: [{
                title: 'Senior Dev', company: 'ACME', duration_months: 24,
                description: 'built the billing system\nled a team of 3\nreduced latency by 40%\ncut infra cost by 30%',
            }],
            projects: origCv.projects,
        };
        const verdicts = verifyOptimizedCv(origCv, optimized);
        const never = verdicts.find(v => v.tier === 'never');
        expect(never).toBeTruthy();
        expect(never?.added).toContain('30%');

        const { cv, reverted, flags } = enforceVerdicts(origCv, optimized, verdicts);
        const exp = (cv.experience as Record<string, unknown>[])[0];
        expect(exp.description).toBe(origCv.experience[0].description);
        expect(reverted.some(r => r.startsWith('experience['))).toBe(true);
        // Flags in a reverted entry are dropped (those bullets no longer exist).
        expect(flags.every(f => f.section !== 'experience' || f.entryKey !== never?.entryKey)).toBe(true);
    });

    // Referencing a skill the candidate genuinely lists (even one absent from
    // that entry's original bullets) is a rephrase, not fabrication: backtrack
    // seeds the source facts with every CV skill.
    it('does not treat adding a known CV skill as fabrication', () => {
        const orig = {
            skills: ['Go'],
            experience: [{ title: 'Dev', company: 'ACME', duration_months: 12, description: 'built the service' }],
            projects: [],
        };
        const optimized = {
            skills: ['Go'],
            experience: [{ title: 'Dev', company: 'ACME', duration_months: 12, description: 'built the service using Go' }],
            projects: [],
        };
        const verdicts = verifyOptimizedCv(orig, optimized);
        expect(verdicts.some(v => v.tier === 'never')).toBe(false);
    });

    // P4 — pure rephrase, no new facts. Reworded bullets are flag (defend-this),
    // verbatim bullets are ok; nothing is reverted.
    it('P4: classes a clean rephrase as flag, not never', () => {
        const optimized = {
            skills: origCv.skills,
            experience: [{
                title: 'Senior Dev', company: 'ACME', duration_months: 24,
                description: 'architected the billing system\ndirected a team of 3\nreduced latency by 40%',
            }],
            projects: origCv.projects,
        };
        const verdicts = verifyOptimizedCv(origCv, optimized);
        expect(verdicts.some(v => v.tier === 'never')).toBe(false);
        expect(verdicts.some(v => v.tier === 'flag')).toBe(true);

        const { cv, reverted, flags } = enforceVerdicts(origCv, optimized, verdicts);
        expect(reverted).toEqual([]);
        expect(flags.length).toBeGreaterThan(0);
        expect((cv.experience as Record<string, unknown>[])[0].description)
            .toBe(optimized.experience[0].description);
    });
});
