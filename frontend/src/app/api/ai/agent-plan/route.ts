import { NextResponse } from 'next/server';
import { callGeminiLight } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';

/**
 * POST /api/ai/agent-plan
 *
 * The "brain" of the autonomous Apply Agent.
 * Receives the full page state + profile + action history,
 * and decides what to do next: FILL, CLICK, SCROLL, WAIT, DONE, or NEED_HUMAN.
 *
 * Uses callGeminiLight (no thinking budget) for fast responses on each loop iteration.
 */

interface FormField {
    index: number;
    tag: string;
    type: string;
    id: string;
    name: string;
    label: string;
    placeholder: string;
    ariaLabel: string;
    classes: string;
    value: string;
    options?: { value: string; text: string }[];
    required: boolean;
    componentType: string;
    selector: string;
}

interface PageButton {
    text: string;
    selector: string;
    type: 'navigation' | 'submit' | 'apply' | 'other';
}

interface PageError {
    message: string;
    nearFieldSelector?: string;
}

interface PageState {
    url: string;
    formFields: FormField[];
    buttons: PageButton[];
    errors: PageError[];
    stepIndicator?: { current: number; total: number } | null;
    completionSignals: string[];
    unfilledRequired: string[];
    totalFields: number;
}

interface HistoryEntry {
    iteration: number;
    state: {
        url: string;
        fieldCount: number;
        unfilled: number;
        errors: number;
        step: { current: number; total: number } | null;
        buttons: string[];
    };
    plan: { action: string; reason: string };
    result: Record<string, unknown>;
}

interface AgentPlanRequest {
    pageState: PageState;
    profileData: Record<string, unknown>;
    history: HistoryEntry[];
    hasCV: boolean;
}

interface AgentPlan {
    action: string;
    instructions?: Array<Record<string, unknown>>;
    clickTarget?: string;
    reason?: string;
    waitMs?: number;
}

export async function POST(request: Request) {
    try {
        const { pageState, profileData, history, hasCV } = (await request.json()) as AgentPlanRequest;

        if (!pageState || !profileData) {
            return NextResponse.json({ detail: 'pageState and profileData are required' }, { status: 400 });
        }

        // Truncate fields to avoid token limits — keep max 40 fields
        const fields = pageState.formFields?.slice(0, 40) || [];
        // Only include unfilled fields for filling decisions
        const unfilledFields = fields.filter(f => !f.value || f.value.trim() === '');
        const filledFields = fields.filter(f => f.value && f.value.trim() !== '');

        const prompt = `You are an autonomous form-filling agent on a job application page. You must decide the NEXT action to take.

## CURRENT PAGE STATE:
- URL: ${pageState.url}
- Total form fields: ${pageState.totalFields}
- Unfilled required fields: ${JSON.stringify(pageState.unfilledRequired)}
- Step indicator: ${pageState.stepIndicator ? `Step ${pageState.stepIndicator.current} of ${pageState.stepIndicator.total}` : 'None detected'}
- Validation errors: ${JSON.stringify(pageState.errors)}
- Completion signals: ${JSON.stringify(pageState.completionSignals)}
- Visible buttons: ${JSON.stringify(pageState.buttons)}

## UNFILLED FORM FIELDS (need filling):
${JSON.stringify(unfilledFields, null, 2)}

## ALREADY FILLED FIELDS:
${JSON.stringify(filledFields.map(f => ({ label: f.label || f.name, value: f.value, selector: f.selector })), null, 2)}

## USER PROFILE DATA:
${JSON.stringify(profileData, null, 2)}

## HAS CV FILE: ${hasCV}

## ACTION HISTORY (last ${history?.length || 0} actions):
${JSON.stringify(history || [], null, 2)}

## YOUR TASK:
Decide the single best next action. Return a JSON object.

## RULES:
1. If there are UNFILLED fields that match profile data → action "FILL" with fill instructions
2. If all current-step fields are filled and there's a "Next"/"Continue" button → action "CLICK" to go to next step
3. If there are validation errors → action "FILL" to correct the errored fields
4. If all fields are filled, no errors, and there's a "Submit"/"Apply" button → action "DONE" (let user review and submit manually)
5. If no fields found → action "SCROLL" to discover more fields
6. If the page shows success/completion → action "DONE"
7. If you're stuck or the form requires info not in the profile → action "NEED_HUMAN" with explanation
8. NEVER click Submit/Apply yourself — always return DONE and let the user submit
9. For fields with componentType 'react-select', 'mui-autocomplete', 'ant-select', 'select2', or 'custom-dropdown': use action 'custom-select'
10. For fields with componentType 'native-select': use action 'select'
11. For fields with componentType 'datepicker': use action 'datepicker'
12. For fields with componentType 'file-upload' and hasCV is true: use action 'upload'
13. For text inputs/textareas: use action 'fill'
14. Map profile data intelligently (Vietnamese + English field names):
    - "họ", "last name" → lastName
    - "tên", "first name" → firstName
    - "họ và tên", "full name" → fullName (or combine lastName + " " + firstName)
    - "email" → email
    - "phone", "điện thoại" → phone
    - "ngày sinh", "date of birth" → dateOfBirth
    - "giới tính", "gender" → gender
    - "địa chỉ" → address fields
    - "cover letter", "thư giới thiệu" → coverLetter
    - "salary", "lương" → currentSalary / desiredSalary
    - "chức danh", "title", "vị trí" → currentTitle
    - "kinh nghiệm" → yearsOfExperience
    - "kỹ năng", "skills" → skills
    - "bằng cấp", "education" → highestDegree
15. Build CSS selectors: prefer the selector already provided in each field object
16. NEVER fabricate data not in the profile
17. For dropdowns, pick the closest matching option from available choices

## OUTPUT FORMAT:
{
    "action": "FILL" | "CLICK" | "SCROLL" | "WAIT" | "DONE" | "NEED_HUMAN",
    "instructions": [                    // only for FILL action
        {
            "selector": "CSS selector",
            "action": "fill" | "select" | "custom-select" | "datepicker" | "upload" | "click",
            "value": "the value",
            "componentType": "native | react-select | ...",
            "fieldLabel": "human-readable label"
        }
    ],
    "clickTarget": "CSS selector",       // only for CLICK action
    "reason": "brief explanation of decision",
    "waitMs": 1000                        // how long to wait after this action
}`;

        const result = await callGeminiLight(
            'You are an autonomous form-filling agent. Analyze the page state and decide the next action. Return a JSON object with action, instructions/clickTarget, reason, and waitMs.',
            prompt
        );

        const plan = safeJsonParse<AgentPlan>(result);

        // Validate the plan structure
        if (!plan || typeof plan !== 'object' || !plan.action) {
            return NextResponse.json({
                action: 'NEED_HUMAN',
                reason: 'Failed to parse agent plan',
                waitMs: 1000,
            });
        }

        const validActions = ['FILL', 'CLICK', 'SCROLL', 'WAIT', 'DONE', 'NEED_HUMAN'];
        if (!validActions.includes(plan.action)) {
            plan.action = 'NEED_HUMAN';
            plan.reason = `Invalid action: ${plan.action}`;
        }

        // Validate fill instructions if present
        if (plan.action === 'FILL' && plan.instructions) {
            const validInstructionActions = ['fill', 'select', 'custom-select', 'datepicker', 'upload', 'click', 'type'];
            plan.instructions = plan.instructions.filter(
                (inst: Record<string, unknown>) =>
                    inst.selector && typeof inst.selector === 'string' &&
                    inst.action && validInstructionActions.includes(inst.action as string)
            );
        }

        return NextResponse.json(plan);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate agent plan';
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
