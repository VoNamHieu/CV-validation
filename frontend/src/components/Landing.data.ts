import {
    FileText, Brain, Target, MagicWand,
    FilePdf, GlobeHemisphereWest,
} from '@phosphor-icons/react';

export const STEPS = [
    { icon: FileText, title: 'Tải CV của bạn', desc: 'Kéo thả file PDF. AI đọc kỹ năng, kinh nghiệm, học vấn và suy ra vai trò mục tiêu.' },
    { icon: Brain, title: 'AI tìm công ty đang tuyển', desc: 'Quét các công ty trong mạng lưới và trang tuyển dụng chính thức của họ để tìm vị trí khớp.' },
    { icon: Target, title: 'Chấm điểm độ khớp', desc: 'Mỗi tin được xếp hạng theo CV, biết ngay mình hợp bao nhiêu phần trăm và còn thiếu gì.' },
    { icon: MagicWand, title: 'Tối ưu CV & ứng tuyển', desc: 'AI viết lại CV phù hợp từng vị trí (không bịa nội dung), xuất PDF, sẵn sàng nộp.' },
];

// Curated brand logos for the "opportunities from top companies" strip — real
// artwork under public/logos (transparent, professional), shown grayscale.
export const FEATURED_LOGOS: { name: string; src: string; h: number }[] = [
    { name: 'Bosch', src: '/logos/bosch.webp', h: 24 },
    { name: 'Unilever', src: '/logos/unilever.png', h: 34 },
    { name: 'Visa', src: '/logos/visa.png', h: 26 },
    { name: 'NVIDIA', src: '/logos/nvidia.png', h: 35 },
    { name: 'Grab', src: '/logos/grab.png', h: 27 },
    { name: 'TikTok', src: '/logos/tiktok.png', h: 32 },
    { name: 'Vinamilk', src: '/logos/vinamilk.png', h: 30 },
    { name: 'VNG', src: '/logos/vng.webp', h: 22 },
    { name: 'Vingroup', src: '/logos/vingroup.webp', h: 34 },
    { name: 'Vietcombank', src: '/logos/vietcombank.webp', h: 27 },
];

export const JOB_BANNERS = [
    'linear-gradient(135deg, #fbe9e4, #f2ccc1)',
    'linear-gradient(135deg, #e8eef6, #d0dae9)',
    'linear-gradient(135deg, #ece7f4, #d6cbe9)',
    'linear-gradient(135deg, #e6f0ea, #cfe3d7)',
];
export type JobCard = { title: string; co: string; loc: string; badge: string; tags: string[]; note: string; logo: string; slug?: string };
export type PromotedCard = { slug: string; title?: string; company_name?: string; location?: string; role_family?: string; seniority?: string; has_logo?: boolean };
export function seniorityBadge(sen?: string): string {
    const v = (sen || '').toLowerCase();
    if (v.includes('intern') || v.includes('thực tập')) return 'Thực tập';
    if (v.includes('fresh') || v.includes('junior') || v.includes('entry') || v.includes('graduate')) return 'Fresher';
    if (v.includes('senior') || v.includes('lead') || v.includes('manager') || v.includes('cao')) return 'Cấp cao';
    return 'Toàn thời gian';
}
export const JOBS: JobCard[] = [
    { title: 'Product Intern (Supply Chain)', co: 'Bosch', loc: 'Hà Nội', badge: 'Thực tập', tags: ['Supply Chain', 'Excel', 'SAP'], note: 'Phù hợp cao với hồ sơ', logo: '/logos/bosch.webp' },
    { title: 'Brand Management Intern', co: 'Unilever', loc: 'TP. HCM', badge: 'Fresher', tags: ['Marketing', 'Analytics', 'FMCG'], note: '92 người xem hôm nay', logo: '/logos/unilever.png' },
    { title: 'Software Engineer (New Grad)', co: 'NVIDIA', loc: 'Remote', badge: 'Toàn thời gian', tags: ['Python', 'System Design', 'AI'], note: 'Đang tuyển gấp', logo: '/logos/nvidia.png' },
    { title: 'Data Analyst Intern', co: 'Grab', loc: 'Singapore', badge: 'Thực tập', tags: ['SQL', 'Dashboard', 'A/B'], note: 'Hạn nộp 20/07', logo: '/logos/grab.png' },
    { title: 'Chuyên viên Sản phẩm', co: 'VNG', loc: 'TP. HCM', badge: 'Toàn thời gian', tags: ['Product', 'SQL', 'Figma'], note: 'Phù hợp 88% hồ sơ', logo: '/logos/vng.webp' },
    { title: 'Financial Analyst', co: 'Vietcombank', loc: 'Hà Nội', badge: 'Fresher', tags: ['Finance', 'Excel', 'Modeling'], note: 'Đang tuyển gấp', logo: '/logos/vietcombank.webp' },
];
export const DEMO_SCENES = [
    { label: 'Tải CV', icon: FilePdf, ms: 3400 },
    { label: 'Tìm việc khắp nơi', icon: GlobeHemisphereWest, ms: 4200 },
    { label: 'Chấm điểm độ khớp', icon: Target, ms: 4000 },
    { label: 'Tối ưu CV', icon: MagicWand, ms: 3800 },
];

export const DEMO_JOBS = [
    { t: 'Senior Frontend Engineer', co: 'One Mount', s: 92, c: '#c43b2e' },
    { t: 'Product Designer (UI/UX)', co: 'MoMo', s: 88, c: 'var(--accent-blue)' },
    { t: 'Solution Architect', co: 'FPT Software', s: 81, c: '#c43b2e' },
    { t: 'QC Engineer (Fresher)', co: 'Tiki', s: 67, c: 'var(--accent-amber)' },
];

export const DEMO_SOURCES = [
    'Trang tuyển dụng chính thức của công ty',
    'Cổng nghề nghiệp doanh nghiệp',
    'Mạng lưới công ty đang tuyển',
    'Trang career của tập đoàn',
];
