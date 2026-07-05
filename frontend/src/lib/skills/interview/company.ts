// Company-context questions — GROUNDED ONLY. The only legitimate input is real
// crawled company/role text (from the history record); we never invent facts
// about the employer. If no such text exists, this emits nothing and the
// 'company' section simply doesn't appear (repair-dossier enforces the same).

import type { QuestionSlot } from '@/lib/skills/interview/types';

// Require enough text to actually quote — a bare domain word ("Fintech") is not
// grounding, so it produces no company questions.
const MIN_GROUNDING_CHARS = 40;

/**
 * Build company-context slots from crawled company/role text. Returns [] when
 * there's nothing substantive to ground on.
 */
export function buildCompanySlots(companyText: string | undefined | null): QuestionSlot[] {
    const text = (companyText ?? '').trim();
    if (text.length < MIN_GROUNDING_CHARS) return [];
    return [{
        id: 'company-0',
        section: 'company',
        source: {},
        seed_vi: 'Dựa trên mô tả công ty/vị trí, hỏi về động lực ứng tuyển và mức độ phù hợp của ứng viên.',
        grounding: text.slice(0, 1200),
    }];
}
