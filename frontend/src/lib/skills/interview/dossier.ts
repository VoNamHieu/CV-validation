// Dossier orchestrator: deterministic slots → ONE constrained LLM call to
// polish wording (VN) + fill a STAR outline + surface verbatim evidence →
// deterministic repair. The model never decides WHICH questions exist (that's
// questions.ts) nor whether evidence is real (that's repair-dossier); it only
// writes the Vietnamese prose and copies quotes.

import { callAI } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';
import type { CVData, JDData, MatchResult } from '@/lib/types';
import { verifyOptimizedCv } from '@/lib/verify/backtrack';
import { buildCompanySlots } from '@/lib/skills/interview/company';
import { buildQuestionSlots } from '@/lib/skills/interview/questions';
import { repairDossier } from '@/lib/skills/interview/repair-dossier';
import type { Dossier, Question, QuestionSlot, StarOutline } from '@/lib/skills/interview/types';

const STR = { type: 'STRING' } as const;

export const DOSSIER_RESPONSE_SCHEMA: Record<string, unknown> = {
    type: 'OBJECT',
    properties: {
        questions: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    id: STR,
                    text_vi: STR,
                    why_vi: STR,
                    evidence: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: { quote: STR, entry_ref: STR },
                            required: ['quote'],
                        },
                    },
                    star: {
                        type: 'OBJECT',
                        properties: { s: STR, t: STR, a: STR, r: STR },
                        required: ['s', 't', 'a', 'r'],
                    },
                },
                required: ['id', 'text_vi', 'why_vi', 'evidence', 'star'],
            },
        },
    },
    required: ['questions'],
};

const DOSSIER_SYSTEM_PROMPT = `Bạn là chuyên gia coach phỏng vấn. Bạn nhận một DANH SÁCH SLOT câu hỏi đã được xác định sẵn (không tự thêm/bớt slot) kèm CV và JD. Với MỖI slot, hãy viết:
- "id": giữ NGUYÊN id của slot.
- "text_vi": câu hỏi phỏng vấn hoàn chỉnh bằng TIẾNG VIỆT, bám đúng ý định của slot (seed) và yêu cầu JD.
- "why_vi": 1 câu ngắn nêu yêu cầu JD mà câu hỏi này nhắm tới.
- "evidence": 0-3 trích dẫn NGUYÊN VĂN (copy y hệt, không sửa một ký tự) từ CV/ngữ cảnh chứng minh ứng viên có nền tảng để trả lời. Nếu không có câu nào phù hợp để trích nguyên văn, để mảng rỗng — TUYỆT ĐỐI không diễn giải lại hay bịa.
- "star": khung trả lời mẫu (Situation/Task/Action/Result) điền ~70% từ evidence, để ứng viên hoàn thiện phần còn lại. Mỗi trường 1 câu tiếng Việt.

QUY TẮC: chỉ dùng thông tin có trong CV/JD/ngữ cảnh được cấp. Không bịa số liệu, công ty, kỹ năng. Giữ nguyên tên công nghệ (React, SQL, AWS...).`;

function fallbackText(slot: QuestionSlot): string {
    const subject = slot.source.requirement ?? '';
    switch (slot.section) {
        case 'probe': return `Bạn có thể nói rõ hơn về kinh nghiệm thực tế với "${subject}"?`;
        case 'gap': return `JD yêu cầu "${subject}" — bạn sẽ tiếp cận hoặc bù đắp điều này như thế nào?`;
        case 'expand': return `Hãy kể một ví dụ cụ thể thể hiện thế mạnh của bạn về "${subject}".`;
        case 'case': return `Nếu gặp tình huống liên quan đến "${subject}", bạn sẽ xử lý ra sao?`;
        case 'translate': return `Hãy mô tả bằng lời của bạn công việc này đã làm gì và tạo ra kết quả gì?`;
        case 'company': return `Vì sao bạn muốn ứng tuyển vào vị trí này?`;
    }
}

const EMPTY_STAR: StarOutline = { s: '', t: '', a: '', r: '' };

function asStar(v: unknown): StarOutline {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
        s: String(o.s ?? ''), t: String(o.t ?? ''),
        a: String(o.a ?? ''), r: String(o.r ?? ''),
    };
}

/**
 * Generate the interview-prep dossier. `baseCv` is the source CV, `tailoredCv`
 * the optimized version (its rephrased bullets seed 'translate' questions),
 * `companyText` optional crawled company/role context.
 */
export async function generateDossier(
    baseCv: CVData, jd: JDData, match: MatchResult,
    tailoredCv?: CVData, companyText?: string,
): Promise<Dossier> {
    if (!baseCv || !jd) throw new Error('cv and jd are required');

    const flags = verifyOptimizedCv(baseCv, tailoredCv ?? baseCv).filter(v => v.tier === 'flag');
    const companySlots = buildCompanySlots(companyText);
    const slots = buildQuestionSlots(baseCv, jd, match, flags, companySlots);
    if (slots.length === 0) return { version: 1, questions: [] };

    const userPrompt = JSON.stringify({
        jd: { must_have: jd.must_have, responsibilities: jd.responsibilities, domain: jd.domain },
        cv: { summary: baseCv.summary, experience: baseCv.experience, projects: baseCv.projects, skills: baseCv.skills },
        company_context: companyText ?? '',
        slots: slots.map(s => ({ id: s.id, section: s.section, seed: s.seed_vi, grounding: s.grounding })),
    });

    const raw = await callAI(DOSSIER_SYSTEM_PROMPT, userPrompt, DOSSIER_RESPONSE_SCHEMA);
    const parsed = safeJsonParse(raw) as { questions?: unknown[] } | null;
    if (!parsed) throw new Error('AI trả về JSON không hợp lệ. Vui lòng thử lại.');

    const byId = new Map<string, Record<string, unknown>>();
    for (const q of Array.isArray(parsed.questions) ? parsed.questions : []) {
        const qq = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
        if (typeof qq.id === 'string') byId.set(qq.id, qq);
    }

    // Merge: section/source stay deterministic from the slot; text/evidence/STAR
    // come from the model (with a fallback so a skipped slot still yields a Q).
    const questions: Question[] = slots.map(slot => {
        const llm = byId.get(slot.id);
        const evidenceRaw = Array.isArray(llm?.evidence) ? (llm!.evidence as unknown[]) : [];
        return {
            id: slot.id,
            section: slot.section,
            text_vi: String(llm?.text_vi ?? '').trim() || fallbackText(slot),
            why_vi: String(llm?.why_vi ?? '').trim() || (slot.source.requirement ?? ''),
            evidence: evidenceRaw.map(e => {
                const ee = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
                return { quote: String(ee.quote ?? ''), entry_ref: ee.entry_ref ? String(ee.entry_ref) : undefined };
            }).filter(e => e.quote),
            star_outline: llm ? asStar(llm.star) : EMPTY_STAR,
            source: slot.source,
        };
    });

    const { dossier, repairs } = repairDossier(baseCv, questions, companyText ?? '');
    if (repairs.length) console.warn('[interview-prep] dossier repaired:', repairs);
    return dossier;
}
