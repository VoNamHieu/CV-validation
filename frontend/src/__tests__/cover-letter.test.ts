import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini call so we test the generator's own logic (validation, JSON
// parse, bracket/newline normalization, compaction, language) without a network call.
const callAIJudge = vi.fn();
vi.mock('@/lib/gemini', () => ({ callAIJudge: (...a: unknown[]) => callAIJudge(...a) }));

import { generateCoverLetter } from '@/lib/cover-letter';

const cv = { name: 'Nguyen Van A', summary: 'Backend engineer, 5y', skills: ['Go'] };
const jd = { title: 'Backend Engineer', must_have: ['Go', 'Postgres'] };
const match = { overall_score: 82 };
const reply = (letter: string) => JSON.stringify({ letter });

beforeEach(() => callAIJudge.mockReset());

describe('generateCoverLetter (single, chosen language)', () => {
    it('requires cv and jd', async () => {
        await expect(generateCoverLetter(null, jd, undefined, 'vi')).rejects.toThrow();
        await expect(generateCoverLetter(cv, null, undefined, 'vi')).rejects.toThrow();
        expect(callAIJudge).not.toHaveBeenCalled();
    });

    it('returns the letter text, trimmed', async () => {
        callAIJudge.mockResolvedValueOnce(reply('  Kính gửi Quý công ty...  '));
        expect(await generateCoverLetter(cv, jd, match, 'vi')).toBe('Kính gửi Quý công ty...');
    });

    it('normalizes literal \\n and strips a stray [ ] / quote wrapper', async () => {
        callAIJudge.mockResolvedValueOnce(reply('[\\n"Đoạn 1.\\n\\n\\n\\nĐoạn 2."\\n]'));
        const out = await generateCoverLetter(cv, jd, undefined, 'vi');
        expect(out).toBe('Đoạn 1.\n\nĐoạn 2.');   // brackets + wrapping quotes gone, blank run collapsed
        expect(out).not.toContain('[');
    });

    it('throws on an empty letter', async () => {
        callAIJudge.mockResolvedValueOnce(reply('   '));
        await expect(generateCoverLetter(cv, jd, undefined, 'vi')).rejects.toThrow();
    });

    it('writes in the requested language (label reaches the prompt)', async () => {
        callAIJudge.mockResolvedValueOnce(reply('letter'));
        await generateCoverLetter(cv, jd, match, 'en');
        const [systemPrompt, userPrompt] = callAIJudge.mock.calls[0] as [string, string];
        expect(systemPrompt).toContain('English');
        expect(userPrompt).toContain('English');
    });

    it('sends a COMPACT cv/jd (no avatar/base64, no pretty-print) + match, with a schema', async () => {
        callAIJudge.mockResolvedValueOnce(reply('letter'));
        const fatCv = { ...cv, userAvatarBase64: 'AAAA'.repeat(1000), contact: { phone: '090' } };
        await generateCoverLetter(fatCv, jd, match, 'vi');
        const userPrompt = callAIJudge.mock.calls[0][1] as string;
        expect(userPrompt).toContain('Nguyen Van A');
        expect(userPrompt).toContain('Backend Engineer');
        expect(userPrompt).toContain('82');
        expect(userPrompt).not.toContain('userAvatarBase64');
        expect(userPrompt).not.toContain('\n  "');
        expect(callAIJudge.mock.calls[0].length).toBe(3);   // schema-based call
    });
});
