// Measure REAL Gemini token usage per paid action with a realistic CV + JD.
// Run:  cd frontend && npx tsx scripts/measure-tokens.mts
// Loads GEMINI_API_KEY from .env.local. Each call prints "[tag] tokens=…" from
// gemini.ts. Costs a few real Gemini calls.
import { readFileSync } from 'node:fs';

// Load env (GEMINI_API_KEY) before any lazy getClient() call.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
}

const { extractJd, scoreFit, optimizeForJd } = await import('@/lib/tailor');
const { generateGapReport } = await import('@/lib/gap-report');

const CV = {
    name: 'Nguyen Van A',
    title: 'Frontend Engineer',
    summary: 'Frontend engineer with 4 years building React/TypeScript web apps; led a 3-person team, shipped a design system, cut page load 40%.',
    skills: ['React', 'TypeScript', 'Next.js', 'Redux', 'Tailwind', 'Jest', 'Node.js', 'GraphQL', 'CI/CD', 'Figma'],
    experience: [
        { company: 'Tiki', title: 'Frontend Engineer', period: '2022–nay', bullets: [
            'Dẫn dắt nhóm 3 người xây design system dùng chung cho 5 sản phẩm.',
            'Tối ưu hiệu năng, giảm 40% thời gian tải trang chủ.',
            'Tích hợp GraphQL, giảm 30% số request API.' ] },
        { company: 'FPT Software', title: 'Web Developer', period: '2020–2022', bullets: [
            'Xây dựng giao diện cho 2 dự án ngân hàng bằng React + Redux.',
            'Viết unit test (Jest) đạt 80% coverage.' ] },
    ],
    education: [{ school: 'Đại học Bách Khoa', degree: 'Kỹ sư CNTT', period: '2016–2020' }],
};

const JD_TEXT = `Senior Frontend Engineer — One Mount (Hà Nội)
Chúng tôi tìm Senior Frontend Engineer xây dựng nền tảng fintech quy mô lớn.
Yêu cầu: 5+ năm React/TypeScript; thành thạo Next.js, state management; kinh nghiệm
micro-frontend; tối ưu hiệu năng web; mentor junior; làm việc với hệ thống thanh toán.
Ưu tiên: kinh nghiệm fintech/ngân hàng, kiến thức bảo mật web, CI/CD, testing.
Trách nhiệm: dẫn dắt mảng frontend, review code, thiết kế kiến trúc UI, phối hợp BE/Product.`;

function hr(t: string) { console.log(`\n===== ${t} =====`); }

hr('extract_jd (Flash)');
const jd = await extractJd(JD_TEXT);

hr('score (Pro)');
const match = await scoreFit(CV, jd);

hr('optimize ×1 variant (Pro)');
await optimizeForJd(CV, jd, match, { variants: 1 });

hr('gap_report (Pro)');
await generateGapReport(CV, jd, match);

console.log('\nDone — đọc các dòng "tokens=" phía trên.');
