import type { CVData } from '@/lib/types';
import type { CvLabels } from './labels';

export type { CvLabels };

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
    // Section + contact labels in the CV's content language. Injected by
    // renderCvHtml (auto-detected from content, or forced via `lang`). Templates
    // fall back to Vietnamese labels when omitted.
    labels?: CvLabels;
    lang?: 'en' | 'vi';
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

// `path` marks the element as inline-editable in the live preview (data-f is
// the CVData field path the edited text is written back to). It is inert in
// the exported PDF.
export function descToBullets(desc: string | undefined | null, path?: string): string {
    const attr = path ? ` data-f="${esc(path)}"` : '';
    const lines = (desc ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    if (lines.length === 1) return `<p${attr}>${esc(lines[0])}</p>`;
    return `<ul${attr}>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

export function durationLabel(months: number | undefined | null, L?: CvLabels): string {
    const m = Number(months) || 0;
    if (!m) return '';
    const y = Math.floor(m / 12);
    const rem = m % 12;
    const yr = L?.year ?? 'năm';
    const mo = L?.month ?? 'tháng';
    if (y === 0) return `${rem} ${mo}`;
    if (rem === 0) return `${y} ${yr}`;
    return `${y} ${yr} ${rem} ${mo}`;
}

/**
 * Date label for an experience entry: prefers the verbatim dates from the CV
 * ("03/2021 – Hiện tại"), falls back to the computed duration ("2 năm 3 tháng")
 * for data extracted before start/end dates existed.
 */
export function dateRangeLabel(e: {
    start_date?: string;
    end_date?: string;
    duration_months?: number | null;
}, L?: CvLabels): string {
    const present = L?.present ?? 'Hiện tại';
    const norm = (s: string | undefined) => {
        const t = (s ?? '').trim();
        return /^(present|current|now|nay|hiện tại)$/i.test(t) ? present : t;
    };
    const start = norm(e.start_date);
    const end = norm(e.end_date);
    if (start && end) return `${start} – ${end}`;
    if (start || end) return start || end;
    return durationLabel(e.duration_months, L);
}

// ATS-safe entry header. Renders TITLE · SUBTITLE on one text line with the DATE
// after it, in DOM order title → subtitle → date, so a PDF text extractor keeps
// them on/near one line and associated (a 2-column "date on the left, content on
// the right" grid makes the extractor emit the date FIRST, in its own block, and
// wrap long date ranges across lines — which is exactly what dropped "Customer
// Success" and the university on Chromium-printed, untagged CVs). The date is
// right-aligned visually via flex but stays LAST in the DOM.
export function entryHead(o: {
    title?: string; titlePath?: string;
    subtitle?: string; subPath?: string;
    date?: string; datePath?: string;
}): string {
    const a = (p?: string) => (p ? ` data-f="${esc(p)}"` : '');
    const sub = o.subtitle
        ? ` <span class="entry-sep">·</span> <span class="item-meta"${a(o.subPath)}>${esc(o.subtitle)}</span>`
        : '';
    const date = o.date ? `<span class="item-date"${a(o.datePath)}>${esc(o.date)}</span>` : '';
    return `<div class="entry-head"><div class="entry-titleco"><span class="item-title"${a(o.titlePath)}>${esc(o.title)}</span>${sub}</div>${date}</div>`;
}

// Shared CSS for the ATS-safe entry header — each template injects ${ENTRY_CSS}
// into its <style> and inherits its own .item-title / .item-meta / .item-date
// colors (only layout is defined here).
export const ENTRY_CSS = `
  .entry { margin-bottom: 13px; page-break-inside: avoid; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; margin-bottom: 3px; }
  .entry-titleco { flex: 1 1 auto; }
  .entry-sep { opacity: .45; margin: 0 2px; }
  .entry-head .item-title { display: inline; }
  .entry-head .item-meta { display: inline; }
  .item-date { flex: 0 0 auto; white-space: nowrap; }
`;

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
