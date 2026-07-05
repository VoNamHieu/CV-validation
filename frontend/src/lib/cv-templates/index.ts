import type { CVData } from '@/lib/types';
import type { CvTemplate, CvTemplateId, RenderOptions } from './types';
import { classicTemplate } from './classic';
import { greenHeaderTemplate } from './green-header';
import { greenSidebarTemplate } from './green-sidebar';
import { blueSidebarTemplate } from './blue-sidebar';
import { lightSidebarTemplate } from './light-sidebar';
import { navyHeaderTemplate } from './navy-header';
import { slateRightTemplate } from './slate-right';
import { elegantSerifTemplate } from './elegant-serif';
import { minimalMonoTemplate } from './minimal-mono';

export const CV_TEMPLATES: CvTemplate[] = [
    {
        id: 'classic',
        name: 'Cổ điển',
        description: 'Một cột tối giản, an toàn cho mọi ngành nghề.',
        accentColor: '#2a2a2a',
        layout: 'single-col',
        hasPhoto: true,
        render: classicTemplate,
    },
    {
        id: 'green-header',
        name: 'Tiêu đề xanh',
        description: 'Một cột với thanh tiêu đề màu xanh, rõ ràng dễ đọc.',
        accentColor: '#2e7d32',
        layout: 'single-col',
        hasPhoto: true,
        render: greenHeaderTemplate,
    },
    {
        id: 'navy-header',
        name: 'Băng rôn navy',
        description: 'Một cột với dải header xanh navy đậm, chuyên nghiệp.',
        accentColor: '#1f2a44',
        layout: 'single-col',
        hasPhoto: true,
        render: navyHeaderTemplate,
    },
    {
        id: 'elegant-serif',
        name: 'Thanh lịch serif',
        description: 'Một cột căn giữa với font serif, hợp ngành sáng tạo / quản lý.',
        accentColor: '#b08d4f',
        layout: 'single-col',
        hasPhoto: true,
        render: elegantSerifTemplate,
    },
    {
        id: 'minimal-mono',
        name: 'Tối giản (không ảnh)',
        description: 'Chỉ chữ, không ảnh đại diện, tối ưu cho hệ thống ATS.',
        accentColor: '#111111',
        layout: 'single-col',
        hasPhoto: false,
        render: minimalMonoTemplate,
    },
    {
        id: 'green-sidebar',
        name: 'Sidebar xanh đậm',
        description: 'Hai cột với sidebar tối, gọn nhiều thông tin một trang.',
        accentColor: '#2b4a3e',
        layout: 'sidebar-left',
        hasPhoto: true,
        render: greenSidebarTemplate,
    },
    {
        id: 'blue-sidebar',
        name: 'Sidebar xanh dương',
        description: 'Hai cột phong cách công nghệ, sidebar xanh đậm.',
        accentColor: '#1e3a5f',
        layout: 'sidebar-left',
        hasPhoto: true,
        render: blueSidebarTemplate,
    },
    {
        id: 'light-sidebar',
        name: 'Sidebar nhạt',
        description: 'Hai cột nền nhạt, hiện đại và thoáng.',
        accentColor: '#5a8a9a',
        layout: 'sidebar-left',
        hasPhoto: true,
        render: lightSidebarTemplate,
    },
    {
        id: 'slate-right',
        name: 'Sidebar phải',
        description: 'Hai cột với sidebar bên phải màu xám xanh, khác biệt.',
        accentColor: '#3b4859',
        layout: 'sidebar-right',
        hasPhoto: true,
        render: slateRightTemplate,
    },
];

export const DEFAULT_TEMPLATE_ID: CvTemplateId = 'classic';

export function getTemplate(id?: string | null): CvTemplate {
    return CV_TEMPLATES.find(t => t.id === id) ?? CV_TEMPLATES[0];
}

export function renderCvHtml(
    cv: CVData,
    templateId?: string | null,
    opts?: RenderOptions,
): string {
    return getTemplate(templateId).render(cv, opts);
}

export type { CvTemplate, CvTemplateId, CvTemplateLayout, RenderOptions } from './types';
