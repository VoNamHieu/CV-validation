'use client';

import { CV_TEMPLATES } from '@/lib/cv-templates';
import type { CvTemplate, CvTemplateId } from '@/lib/cv-templates';

interface Props {
    selected: CvTemplateId;
    onSelect: (id: CvTemplateId) => void;
    compact?: boolean;
}

export default function CvTemplatePicker({ selected, onSelect, compact }: Props) {
    const thumbW = compact ? 72 : 92;
    return (
        <div style={{
            display: 'flex', gap: 10, overflowX: 'auto',
            padding: '4px 2px 8px', marginBottom: 12,
            scrollbarWidth: 'thin',
        }}>
            {CV_TEMPLATES.map(t => {
                const isActive = t.id === selected;
                return (
                    <button
                        key={t.id}
                        onClick={() => onSelect(t.id)}
                        type="button"
                        title={t.description}
                        style={{
                            flex: '0 0 auto',
                            width: thumbW,
                            padding: 5,
                            border: isActive
                                ? `2px solid ${t.accentColor}`
                                : '1.5px solid var(--border-subtle)',
                            borderRadius: 8,
                            background: isActive ? 'rgba(99,102,241,0.05)' : 'var(--bg-card)',
                            cursor: 'pointer',
                            textAlign: 'center',
                            fontFamily: 'inherit',
                            transition: 'border-color 0.15s ease',
                        }}
                    >
                        <div style={{
                            width: '100%',
                            aspectRatio: '210/297',
                            marginBottom: 5,
                            overflow: 'hidden',
                            borderRadius: 3,
                        }}>
                            <TemplateMiniature template={t} />
                        </div>
                        <div style={{
                            fontSize: '0.7rem',
                            fontWeight: isActive ? 700 : 500,
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}>
                            {t.name}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

/** Inline SVG mini-preview that hints at each template's layout. */
function TemplateMiniature({ template }: { template: CvTemplate }) {
    const c = template.accentColor;

    if (template.layout === 'single-col') {
        const isBarStyle = template.id === 'green-header' || template.id === 'navy-header';
        const sectionBg = isBarStyle ? c : '#bbb';
        const sectionFg = isBarStyle ? '#fff' : '#1a1a1a';
        const avatarBg = isBarStyle ? `${c}33` : '#e8e8e8';
        return (
            <svg viewBox="0 0 80 113" style={{ width: '100%', height: '100%', display: 'block', background: '#fff', border: '1px solid #eee' }}>
                {template.hasPhoto && <circle cx="14" cy="18" r="8" fill={avatarBg} />}
                <rect x={template.hasPhoto ? 26 : 8} y="13" width="40" height="3.5" fill="#333" />
                <rect x={template.hasPhoto ? 26 : 8} y="19" width="30" height="1.8" fill="#888" />
                <rect x={template.hasPhoto ? 26 : 8} y="22.5" width="34" height="1.8" fill="#888" />
                <rect x={template.hasPhoto ? 26 : 8} y="26" width="28" height="1.8" fill="#888" />
                <rect x="8" y="36" width="64" height="4.5" fill={sectionBg} />
                <rect x="10" y="37.5" width="20" height="1.6" fill={sectionFg} opacity={isBarStyle ? 1 : 0} />
                <rect x="8" y="44" width="62" height="1.6" fill="#ccc" />
                <rect x="8" y="47" width="56" height="1.6" fill="#ccc" />
                <rect x="8" y="50" width="60" height="1.6" fill="#ccc" />
                <rect x="8" y="60" width="64" height="4.5" fill={sectionBg} />
                <rect x="10" y="61.5" width="20" height="1.6" fill={sectionFg} opacity={isBarStyle ? 1 : 0} />
                <rect x="8" y="68" width="50" height="1.6" fill="#ccc" />
                <rect x="8" y="71" width="62" height="1.6" fill="#ccc" />
                <rect x="8" y="74" width="56" height="1.6" fill="#ccc" />
                <rect x="8" y="77" width="60" height="1.6" fill="#ccc" />
                <rect x="8" y="87" width="64" height="4.5" fill={sectionBg} />
                <rect x="10" y="88.5" width="20" height="1.6" fill={sectionFg} opacity={isBarStyle ? 1 : 0} />
                <rect x="8" y="95" width="56" height="1.6" fill="#ccc" />
                <rect x="8" y="98" width="62" height="1.6" fill="#ccc" />
            </svg>
        );
    }

    // sidebar layout — mirrored horizontally when the sidebar sits on the right
    const isLight = template.id === 'light-sidebar';
    const isRight = template.layout === 'sidebar-right';
    const sidebarBg = isLight ? '#f1f5f7' : c;
    const sidebarFg = isLight ? c : '#fff';
    const avatarFill = isLight ? c : 'rgba(255,255,255,0.25)';
    return (
        <svg
            viewBox="0 0 80 113"
            style={{
                width: '100%', height: '100%', display: 'block',
                background: '#fff', border: '1px solid #eee',
                transform: isRight ? 'scaleX(-1)' : undefined,
            }}
        >
            <rect x="0" y="0" width="28" height="113" fill={sidebarBg} />
            <circle cx="14" cy="20" r="9" fill={avatarFill} />
            <rect x="4" y="34" width="20" height="2.5" fill={sidebarFg} />
            <rect x="6" y="38" width="16" height="1.6" fill={sidebarFg} opacity="0.7" />
            <rect x="4" y="46" width="20" height="1.6" fill={sidebarFg} opacity="0.6" />
            <rect x="4" y="49" width="18" height="1.6" fill={sidebarFg} opacity="0.6" />
            <rect x="4" y="52" width="20" height="1.6" fill={sidebarFg} opacity="0.6" />
            <rect x="4" y="55" width="16" height="1.6" fill={sidebarFg} opacity="0.6" />
            <rect x="4" y="64" width="14" height="1.8" fill={sidebarFg} opacity="0.9" />
            <rect x="4" y="68" width="20" height="1.5" fill={sidebarFg} opacity="0.5" />
            <rect x="4" y="71" width="18" height="1.5" fill={sidebarFg} opacity="0.5" />
            <rect x="4" y="74" width="20" height="1.5" fill={sidebarFg} opacity="0.5" />
            <rect x="4" y="77" width="16" height="1.5" fill={sidebarFg} opacity="0.5" />
            <rect x="4" y="86" width="14" height="1.8" fill={sidebarFg} opacity="0.9" />
            <rect x="4" y="90" width="20" height="1.5" fill={sidebarFg} opacity="0.5" />
            <rect x="4" y="93" width="18" height="1.5" fill={sidebarFg} opacity="0.5" />

            <rect x="34" y="10" width="40" height="3.5" fill={c} />
            <rect x="34" y="16" width="30" height="2" fill="#888" />
            <rect x="34" y="28" width="42" height="3" fill={c} opacity="0.65" />
            <rect x="34" y="33" width="40" height="1.6" fill="#ccc" />
            <rect x="34" y="36" width="42" height="1.6" fill="#ccc" />
            <rect x="34" y="39" width="38" height="1.6" fill="#ccc" />
            <rect x="34" y="50" width="42" height="3" fill={c} opacity="0.65" />
            <rect x="34" y="55" width="40" height="1.6" fill="#ccc" />
            <rect x="34" y="58" width="42" height="1.6" fill="#ccc" />
            <rect x="34" y="61" width="38" height="1.6" fill="#ccc" />
            <rect x="34" y="64" width="40" height="1.6" fill="#ccc" />
            <rect x="34" y="75" width="42" height="3" fill={c} opacity="0.65" />
            <rect x="34" y="80" width="40" height="1.6" fill="#ccc" />
            <rect x="34" y="83" width="42" height="1.6" fill="#ccc" />
            <rect x="34" y="86" width="38" height="1.6" fill="#ccc" />
        </svg>
    );
}
