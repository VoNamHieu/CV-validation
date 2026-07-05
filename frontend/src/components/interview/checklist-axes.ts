// Turn a Checklist into the ordered display axes shown as ✓/△/✗ (never a score).
// Shared by ChecklistResult and CompareAttempts so the two always agree.
import type { AxisStatus, Checklist } from '@/lib/skills/interview/types';

export interface DisplayAxis {
    key: string;
    label_vi: string;
    status: AxisStatus;
    detail_vi?: string;
    cv_quote?: string;
}

function starStatus(star: Checklist['star']): AxisStatus {
    const n = [star.s, star.t, star.a, star.r].filter(Boolean).length;
    return n === 4 ? 'pass' : n === 0 ? 'fail' : 'partial';
}

function substanceStatus(s: NonNullable<Checklist['substance']>): AxisStatus {
    return s === 'ok' ? 'pass' : s === 'partial' ? 'partial' : 'fail';
}

export function checklistAxes(c: Checklist): DisplayAxis[] {
    const axes: DisplayAxis[] = [
        { key: 'groundedness', label_vi: 'Bám sát dẫn chứng', ...c.groundedness },
        { key: 'specificity', label_vi: 'Số liệu cụ thể', ...c.specificity },
        { key: 'contradiction', label_vi: 'Không mâu thuẫn với CV', ...c.contradiction },
        { key: 'star', label_vi: 'Cấu trúc STAR', status: starStatus(c.star) },
    ];
    if (c.substance) {
        axes.push({ key: 'substance', label_vi: 'Giữ đúng ý nghĩa', status: substanceStatus(c.substance) });
    }
    return axes;
}

export const AXIS_META: Record<AxisStatus, { symbol: string; color: string }> = {
    pass: { symbol: '✓', color: 'var(--accent-green)' },
    partial: { symbol: '△', color: 'var(--accent-amber)' },
    fail: { symbol: '✗', color: 'var(--accent-red)' },
};
