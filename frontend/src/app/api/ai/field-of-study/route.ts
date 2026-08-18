import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { callAILight } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';
import { FIELD_OF_STUDY_CATALOG } from '@/lib/field-of-study-catalog';

/**
 * POST /api/ai/field-of-study
 *
 * The LONG-TAIL of the field-of-study adapter. The deterministic layer
 * (lib/field-of-study) maps the common Vietnamese/English majors; anything it
 * does not know reaches here so the intern apply-agent does not gap mid-run on a
 * single-select closed catalogue.
 *
 * Input:  { majors: string[] }  — raw majors the deterministic layer could not place
 * Output: { map: { [rawMajor]: catalogueLabel } }  — only entries the model
 *         resolved to a REAL catalogue row; anything it could not place is
 *         omitted, so the caller keeps the raw value. For an intern posting the
 *         caller's apply-time gate (internApplyGaps) then BLOCKS that raw value
 *         rather than dispatch it into the closed dropdown.
 *
 * The model NEVER invents: the output is validated against the catalogue, so a
 * hallucinated major is dropped rather than sent to a real application.
 */
export async function POST(request: Request) {
    try {
        const unauth = await requireUser(request);
        if (unauth) return unauth;

        const { majors } = await request.json();
        const wanted = Array.isArray(majors)
            ? [...new Set(majors.map((m) => String(m ?? '').trim()).filter(Boolean))].slice(0, 40)
            : [];
        if (wanted.length === 0) return NextResponse.json({ map: {} });

        const prompt = `Map each candidate's field of study to the single closest option in a FIXED list.
This is for a Workday application whose "Field of Study" is a closed dropdown — a value not on the list is rejected.

## THE ONLY ALLOWED VALUES (choose from these EXACTLY, verbatim):
${FIELD_OF_STUDY_CATALOG.join('\n')}

## FIELDS OF STUDY TO MAP (may be Vietnamese or English):
${wanted.map((m, i) => `${i + 1}. ${m}`).join('\n')}

## RULES:
- "Field of study" is the MAJOR/subject (e.g. "Marketing", "International Business"), NOT a degree/qualification ("Cử nhân", "B.B.A.").
- Translate Vietnamese to English, then pick the closest allowed value by MEANING.
- The value you return MUST be copied EXACTLY from the allowed list above. Do not invent, abbreviate, or reword.
- If nothing on the list is a reasonable match, return null for that item — do not force a wrong one.

## OUTPUT (JSON only):
{ "results": [ { "input": "<the field of study, verbatim>", "label": "<an allowed value, verbatim, or null>" } ] }`;

        const result = await callAILight(
            'You map a field of study to the closest option in a fixed list, or null. Return JSON only, and copy labels verbatim from the list.',
            prompt,
        );
        const parsed = safeJsonParse<{ results?: Array<{ input?: string; label?: string | null }> }>(result);

        const CATALOG = new Set(FIELD_OF_STUDY_CATALOG);
        const map: Record<string, string> = {};
        for (const r of parsed?.results ?? []) {
            const input = String(r?.input ?? '').trim();
            const label = String(r?.label ?? '').trim();
            // Only accept a label the catalogue actually contains — a hallucinated
            // major is worse than a gap the review names.
            if (input && label && CATALOG.has(label)) map[input] = label;
        }
        return NextResponse.json({ map });
    } catch (error) {
        // Never fail the caller hard: an unresolved major just stays raw.
        const message = error instanceof Error ? error.message : 'field-of-study mapping failed';
        return NextResponse.json({ map: {}, detail: message }, { status: 200 });
    }
}
