// DETERMINISTIC question-slot mapping — zero LLM cost. Turns the fit result,
// the verifier's rephrased-bullet flags, and the JD responsibilities into
// typed slots; dossier.ts later polishes wording + STAR, repair-dossier caps
// and grounds them. Keeping this pure makes the "which questions & why" logic
// unit-testable without any model call.

import type { CVData, JDData, MatchResult, RequirementMatch } from '@/lib/types';
import type { BulletVerdict } from '@/lib/verify/backtrack';
import { experienceKey, norm, projectKey } from '@/lib/verify/facts';
import type { QuestionSlot, Section } from '@/lib/skills/interview/types';

function bulletLines(desc: unknown): string[] {
    return String(desc ?? '').split('\n').map(l => l.trim()).filter(Boolean);
}

// Every CV line we can quote as evidence, in one flat list.
function cvBullets(cv: CVData): string[] {
    const out: string[] = [];
    if (cv.summary) out.push(...bulletLines(cv.summary));
    for (const e of cv.experience ?? []) out.push(...bulletLines(e.description));
    for (const p of cv.projects ?? []) out.push(...bulletLines(p.description));
    return out;
}

// Best-effort grounding: the CV bullet that shares the most content words with
// the requirement. Returns "" when nothing overlaps (LLM then has no crutch and
// repair will keep the question but likely drop unfounded evidence).
function groundingFor(requirement: string, bullets: string[]): string {
    const reqTokens = new Set(norm(requirement).split(' ').filter(t => t.length > 3));
    if (reqTokens.size === 0) return '';
    let best = '';
    let bestHits = 0;
    for (const b of bullets) {
        const bTokens = new Set(norm(b).split(' '));
        let hits = 0;
        for (const t of reqTokens) if (bTokens.has(t)) hits++;
        if (hits > bestHits) { bestHits = hits; best = b; }
    }
    return bestHits > 0 ? best : '';
}

const STATUS_SECTION: Record<RequirementMatch['status'], Section> = {
    met: 'expand',
    partial: 'probe',
    missing: 'gap',
};

const SEED_BY_SECTION: Record<Section, (subject: string) => string> = {
    probe: (s) => `Ứng viên chỉ đáp ứng MỘT PHẦN yêu cầu "${s}". Hỏi để làm rõ mức độ thành thạo thực tế.`,
    gap: (s) => `CV chưa thể hiện yêu cầu "${s}". Hỏi cách ứng viên bù đắp hoặc từng tiếp cận điều tương tự.`,
    expand: (s) => `Ứng viên đã đáp ứng "${s}". Hỏi để họ định lượng và làm nổi bật thế mạnh này.`,
    translate: (s) => `Gạch đầu dòng đã được viết lại khi tối ưu: "${s}". Yêu cầu ứng viên kể lại bằng lời của chính mình.`,
    case: (s) => `Trách nhiệm trong JD: "${s}". Dựng một tình huống để kiểm tra cách ứng viên xử lý.`,
    company: (s) => `Bối cảnh công ty/vị trí: "${s}". Hỏi về động lực và mức độ phù hợp.`,
};

/**
 * Build the deterministic question slots. `flags` are the verifier's flag-tier
 * (rephrased, no-new-facts) bullets; `companySlots` come from company.ts.
 */
export function buildQuestionSlots(
    cv: CVData,
    jd: JDData,
    match: MatchResult,
    flags: BulletVerdict[],
    companySlots: QuestionSlot[] = [],
): QuestionSlot[] {
    const bullets = cvBullets(cv);
    const slots: QuestionSlot[] = [];
    let n = 0;
    const mk = (section: Section, subject: string, source: QuestionSlot['source'], grounding: string): QuestionSlot => ({
        id: `s${++n}`,
        section,
        source,
        seed_vi: SEED_BY_SECTION[section](subject),
        grounding,
    });

    // 1. Requirements → expand / probe / gap by coverage status.
    const requirements = match.must_have_match?.requirements ?? [];
    for (const r of requirements) {
        const section = STATUS_SECTION[r.status] ?? 'gap';
        // A missing requirement has no CV grounding by definition.
        const grounding = section === 'gap' ? '' : groundingFor(r.requirement, bullets);
        slots.push(mk(section, r.requirement, { requirement: r.requirement }, grounding));
    }

    // 2. Verifier flags → translate. Map the entry key back to a numeric index
    //    so coaching can deep-link the editor; ground on the ORIGINAL bullet.
    for (const f of flags) {
        if (f.tier !== 'flag') continue;
        const arr = (f.section === 'experience' ? cv.experience : cv.projects) ?? [];
        const keyOf = f.section === 'experience' ? experienceKey : projectKey;
        const entry = arr.findIndex(e => keyOf(e as unknown as Record<string, unknown>) === f.entryKey);
        const origBullets = entry >= 0 ? bulletLines((arr[entry] as { description?: string }).description) : [];
        const grounding = origBullets[f.bulletIndex] ?? origBullets.join('\n');
        slots.push(mk('translate', f.text, { flag_bullet: { entry, bullet: f.bulletIndex } }, grounding));
    }

    // 3. JD responsibilities → case scenarios (top 6, no CV grounding needed).
    for (const resp of (jd.responsibilities ?? []).slice(0, 6)) {
        slots.push(mk('case', resp, { requirement: resp }, ''));
    }

    // 4. Company slots (already built + grounded by company.ts).
    slots.push(...companySlots.map(s => ({ ...s, id: `s${++n}` })));

    return slots;
}
