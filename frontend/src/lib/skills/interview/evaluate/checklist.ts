// Merge deterministic pre-checks + the star-judge into the Checklist that gets
// persisted and shown. Deliberately NO numeric score / confidence axis — the
// UI shows ✓/△/✗ per dimension, never a grade.

import type { Checklist, Section } from '@/lib/skills/interview/types';
import type { PreChecks } from '@/lib/skills/interview/evaluate/pre-checks';
import type { StarJudgeResult } from '@/lib/skills/interview/evaluate/star-judge';

export function buildChecklist(pre: PreChecks, judge: StarJudgeResult, section: Section): Checklist {
    return {
        groundedness: pre.groundedness,
        specificity: pre.specificity,
        contradiction: pre.contradiction,
        star: judge.star,
        // Substance only carries meaning for the 'translate' drill.
        substance: section === 'translate' ? judge.substance : undefined,
    };
}
