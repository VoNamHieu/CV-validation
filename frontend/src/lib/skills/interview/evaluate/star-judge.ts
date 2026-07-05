// The evaluator's ONLY LLM call. Judges structure (did the answer cover
// Situation/Task/Action/Result) and — for 'translate' questions only —
// SUBSTANCE: did the answer keep the meaning (what/who/impact) regardless of
// wording. Answering "in your own words" must score 'ok' even with different
// vocabulary; that's the whole point of the translate drill.

import { callAIJudge } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';
import type { Question } from '@/lib/skills/interview/types';

export interface StarJudgeResult {
    star: { s: boolean; t: boolean; a: boolean; r: boolean };
    substance: 'ok' | 'partial' | 'none';
    bridge_hint_vi: string;
}

const BOOL = { type: 'BOOLEAN' } as const;
const STR = { type: 'STRING' } as const;

const STAR_JUDGE_SCHEMA: Record<string, unknown> = {
    type: 'OBJECT',
    properties: {
        star: {
            type: 'OBJECT',
            properties: { s: BOOL, t: BOOL, a: BOOL, r: BOOL },
            required: ['s', 't', 'a', 'r'],
        },
        substance: STR, // "ok" | "partial" | "none"
        bridge_hint_vi: STR,
    },
    required: ['star', 'substance', 'bridge_hint_vi'],
};

const SYSTEM_PROMPT = `Bạn là giám khảo phỏng vấn. Chấm một câu trả lời theo cấu trúc STAR và độ đầy đủ. Trả JSON:
- "star": mỗi trường true/false — câu trả lời có nêu Situation (bối cảnh), Task (nhiệm vụ), Action (hành động), Result (kết quả) hay không.
- "substance": CHỈ áp dụng cho câu hỏi dạng "nói lại bằng lời của bạn" (translate). Chấm Ý NGHĨA, KHÔNG chấm từ vựng: "ok" nếu diễn đạt bằng lời riêng vẫn nêu đúng đã-làm-gì / cho-ai / tác-động; "partial" nếu thiếu một phần; "none" nếu sai hoặc không liên quan. Với câu hỏi KHÁC, luôn trả "ok".
- "bridge_hint_vi": 1 câu gợi ý TIẾNG VIỆT giúp ứng viên bổ sung phần còn thiếu (ngắn gọn, hành động cụ thể).

Không bịa thông tin. Chỉ dựa vào câu hỏi và câu trả lời được cấp.`;

function asBool(v: unknown): boolean {
    return v === true;
}

/** Judge one answer. Falls back to a neutral verdict if the model errors. */
export async function judgeStar(question: Question, answer: string): Promise<StarJudgeResult> {
    const userPrompt = JSON.stringify({
        section: question.section,
        question: question.text_vi,
        is_translate: question.section === 'translate',
        answer,
    });
    const raw = await callAIJudge(SYSTEM_PROMPT, userPrompt, STAR_JUDGE_SCHEMA);
    const parsed = safeJsonParse(raw) as Record<string, unknown> | null;
    const star = (parsed?.star && typeof parsed.star === 'object' ? parsed.star : {}) as Record<string, unknown>;
    const substanceRaw = parsed?.substance;
    const substance = substanceRaw === 'partial' || substanceRaw === 'none' ? substanceRaw : 'ok';
    return {
        star: { s: asBool(star.s), t: asBool(star.t), a: asBool(star.a), r: asBool(star.r) },
        substance,
        bridge_hint_vi: typeof parsed?.bridge_hint_vi === 'string' ? parsed.bridge_hint_vi : '',
    };
}
