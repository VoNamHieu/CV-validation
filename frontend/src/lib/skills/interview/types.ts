// Central schema for the interview skill — the one place Question / Dossier /
// Checklist are defined so the deterministic (questions/company), generative
// (dossier) and evaluator (Phase 3) modules all agree on shape.

// A question's origin — drives ordering, default-open state, and coaching.
//   expand    ← a JD requirement the CV already MEETS (elaborate / quantify)
//   probe     ← a requirement only PARTIALLY covered (highest priority)
//   gap       ← a requirement the CV is MISSING (how would you compensate)
//   translate ← a bullet the optimizer REPHRASED (say it in your own words)
//   case      ← a JD responsibility turned into a scenario
//   company   ← grounded in the crawled company/role context
export type Section = 'expand' | 'probe' | 'gap' | 'translate' | 'case' | 'company';

// Priority order: partial-coverage probes first, met-elaboration last.
export const SECTION_ORDER: Section[] = ['probe', 'gap', 'translate', 'case', 'company', 'expand'];

export const SECTION_LABEL_VI: Record<Section, string> = {
    probe: 'Điểm chưa chắc, cần đào sâu',
    gap: 'Điểm còn thiếu',
    translate: 'Nói lại bằng lời của bạn',
    case: 'Tình huống theo mô tả công việc',
    company: 'Về công ty & vị trí',
    expand: 'Thế mạnh, hãy làm nổi bật',
};

export interface Evidence {
    // VERBATIM excerpt from the CV (asserted in repair-dossier; dropped if not).
    quote: string;
    // Optional pointer to which CV entry it came from ("experience[0]").
    entry_ref?: string;
}

// ~70%-filled STAR skeleton drawn from the evidence — a scaffold, not a script.
export interface StarOutline {
    s: string;
    t: string;
    a: string;
    r: string;
}

export interface QuestionSource {
    // The JD requirement / responsibility this question targets.
    requirement?: string;
    // For 'translate' questions: the rephrased bullet's coordinates.
    flag_bullet?: { entry: number; bullet: number };
}

export interface Question {
    id: string;
    section: Section;
    text_vi: string;
    why_vi: string;
    evidence: Evidence[];
    star_outline: StarOutline;
    source: QuestionSource;
}

export interface Dossier {
    version: number;
    questions: Question[];
}

// ── Evaluator output (Phase 3) — defined here for a single source of truth ──
export type AxisStatus = 'pass' | 'partial' | 'fail';

export interface ChecklistAxis {
    status: AxisStatus;
    // Vietnamese explanation shown under the axis.
    detail_vi?: string;
    // Verbatim CV text to show as the correction ("CV bạn ghi: …").
    cv_quote?: string;
}

export interface Checklist {
    // Deterministic pre-checks (zero LLM cost).
    groundedness: ChecklistAxis;
    specificity: ChecklistAxis;
    contradiction: ChecklistAxis;
    // From the single star-judge LLM call.
    star: { s: boolean; t: boolean; a: boolean; r: boolean };
    // Only meaningful for 'translate' questions: did the answer keep the MEANING.
    substance?: 'ok' | 'partial' | 'none';
}

// ── Deterministic slot (pre-LLM) — questions.ts / company.ts emit these ──
export interface QuestionSlot {
    id: string;
    section: Section;
    source: QuestionSource;
    // Raw material handed to the LLM to polish into text_vi / why_vi / STAR.
    seed_vi: string;
    // Best-effort verbatim CV text the LLM should ground evidence in (may be "").
    grounding: string;
}
