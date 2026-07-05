// DETERMINISTIC pre-checks — run BEFORE any LLM call, zero cost. They catch the
// failure modes that don't need judgment: an answer that ignores the CV, a
// fabricated number, a figure that contradicts the CV. Each failure carries a
// verbatim CV correction so the UI can show "CV bạn ghi: '<...>'".

import type { CVData, ExperienceDetail } from '@/lib/types';
import { extractFacts, extractNumerals, norm } from '@/lib/verify/facts';
import { flattenCvText } from '@/lib/skills/interview/repair-dossier';
import type { ChecklistAxis, Question } from '@/lib/skills/interview/types';

export interface PreChecks {
    groundedness: ChecklistAxis;
    specificity: ChecklistAxis;
    contradiction: ChecklistAxis;
}

const GROUNDEDNESS_PASS = 0.3; // fraction of evidence content-words the answer echoes

function contentTokens(s: string): Set<string> {
    return new Set(norm(s).split(' ').filter(t => t.length > 3));
}

// The CV text this question is grounded in — evidence quotes, or the flagged
// entry's original description for 'translate' questions.
function entryTextFor(question: Question, cv: CVData): string {
    const fromEvidence = question.evidence.map(e => e.quote).join('\n');
    if (fromEvidence.trim()) return fromEvidence;
    const ref = question.source.flag_bullet;
    if (ref && cv.experience?.[ref.entry]) return (cv.experience[ref.entry] as ExperienceDetail).description ?? '';
    return '';
}

function firstBulletWithNumber(cvText: string): string | undefined {
    return cvText.split('\n').find(l => /\d/.test(l));
}

function unitOf(token: string): string {
    return token.replace(/^[\d.]+/, '');
}

/** answer ∩ evidence: does the answer actually draw on the grounded CV lines? */
function checkGroundedness(answer: string, evidence: string): ChecklistAxis {
    const ev = contentTokens(evidence);
    if (ev.size === 0) return { status: 'partial', detail_vi: 'Không có dẫn chứng gốc để đối chiếu.' };
    const ans = contentTokens(answer);
    let hits = 0;
    for (const t of ev) if (ans.has(t)) hits++;
    const overlap = hits / ev.size;
    if (overlap >= GROUNDEDNESS_PASS) return { status: 'pass' };
    if (overlap > 0) return { status: 'partial', detail_vi: 'Câu trả lời chưa bám sát dẫn chứng trong CV.' };
    return { status: 'fail', detail_vi: 'Câu trả lời chưa liên hệ với kinh nghiệm đã nêu trong CV.' };
}

/** Every number in the answer must exist somewhere in the CV. */
function checkSpecificity(answer: string, cvNumerals: Set<string>, cvText: string): ChecklistAxis {
    const nums = extractNumerals(answer);
    if (nums.size === 0) {
        return { status: 'partial', detail_vi: 'Chưa có số liệu cụ thể, thêm con số định lượng nếu có.' };
    }
    const stray = [...nums].filter(n => !cvNumerals.has(n));
    if (stray.length === 0) return { status: 'pass' };
    return {
        status: 'fail',
        detail_vi: `Số liệu "${stray.join(', ')}" không có trong CV, chỉ dùng con số thật.`,
        cv_quote: firstBulletWithNumber(cvText),
    };
}

/** A stray answer number that collides on unit with the entry's number is a
 *  likely mis-statement of that figure (fixture: garbling 22% → 54%). */
function checkContradiction(answer: string, entryText: string, cvNumerals: Set<string>): ChecklistAxis {
    const entryNumerals = extractFacts(entryText).numerals;
    if (entryNumerals.size === 0) return { status: 'pass' };
    const entryUnits = new Set([...entryNumerals].map(unitOf));
    const conflicts = [...extractNumerals(answer)]
        .filter(n => !cvNumerals.has(n) && entryUnits.has(unitOf(n)));
    if (conflicts.length === 0) return { status: 'pass' };
    return {
        status: 'fail',
        detail_vi: `Số liệu "${conflicts.join(', ')}" mâu thuẫn với con số trong CV.`,
        cv_quote: entryText,
    };
}

/** Run all three deterministic checks for one answer. */
export function runPreChecks(answer: string, question: Question, cv: CVData): PreChecks {
    const cvText = flattenCvText(cv);
    const cvNumerals = extractNumerals(cvText);
    const entryText = entryTextFor(question, cv);
    return {
        groundedness: checkGroundedness(answer, entryText),
        specificity: checkSpecificity(answer, cvNumerals, cvText),
        contradiction: checkContradiction(answer, entryText, cvNumerals),
    };
}
