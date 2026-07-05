'use client';

// Dependency-free chart primitives for the admin analytics dashboard — plain
// SVG + CSS on the app's design tokens (tracks light/dark). Deliberately small:
// an area/line trend and a horizontal bar list cover everything the dashboard
// needs without pulling in a charting lib.
import { useId } from 'react';

// ── Area + line trend ────────────────────────────────────────────────────────
// Responsive via a fixed viewBox stretched to 100% width. Zero/flat data draws
// a baseline instead of collapsing.
export function AreaChart({
    data, dates, color = 'var(--accent-purple)', height = 56,
}: {
    data: number[];
    dates?: string[];
    color?: string;
    height?: number;
}) {
    const gid = useId().replace(/:/g, '');
    const W = 300;
    const H = height;
    const pad = 3;
    const n = data.length;
    const max = Math.max(1, ...data);
    const dx = n > 1 ? (W - pad * 2) / (n - 1) : 0;
    const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
    const x = (i: number) => pad + i * dx;

    const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = n === 1 ? `M0,${y(data[0])} L${W},${y(data[0])}` : `M${pts.join(' L')}`;
    const area = n > 1
        ? `M${x(0)},${H - pad} L${pts.join(' L')} L${x(n - 1)},${H - pad} Z`
        : '';
    const last = data[n - 1] ?? 0;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            style={{ width: '100%', height, display: 'block' }} role="img"
            aria-label={dates ? `${dates[0]} → ${dates[dates.length - 1]}` : undefined}>
            <defs>
                <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            {area && <path d={area} fill={`url(#g-${gid})`} />}
            <path d={line} fill="none" stroke={color} strokeWidth={1.75}
                strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
            {n > 1 && (
                <circle cx={x(n - 1)} cy={y(last)} r={2.4} fill={color}
                    vectorEffect="non-scaling-stroke" />
            )}
        </svg>
    );
}

// ── Horizontal bar list ──────────────────────────────────────────────────────
export function BarList({
    items, color = 'var(--accent-blue)', emptyLabel = 'Chưa có dữ liệu', valueFmt,
}: {
    items: { label: string; value: number; hint?: string }[];
    color?: string;
    emptyLabel?: string;
    valueFmt?: (v: number) => string;
}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const fmt = valueFmt ?? ((v: number) => v.toLocaleString('vi-VN'));
    if (items.length === 0) {
        return <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '8px 0' }}>{emptyLabel}</div>;
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {items.map((it, i) => (
                <div key={`${it.label}-${i}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                        <span style={{
                            fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={it.label}>{it.label}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                            {fmt(it.value)}{it.hint && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{it.hint}</span>}
                        </span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', width: `${(it.value / max) * 100}%`, minWidth: it.value > 0 ? 3 : 0,
                            borderRadius: 999, background: color, transition: 'width 0.35s ease',
                        }} />
                    </div>
                </div>
            ))}
        </div>
    );
}
