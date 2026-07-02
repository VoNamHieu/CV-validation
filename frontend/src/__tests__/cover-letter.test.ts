import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini call so we test the generator's own logic (validation,
// JSON parse, bracket/newline normalization, compaction) without a network call.
const callAIJudge = vi.fn();
vi.mock('@/lib/gemini', () => ({ callAIJudge: (...a: unknown[]) => callAIJudge(...a) }));

import { generateCoverLetter } from '@/lib/cover-letter';

const cv = { name: 'Nguyen Van A', summary: 'Backend engineer, 5y', skills: ['Go'] };
const jd = { title: 'Backend Engineer', must_have: ['Go', 'Postgres'] };
const match = { overall_score: 82 };
const reply = (vi_: string, en_: string) => JSON.stringify({ vi: vi_, en: en_ });

beforeEach(() => callAIJudge.mockReset());

describe('generateCoverLetter (bilingual)', () => {
    it('requires cv and jd', async () => {
        await expect(generateCoverLetter(null, jd)).rejects.toThrow();
        await expect(generateCoverLetter(cv, null)).rejects.toThrow();
        expect(callAIJudge).not.toHaveBeenCalled();
    });

    it('returns both languages, trimmed', async () => {
        callAIJudge.mockResolvedValueOnce(reply('  Thư tiếng Việt  ', '  English letter  '));
        const out = await generateCoverLetter(cv, jd, match);
        expect(out).toEqual({ vi: 'Thư tiếng Việt', en: 'English letter' });
    });

    it('normalizes literal \\n and strips a stray [ ] / quote wrapper', async () => {
        callAIJudge.mockResolvedValueOnce(reply('[\\n"Đoạn 1.\\n\\nĐoạn 2."\\n]', 'P1.\\n\\n\\n\\nP2.'));
        const out = await generateCoverLetter(cv, jd);
        expect(out.vi).toBe('Đoạn 1.\n\nĐoạn 2.');   // brackets + wrapping quotes gone
        expect(out.vi).not.toContain('[');
        expect(out.en).toBe('P1.\n\nP2.');            // 4 newlines collapsed to a blank line
    });

    it('falls back to the other language when one comes back empty', async () => {
        callAIJudge.mockResolvedValueOnce(reply('Chỉ có tiếng Việt', ''));
        const out = await generateCoverLetter(cv, jd);
        expect(out.en).toBe('Chỉ có tiếng Việt');
    });

    it('throws when both languages are empty', async () => {
        callAIJudge.mockResolvedValueOnce(reply('', '   '));
        await expect(generateCoverLetter(cv, jd)).rejects.toThrow();
    });

    it('sends a COMPACT cv/jd (no avatar/base64, no pretty-print) + match', async () => {
        callAIJudge.mockResolvedValueOnce(reply('vi', 'en'));
        const fatCv = { ...cv, userAvatarBase64: 'AAAA'.repeat(1000), contact: { phone: '090' } };
        await generateCoverLetter(fatCv, jd, match);
        const userPrompt = callAIJudge.mock.calls[0][1] as string;
        expect(userPrompt).toContain('Nguyen Van A');    // CV present
        expect(userPrompt).toContain('Backend Engineer'); // JD present
        expect(userPrompt).toContain('82');               // match present
        expect(userPrompt).not.toContain('userAvatarBase64'); // dropped
        expect(userPrompt).not.toContain('\n  "');        // not pretty-printed
        // Schema-based call → 3rd arg present.
        expect(callAIJudge.mock.calls[0].length).toBe(3);
    });
});
