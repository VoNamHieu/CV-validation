import { NextResponse } from 'next/server';
import { callAIJudge } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';

/**
 * POST /api/ai/map-form
 *
 * The "brain" of the Apply Agent.
 * Takes form fields from a job page + user profile data,
 * returns intelligent fill instructions.
 *
 * Input:  { formFields: FormField[], profileData: ProfileData }
 * Output: { instructions: FillInstruction[] }
 */
export async function POST(request: Request) {
    try {
        const { formFields, profileData } = await request.json();

        if (!formFields || !Array.isArray(formFields) || formFields.length === 0) {
            return NextResponse.json({ detail: 'formFields is required (non-empty array)' }, { status: 400 });
        }
        if (!profileData || typeof profileData !== 'object') {
            return NextResponse.json({ detail: 'profileData is required' }, { status: 400 });
        }

        const prompt = `You are a form-filling AI agent. Your job is to map user profile data to HTML form fields on a job application page.

## USER PROFILE DATA:
${JSON.stringify(profileData, null, 2)}

## FORM FIELDS FOUND ON PAGE:
${JSON.stringify(formFields, null, 2)}

## YOUR TASK:
For each form field, determine if you have matching data from the user profile. Return fill instructions as a JSON array.

## RULES:
1. Only fill fields where you have matching data. Skip fields you can't fill.
2. For "select" fields, match the value to one of the available options. Use the option's VALUE, not text.
3. For text inputs, use the most appropriate profile field.
4. Map intelligently:
   - "họ", "last name", "surname" → lastName
   - "tên", "first name", "given name" → firstName
   - "họ và tên", "full name", "name" → fullName
   - "email", "e-mail" → email
   - "phone", "điện thoại", "số điện thoại" → phone
   - "date of birth", "ngày sinh" → dateOfBirth
   - "address", "địa chỉ" → address fields
   - "cover letter", "thư giới thiệu" → coverLetter or summary
   - "salary", "mức lương" → currentSalary / desiredSalary
   - "title", "chức danh", "vị trí" → currentTitle
   - "experience", "kinh nghiệm" → yearsOfExperience
   - "skills", "kỹ năng" → skills (join with comma)
   - "education", "học vấn" → highestDegree
5. Build CSS selectors: prefer #id, then [name="..."], then tag.class. If the field has a "selector" property, use that.
6. For native dropdowns (select), look at the options and pick the best match. Use action "select".
7. For custom dropdowns (componentType: "react-select", "mui-autocomplete", "ant-select", "select2", "custom-dropdown"), use action "custom-select" with the display text as value.
8. For datepicker fields (componentType: "datepicker"), use action "datepicker" and format the date as shown in the placeholder.
9. For file upload fields (componentType: "file-upload"), use action "upload" if the user has a CV.
10. NEVER fabricate data. Only use what's in the profile.

## OUTPUT FORMAT:
Return a JSON array of instructions:
[
  {
    "selector": "CSS selector to find the element",
    "action": "fill" | "select" | "custom-select" | "datepicker" | "upload" | "click",
    "value": "the value to set",
    "componentType": "native | react-select | mui-autocomplete | ant-select | select2 | custom-dropdown | datepicker | file-upload",
    "fieldLabel": "human-readable label for logging"
  }
]

If no fields can be mapped, return an empty array [].`;

        const result = await callAIJudge(
            'You are a form-filling AI agent. Map user profile data to HTML form fields. Return a JSON array of fill instructions.',
            prompt
        );
        const instructions = safeJsonParse<Record<string, unknown>[]>(result);

        // Validate instructions format
        if (!Array.isArray(instructions)) {
            return NextResponse.json({ instructions: [] });
        }

        // Filter valid instructions
        const validInstructions = instructions.filter(
            (inst: Record<string, unknown>) =>
                inst.selector && typeof inst.selector === 'string' &&
                inst.action && typeof inst.action === 'string' &&
                ['fill', 'select', 'custom-select', 'datepicker', 'upload', 'click', 'type'].includes(inst.action as string)
        );

        return NextResponse.json({ instructions: validInstructions });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to map form fields';
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
