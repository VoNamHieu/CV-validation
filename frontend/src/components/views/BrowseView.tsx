'use client';

// Browse mode — DISCOVERY without a CV. Takes role + seniority + location and
// lists facet-ranked openings (direction only). Deliberately does NOT run the
// per-job pipeline (scoreFit / experienceGapExceeds / tailor) — those need a CV.
// No fit/match %: the facet score is role-relevance, not personal fit. The
// CV-dependent value (fit, tailoring, auto-apply) is gated behind upload.

import { useState, type CSSProperties } from 'react';
import { Target, MapPin, Stack, MagnifyingGlass, ArrowSquareOut, CircleNotch } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { searchFeaturedJobsWarm, type FacetSearchJob } from '@/lib/api';
import { CITY_OPTIONS, SENIORITY_OPTIONS, matchesCity, cityLabel } from '@/lib/job-targeting';

export default function BrowseView() {
    // Reuse the wizard's prefs fields so anything set here carries into the
    // full flow after the user uploads a CV.
    const {
        targetJobTitle, setTargetJobTitle,
        targetLevel, setTargetLevel,
        targetLocation, setTargetLocation,
        setView, setStep,
    } = useAppStore();

    const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [jobs, setJobs] = useState<FacetSearchJob[]>([]);

    const browse = async () => {
        const role = targetJobTitle.trim();
        if (!role) { setStatus('error'); setMessage('Enter a role to browse.'); return; }
        setStatus('searching');
        setMessage(targetLevel ? `Finding ${targetLevel} ${role} openings…` : `Finding ${role} openings…`);
        setJobs([]);
        try {
            const res = await searchFeaturedJobsWarm(
                {
                    target_roles: [role],
                    cv_roles: [],            // no CV → fit is neutral; this is discovery, not matching
                    level: targetLevel || '',
                    limit: 100,
                    rerank: true,
                },
                (n) => setMessage(`Preparing openings… (${n})`),
            );
            // Location filtered client-side (same matcher as the wizard), so a
            // chosen city narrows without a hard backend drop.
            const all = res.results || [];
            const filtered = targetLocation ? all.filter((j) => matchesCity(j.location || '', targetLocation)) : all;
            setJobs(filtered);
            setStatus('done');
            setMessage(filtered.length
                ? `${filtered.length} ${role} opening${filtered.length > 1 ? 's' : ''}${targetLocation ? ` in ${cityLabel(targetLocation)}` : ''}`
                : `No ${role} openings${targetLocation ? ` in ${cityLabel(targetLocation)}` : ''} right now — try another role or city.`);
        } catch (e) {
            setStatus('error');
            setMessage(e instanceof Error ? e.message : 'Search failed');
        }
    };

    // CV-dependent actions (fit / tailor / apply) send the user to upload.
    // Prefs carry via the store; the normal flow re-surfaces these roles.
    const goUpload = () => { setView('apply'); setStep(1); };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
            <div style={{ marginBottom: 8 }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <MagnifyingGlass size={22} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    Browse openings
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>
                    Explore roles by title, level and city — no CV needed. Upload your CV to see fit and tailor your application.
                </p>
            </div>

            {/* ── Prefs ── */}
            <div className="glass-card" style={{ padding: '20px 24px', marginTop: 16 }}>
                <label style={labelStyle}>
                    <Target size={14} weight="duotone" style={{ color: 'var(--accent-purple)' }} /> Role
                </label>
                <input
                    className="input-field"
                    type="text"
                    value={targetJobTitle}
                    onChange={(e) => setTargetJobTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') browse(); }}
                    placeholder="e.g. Product Manager"
                    style={{ height: 48, fontSize: '0.92rem', width: '100%', borderRadius: 'var(--radius-lg)', marginBottom: 20 }}
                />

                <label style={labelStyle}>
                    <Stack size={14} weight="duotone" style={{ color: 'var(--accent-purple)' }} /> Seniority <span style={optTag}>· optional</span>
                </label>
                <div style={chipRow}>
                    {SENIORITY_OPTIONS.map((s) => {
                        const active = targetLevel === s.key;
                        return (
                            <button key={s.key} type="button" onClick={() => setTargetLevel(active ? '' : s.key)}
                                style={chip(active, 'var(--accent-purple)', 'rgba(139,92,246,0.12)')}>
                                {s.label}
                            </button>
                        );
                    })}
                </div>

                <label style={{ ...labelStyle, marginTop: 20 }}>
                    <MapPin size={14} weight="duotone" style={{ color: 'var(--accent-blue)' }} /> Location <span style={optTag}>· optional</span>
                </label>
                <div style={chipRow}>
                    {CITY_OPTIONS.map((c) => {
                        const active = targetLocation === c.key;
                        return (
                            <button key={c.key} type="button" onClick={() => setTargetLocation(active ? '' : c.key)}
                                style={chip(active, 'var(--accent-blue)', 'rgba(59,130,246,0.12)')}>
                                {c.label}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={browse}
                    disabled={status === 'searching'}
                    style={{
                        marginTop: 20, width: '100%', padding: '12px 14px', borderRadius: 12, border: 'none',
                        cursor: status === 'searching' ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.95rem',
                        background: 'var(--gradient-hero)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    {status === 'searching'
                        ? <><CircleNotch size={16} className="spin" /> Searching…</>
                        : <><MagnifyingGlass size={16} weight="bold" /> Browse jobs</>}
                </button>
                {message && (
                    <div style={{ marginTop: 10, fontSize: '0.8rem', color: status === 'error' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                        {message}
                    </div>
                )}
            </div>

            {/* ── Listing ── */}
            {jobs.length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {jobs.map((j, i) => (
                        <div key={`${j.url}-${i}`} className="glass-card" style={{ padding: '14px 18px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>{j.title}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                        {j.company && <span>{j.company}</span>}
                                        {j.location && <span style={{ color: 'var(--text-muted)' }}>· {j.location}</span>}
                                        {j._facet?.role_family && (
                                            <span style={{
                                                fontSize: '0.7rem', padding: '1px 8px', borderRadius: 10,
                                                background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                                            }}>{j._facet.role_family}</span>
                                        )}
                                    </div>
                                </div>
                                <a
                                    href={j.apply_url || j.career_url || j.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        flexShrink: 0, fontSize: '0.78rem', color: 'var(--accent-cyan)',
                                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
                                    }}
                                >
                                    View role <ArrowSquareOut size={12} />
                                </a>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <button onClick={goUpload} style={{
                                    fontSize: '0.78rem', fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                                    border: '1px solid rgba(165,180,252,0.45)', background: 'rgba(99,102,241,0.12)',
                                    color: '#e0e7ff', cursor: 'pointer',
                                }}>
                                    📄 Upload CV to see fit & tailor
                                </button>
                            </div>
                        </div>
                    ))}
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                        Showing openings for this role — ranked by relevance, not personalized. Upload your CV for fit & tailoring.
                    </p>
                </div>
            )}
        </div>
    );
}

const labelStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
};
const optTag: CSSProperties = { textTransform: 'none', fontWeight: 400, letterSpacing: 0 };
const chipRow: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const chip = (active: boolean, accent: string, bg: string): CSSProperties => ({
    padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
    fontSize: '0.83rem', fontWeight: active ? 600 : 400,
    border: `1px solid ${active ? accent : 'var(--border-default)'}`,
    background: active ? bg : 'var(--bg-secondary)',
    color: active ? accent : 'var(--text-secondary)',
    transition: 'all 0.18s ease',
});
