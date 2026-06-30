// Deep gap analysis between a job (JD) and how the candidate's CURRENT CV
// demonstrates their ability. Distinguishes two kinds of gap:
//   - 'presentation': the candidate likely HAS it but the CV doesn't surface it
//                     → fix by rewording/adding real evidence (no fabrication).
//   - 'capability':   a genuine gap (skill/experience not present) → close it by
//                     learning / building, with concrete next steps.
// Output is Vietnamese (UI language). Reasoning task → Pro tier via callAI.
import { callAI } from '@/lib/gemini';
import { safeJsonParse } from '@/lib/safe-json';

export type GapType = 'presentation' | 'capability';
export type GapSeverity = 'critical' | 'moderate' | 'minor';

export interface GapItem {
    area: string;                 // "Kubernetes", "Dẫn dắt nhóm", "Định lượng kết quả"…
    type: GapType;
    severity: GapSeverity;
    detail: string;               // gap là gì + CV hiện đang thể hiện ra sao
    recommendation: string;       // nên làm gì cụ thể
}

export interface GapReport {
    summary: string;              // tổng quan ngắn
    readiness: number;            // 0-100: mức sẵn sàng ứng tuyển vị trí này
    strengths: string[];          // điểm đã khớp tốt (để cân bằng)
    gaps: GapItem[];
}

const SYSTEM_PROMPT = `Bạn là chuyên gia tuyển dụng & cố vấn nghề nghiệp. Phân tích khoảng cách (gap) giữa một Job Description và CV HIỆN TẠI của ứng viên — tập trung vào việc CV ĐANG THỂ HIỆN năng lực tốt tới đâu so với yêu cầu công việc.

Phân loại mỗi gap thành đúng một trong hai:
- "presentation": ứng viên CÓ THỂ đã có năng lực/kinh nghiệm này nhưng CV chưa nêu bật rõ (thiếu từ khoá, thiếu số liệu, mô tả mờ). Cách khắc phục: bổ sung/diễn đạt lại DỰA TRÊN kinh nghiệm thật — TUYỆT ĐỐI KHÔNG bịa.
- "capability": ứng viên thực sự còn thiếu (không có dấu hiệu trong CV). Cách khắc phục: học/làm dự án để bù đắp, với bước đi cụ thể.

Quy tắc:
- Viết tiếng Việt, ngắn gọn, hành động được.
- Không bịa thông tin không có trong CV. Nếu không chắc ứng viên có hay không, ưu tiên gắn nhãn "presentation" và khuyên cách kiểm chứng/nêu bật.
- severity: "critical" (must-have còn thiếu/yếu), "moderate", "minor".
- recommendation phải cụ thể (nêu chính xác nên thêm gì vào CV, hoặc học/làm gì), không chung chung.

Chỉ trả về JSON đúng schema.`;

const GAP_SCHEMA = {
    type: 'OBJECT',
    properties: {
        summary: { type: 'STRING' },
        readiness: { type: 'NUMBER' },
        strengths: { type: 'ARRAY', items: { type: 'STRING' } },
        gaps: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    area: { type: 'STRING' },
                    type: { type: 'STRING', enum: ['presentation', 'capability'] },
                    severity: { type: 'STRING', enum: ['critical', 'moderate', 'minor'] },
                    detail: { type: 'STRING' },
                    recommendation: { type: 'STRING' },
                },
                required: ['area', 'type', 'severity', 'detail', 'recommendation'],
            },
        },
    },
    required: ['summary', 'readiness', 'strengths', 'gaps'],
};

const SEV_ORDER: Record<GapSeverity, number> = { critical: 0, moderate: 1, minor: 2 };

export async function generateGapReport(
    cv: unknown, jd: unknown, match?: unknown,
): Promise<GapReport> {
    if (!cv || !jd) throw new Error('cv and jd are required');
    const userPrompt = `Phân tích gap giữa CV hiện tại và Job Description dưới đây.

CV (JSON):
${JSON.stringify(cv, null, 2)}

JOB DESCRIPTION (JSON):
${JSON.stringify(jd, null, 2)}
${match ? `\nKẾT QUẢ CHẤM ĐIỂM ĐỘ KHỚP (tham khảo, JSON):\n${JSON.stringify(match, null, 2)}` : ''}

Hãy: (1) tóm tắt tổng quan, (2) cho điểm readiness 0-100 (mức sẵn sàng ứng tuyển), (3) liệt kê điểm mạnh đã khớp, (4) liệt kê các gap — mỗi gap phân loại presentation/capability, mức độ, mô tả gap + CV đang thể hiện ra sao, và khuyến nghị cụ thể nên làm gì.`;

    const raw = await callAI(SYSTEM_PROMPT, userPrompt, GAP_SCHEMA);
    const parsed = safeJsonParse(raw) as GapReport | null;
    if (!parsed) throw new Error('AI trả về JSON không hợp lệ. Vui lòng thử lại.');

    // Normalise + sort gaps by severity so the UI shows the worst first.
    const gaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
    gaps.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
    return {
        summary: parsed.summary || '',
        readiness: Math.max(0, Math.min(100, Math.round(parsed.readiness || 0))),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        gaps,
    };
}
