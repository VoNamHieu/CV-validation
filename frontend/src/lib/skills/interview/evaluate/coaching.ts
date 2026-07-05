// Direction-based coaching (no scores). Two zero-cost rules + the judge's hint:
//  1. If the candidate still can't restate a rephrased bullet in their own words
//     by the 2nd attempt (substance='none'), the CV bullet itself is probably
//     over-polished → recommend editing it (UI deep-links StepEditCv).
//  2. If their self-reflection names the very dimension they failed, praise the
//     calibration — self-awareness is the skill we're building.

import { norm } from '@/lib/verify/facts';
import type { Checklist } from '@/lib/skills/interview/types';
import type { Question } from '@/lib/skills/interview/types';

export interface Coaching {
    // Deep-link target for "sửa lại gạch đầu dòng này trong CV".
    recommend_bullet_edit?: { entry: number; bullet: number };
    praise_vi?: string;
    hint_vi?: string;
}

// Which failure each self-reflection keyword corresponds to.
const AXIS_KEYWORDS: Record<'groundedness' | 'specificity' | 'contradiction' | 'star', string[]> = {
    groundedness: ['dan chung', 'vi du', 'kinh nghiem', 'chung minh'],
    specificity: ['so lieu', 'con so', 'dinh luong', 'chi tiet', 'cu the'],
    contradiction: ['mau thuan', 'sai so', 'nham', 'khong khop'],
    star: ['ket qua', 'cau truc', 'tinh huong', 'hanh dong', 'star'],
};

function failedAxes(checklist: Checklist): Array<keyof typeof AXIS_KEYWORDS> {
    const out: Array<keyof typeof AXIS_KEYWORDS> = [];
    if (checklist.groundedness.status === 'fail') out.push('groundedness');
    if (checklist.specificity.status === 'fail') out.push('specificity');
    if (checklist.contradiction.status === 'fail') out.push('contradiction');
    const star = checklist.star;
    if (!(star.s && star.t && star.a && star.r)) out.push('star');
    return out;
}

export function buildCoaching(
    checklist: Checklist,
    question: Question,
    attemptNo: number,
    selfReflection?: string,
    bridgeHintVi?: string,
): Coaching {
    const coaching: Coaching = {};

    // Rule 1 — persistent inability to restate → the bullet is the problem.
    if (checklist.substance === 'none' && attemptNo >= 2 && question.source.flag_bullet) {
        coaching.recommend_bullet_edit = question.source.flag_bullet;
    }

    // Rule 2 — self-reflection that names a real failure gets calibration praise.
    const reflection = norm(selfReflection ?? '');
    if (reflection) {
        const failing = failedAxes(checklist);
        const calibrated = failing.some(axis => AXIS_KEYWORDS[axis].some(k => reflection.includes(k)));
        if (calibrated) {
            coaching.praise_vi = 'Bạn đã tự nhận ra đúng điểm cần cải thiện, khả năng tự đánh giá là một thế mạnh khi phỏng vấn.';
        }
    }

    if (bridgeHintVi) coaching.hint_vi = bridgeHintVi;
    return coaching;
}
