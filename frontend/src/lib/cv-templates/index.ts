import type { CVData } from '@/lib/types';
import type { CvTemplate, CvTemplateId, RenderOptions } from './types';
import { classicTemplate } from './classic';
import { greenHeaderTemplate } from './green-header';
import { greenSidebarTemplate } from './green-sidebar';
import { blueSidebarTemplate } from './blue-sidebar';
import { lightSidebarTemplate } from './light-sidebar';

export const CV_TEMPLATES: CvTemplate[] = [
    {
        id: 'classic',
        name: 'Cổ điển',
        description: 'Một cột tối giản, an toàn cho mọi ngành nghề.',
        accentColor: '#2a2a2a',
        layout: 'single-col',
        render: classicTemplate,
    },
    {
        id: 'green-header',
        name: 'Tiêu đề xanh',
        description: 'Một cột với thanh tiêu đề màu xanh, rõ ràng dễ đọc.',
        accentColor: '#2e7d32',
        layout: 'single-col',
        render: greenHeaderTemplate,
    },
    {
        id: 'green-sidebar',
        name: 'Sidebar xanh đậm',
        description: 'Hai cột với sidebar tối, gọn nhiều thông tin một trang.',
        accentColor: '#2b4a3e',
        layout: 'sidebar-left',
        render: greenSidebarTemplate,
    },
    {
        id: 'blue-sidebar',
        name: 'Sidebar xanh dương',
        description: 'Hai cột phong cách công nghệ, sidebar xanh đậm.',
        accentColor: '#1e3a5f',
        layout: 'sidebar-left',
        render: blueSidebarTemplate,
    },
    {
        id: 'light-sidebar',
        name: 'Sidebar nhạt',
        description: 'Hai cột nền nhạt, hiện đại và thoáng.',
        accentColor: '#5a8a9a',
        layout: 'sidebar-left',
        render: lightSidebarTemplate,
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
