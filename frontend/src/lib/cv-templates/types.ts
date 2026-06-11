import type { CVData } from '@/lib/types';

export type CvTemplateId =
    | 'classic'
    | 'green-header'
    | 'green-sidebar'
    | 'blue-sidebar'
    | 'light-sidebar'
    | 'navy-header'
    | 'slate-right'
    | 'elegant-serif'
    | 'minimal-mono';

export type CvTemplateLayout = 'single-col' | 'sidebar-left' | 'sidebar-right';

export interface RenderOptions {
    avatarBase64?: string;
}

export interface CvTemplate {
    id: CvTemplateId;
    name: string;
    description: string;
    accentColor: string;
    layout: CvTemplateLayout;
    // Whether the template has an image holder (avatar slot). The avatar
    // uploader in the UI only shows for templates where this is true.
    hasPhoto: boolean;
    render: (cv: CVData, opts?: RenderOptions) => string;
}

export function esc(str: string | undefined | null): string {
    return (str ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function descToBullets(desc: string | undefined | null): string {
    const lines = (desc ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    if (lines.length === 1) return `<p>${esc(lines[0])}</p>`;
    return `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

export function durationLabel(months: number | undefined | null): string {
    const m = Number(months) || 0;
    if (!m) return '';
    const y = Math.floor(m / 12);
    const rem = m % 12;
    if (y === 0) return `${rem} tháng`;
    if (rem === 0) return `${y} năm`;
    return `${y} năm ${rem} tháng`;
}

export function initials(name: string | undefined | null): string {
    const n = (name ?? '').trim();
    if (!n) return '?';
    const ch = n[0];
    return (ch || '?').toUpperCase();
}

export function joinAddress(contact: CVData['contact'] | undefined): string {
    if (!contact) return '';
    return [contact.address_street, contact.address_district, contact.address_province]
        .filter(Boolean)
        .join(', ');
}

/**
 * Returns either an <img> tag (if avatarBase64 is a valid data URL) or the
 * initial letter as fallback. Each template wraps this in its own .avatar div
 * with template-specific styling (size, border, background).
 *
 * The img tag uses object-fit:cover so non-square photos crop centered.
 */
export function avatarInner(name: string | undefined | null, avatarBase64?: string): string {
    if (avatarBase64 && avatarBase64.startsWith('data:image/')) {
        return `<img src="${esc(avatarBase64)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;" />`;
    }
    return esc(initials(name));
}
