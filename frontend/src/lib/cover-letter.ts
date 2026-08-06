// Per-job cover letter ("thư giới thiệu") generator. The caller CHOOSES the
// target language (the picker in the editor); we generate ONE letter in that
// language. Same inputs as the CV optimizer (cv + jd + match) and the SAME
// anti-fabrication rule: only facts already in the CV — no invented
// achievements, employers, or numbers.
//
// TWO formats out of the same inputs, because they land in different places:
//   'letter'  — the 300–400 word document the user downloads as a PDF.
//   'message' — the 110–160 word note that goes in an ATS's free-text box
//               (SmartRecruiters' "Message to the Hiring Team" is 10 rows).
// A full letter pasted into that box reads as a wall of text with a signature
// block under a form that already collected the name, so it is not just the
// letter truncated — it is addressed and closed differently.
//
// We ask for a single-field JSON {letter} (not free prose): JSON string fields
// carry real newlines through JSON.parse and can't come back wrapped in stray
// [ ] brackets or quotes.
//
// Token discipline: we compact the CV/JD to the fields a letter draws on
// (dropping avatar base64, contact PII, preferences) and drop pretty-printing.
import { callAIJudge } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';
import { COVER_LETTER_LANGUAGES } from '@/lib/types';

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
    properties: { letter: { type: 'STRING' } },
    required: ['letter'],
};

/** Which shape of text to produce. See the file header. */
export type LetterFormat = 'letter' | 'message';

function systemPrompt(languageLabel: string, format: LetterFormat): string {
    if (format === 'message') {
        return `Bạn là chuyên gia viết lời nhắn ngắn gửi nhà tuyển dụng trong form ứng tuyển.

Viết một LỜI NHẮN NGẮN, tự nhiên, chân thực gửi đội tuyển dụng cho vị trí trong Job Description. Viết TOÀN BỘ bằng ${languageLabel}.

Quy tắc BẮT BUỘC:
- CHỈ dùng thông tin CÓ THẬT trong CV (kinh nghiệm, kỹ năng, thành tích, con số). TUYỆT ĐỐI KHÔNG bịa công ty, chức danh, dự án, hay số liệu không có trong CV.
- 110–160 từ, 2–3 đoạn ngắn: (1) ứng tuyển vị trí nào + vì sao quan tâm; (2) 2 bằng chứng CỤ THỂ từ CV khớp đúng yêu cầu chính của JD; (3) một câu kết mong được trao đổi.
- Đây là ô nhập trong form, KHÔNG phải lá thư: KHÔNG có "Kính gửi ..." trang trọng kiểu văn bản, KHÔNG ký tên, KHÔNG ghi ngày tháng, KHÔNG địa chỉ — form đã có tên và liên hệ rồi.
- Văn phong tự nhiên của người bản ngữ ${languageLabel}, KHÔNG dịch máy word-by-word. Tự tin nhưng không khoa trương.
- Ngăn cách các đoạn bằng một dòng trống thật (ký tự xuống dòng), KHÔNG viết placeholder "[...]", KHÔNG markdown, KHÔNG bọc trong dấu ngoặc [ ] hay dấu nháy.
- Trả về DUY NHẤT JSON đúng schema {"letter": "..."}, không thêm gì khác.`;
    }
    return `Bạn là chuyên gia viết thư giới thiệu (cover letter) xin việc.

Viết một lá thư giới thiệu CHUYÊN NGHIỆP, đầy đủ, chân thực cho vị trí trong Job Description. Viết TOÀN BỘ lá thư bằng ${languageLabel}.

Quy tắc BẮT BUỘC:
- CHỈ dùng thông tin CÓ THẬT trong CV (kinh nghiệm, kỹ năng, thành tích, con số). TUYỆT ĐỐI KHÔNG bịa công ty, chức danh, dự án, hay số liệu không có trong CV.
- Chọn 3–4 điểm khớp mạnh nhất với JD và diễn giải CỤ THỂ bằng bằng chứng từ CV (dự án, kết quả, con số) — không nói chung chung.
- 300–400 từ, 4–5 đoạn: (1) mở đầu nêu vị trí + vì sao quan tâm; (2)(3) thân bài chứng minh năng lực khớp JD; (4) vì sao phù hợp công ty; (5) cảm ơn + mong trao đổi.
- Văn phong tự nhiên của người bản ngữ ${languageLabel}, KHÔNG dịch máy word-by-word.
- Ngăn cách các đoạn bằng một dòng trống thật (ký tự xuống dòng), KHÔNG viết placeholder "[...]", KHÔNG markdown, KHÔNG bọc thư trong dấu ngoặc [ ] hay dấu nháy.
- Trả về DUY NHẤT JSON đúng schema {"letter": "..."}, không thêm gì khác.`;
}

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
    cv: unknown, jd: unknown, match: unknown, targetLang: string,
    format: LetterFormat = 'letter',
): Promise<string> {
    if (!cv || !jd) throw new Error('cv and jd are required');
    const label = COVER_LETTER_LANGUAGES[targetLang] || targetLang || 'Tiếng Việt';
    const matchLine = match
        ? `\nĐỘ KHỚP ĐÃ CHẤM (tham khảo để chọn điểm mạnh nào nên nêu): ${JSON.stringify(match)}`
        : '';
    const isMsg = format === 'message';
    const userPrompt = `${isMsg
        ? `Viết lời nhắn ngắn gửi đội tuyển dụng bằng ${label}`
        : `Viết thư giới thiệu bằng ${label}`} cho ứng viên ứng tuyển vị trí trong JD dưới đây, chỉ dựa trên CV thật.

CV: ${JSON.stringify(compactCv(cv))}

JOB DESCRIPTION: ${JSON.stringify(compactJd(jd))}${matchLine}

Trả về JSON {"letter"}, ${isMsg ? '110–160' : '300–400'} từ, các đoạn cách nhau bằng dòng trống thật.`;

    const raw = await callAIJudge(systemPrompt(label, format), userPrompt, SCHEMA);
    const parsed = safeJsonParse<{ letter?: string }>(raw);
    const letter = normalizeLetter(parsed?.letter ?? '');
    if (!letter) throw new Error('AI trả về thư rỗng. Vui lòng thử lại.');
    return letter;
}
