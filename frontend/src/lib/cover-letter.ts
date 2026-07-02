// Per-job cover letter ("thư giới thiệu") generator — bilingual (VI + EN) so the
// user can switch/download either. Same inputs as the CV optimizer (cv + jd +
// match) and the SAME anti-fabrication rule: only facts already in the CV — no
// invented achievements, employers, or numbers.
//
// We ask for STRUCTURED JSON {vi, en} (not free text): JSON string fields carry
// real newlines through JSON.parse, which both gives us two languages in one
// call AND avoids the model wrapping prose in stray [ ] brackets / quotes.
//
// Token discipline: we compact the CV/JD to the fields a letter draws on
// (dropping avatar base64, contact PII, preferences) and drop pretty-printing.
import { callAIJudge } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';
import type { CoverLetter } from '@/lib/types';

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? v as Rec : {});
const asArr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(asRec) : []);

function compactCv(cv: unknown): Rec {
    const c = asRec(cv);
    return {
        name: c.name,
        summary: c.summary,
        skills: c.skills,
        experience: asArr(c.experience).map((e) => ({
            title: e.title, company: e.company,
            start_date: e.start_date, end_date: e.end_date,
            description: e.description,
        })),
        education: asArr(c.education).map((e) => ({ degree: e.degree, institution: e.institution })),
        projects: asArr(c.projects).map((p) => ({ name: p.name, description: p.description })),
        certifications: asArr(c.certifications).map((x) => ({ name: x.name })),
    };
}

function compactJd(jd: unknown): Rec {
    const j = asRec(jd);
    return {
        title: j.title, company: j.company, seniority: j.seniority_expected ?? j.seniority,
        must_have: j.must_have, nice_to_have: j.nice_to_have,
        responsibilities: j.responsibilities,
    };
}

const SCHEMA = {
    type: 'OBJECT',
    properties: {
        vi: { type: 'STRING' },  // Vietnamese letter
        en: { type: 'STRING' },  // English letter (same substance)
    },
    required: ['vi', 'en'],
};

const SYSTEM_PROMPT = `Bạn là chuyên gia viết thư giới thiệu (cover letter) xin việc.

Viết HAI phiên bản CÙNG NỘI DUNG của một lá thư giới thiệu chuyên nghiệp, đầy đủ, chân thực cho vị trí trong Job Description: một bản tiếng Việt ("vi") và một bản tiếng Anh ("en").

Quy tắc BẮT BUỘC:
- CHỈ dùng thông tin CÓ THẬT trong CV (kinh nghiệm, kỹ năng, thành tích, con số). TUYỆT ĐỐI KHÔNG bịa công ty, chức danh, dự án, hay số liệu không có trong CV.
- Chọn 3–4 điểm khớp mạnh nhất với JD và diễn giải CỤ THỂ bằng bằng chứng từ CV (dự án, kết quả, con số) — không nói chung chung.
- Mỗi bản 300–400 từ, 4–5 đoạn: (1) mở đầu nêu vị trí + vì sao quan tâm; (2)(3) thân bài chứng minh năng lực khớp JD; (4) vì sao phù hợp công ty; (5) cảm ơn + mong trao đổi.
- Bản "en" là bản tiếng Anh tự nhiên, KHÔNG phải dịch máy word-by-word.
- Trong MỖI chuỗi, ngăn cách các đoạn bằng một dòng trống thật (ký tự xuống dòng), KHÔNG viết placeholder "[...]", KHÔNG markdown, KHÔNG bọc thư trong dấu ngoặc [ ] hay dấu nháy.
- Trả về DUY NHẤT JSON đúng schema {"vi": "...", "en": "..."}, không thêm gì khác.`;

// Belt-and-suspenders: strip any stray JSON-array/quote wrapper or literal \n
// the model still emits, and collapse blank-line runs.
function normalizeLetter(raw: string): string {
    let s = (raw || '').trim();
    if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
            const v = JSON.parse(s);
            if (Array.isArray(v)) s = v.filter((x) => typeof x === 'string').join('\n\n');
            else if (typeof v === 'string') s = v;
        } catch { /* not valid JSON — fall through to char stripping */ }
    }
    s = s
        .replace(/\r\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/^\s*[[\]]\s*$/gm, '')  // drop a lone "[" or "]" line
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
    return s;
}

export async function generateCoverLetter(
    cv: unknown, jd: unknown, match?: unknown,
): Promise<CoverLetter> {
    if (!cv || !jd) throw new Error('cv and jd are required');
    const matchLine = match
        ? `\nĐỘ KHỚP ĐÃ CHẤM (tham khảo để chọn điểm mạnh nào nên nêu): ${JSON.stringify(match)}`
        : '';
    const userPrompt = `Viết thư giới thiệu (cả tiếng Việt và tiếng Anh) cho ứng viên ứng tuyển vị trí trong JD dưới đây, chỉ dựa trên CV thật.

CV: ${JSON.stringify(compactCv(cv))}

JOB DESCRIPTION: ${JSON.stringify(compactJd(jd))}${matchLine}

Trả về JSON {"vi","en"}, mỗi bản 300–400 từ, các đoạn cách nhau bằng dòng trống thật.`;

    const raw = await callAIJudge(SYSTEM_PROMPT, userPrompt, SCHEMA);
    const parsed = safeJsonParse<Partial<CoverLetter>>(raw);
    const vi = normalizeLetter(parsed?.vi ?? '');
    const en = normalizeLetter(parsed?.en ?? '');
    if (!vi && !en) throw new Error('AI trả về thư rỗng. Vui lòng thử lại.');
    // If one language came back empty, fall back to the other so the UI always
    // has something to show for both tabs.
    return { vi: vi || en, en: en || vi };
}
