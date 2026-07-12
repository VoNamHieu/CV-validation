'use client';

// Resumes the "optimize CV for this job" flow that starts on a public landing
// page (/j/<slug> → /?promoted=<slug>). Mounted inside the authed app shell.
//
//   1. Capture the ?promoted=<slug> param → pendingPromotedSlug, clean the URL.
//   2. Need the user's CV first — if none, drop them on step 1 (upload); the
//      pending slug survives so we resume the moment a CV exists.
//   3. With a CV: fetch the job snapshot, extract + score its JD, seed a single
//      editor entry, and jump to step 3. No crawl — the JD is in the snapshot.
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SpinnerGap, CheckCircle, Circle, Target, Buildings } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import { extractJdStructured, scoreFit } from '@/lib/api';
import type { JDData, MatchResult } from '@/lib/types';

type Snapshot = {
    job: { title: string; company_name: string; description: string };
};

// Each step is bound to a real awaited operation in the resume flow, so the
// stepper shows true progress. `id` matches the `phase` value set right before
// that await starts.
const STEPS = [
    { id: 1, label: 'Tải tin tuyển dụng' },
    { id: 2, label: 'Phân tích mô tả công việc' },
    { id: 3, label: 'Chấm độ phù hợp với CV' },
];

export default function PromotedResume() {
    const router = useRouter();
    const params = useSearchParams();
    const { user, loading: authLoading } = useAuth();

    const pendingSlug = useAppStore((s) => s.pendingPromotedSlug);
    const cvData = useAppStore((s) => s.cvData);
    const setPendingPromotedSlug = useAppStore((s) => s.setPendingPromotedSlug);
    const seedPromotedEntry = useAppStore((s) => s.seedPromotedEntry);
    const setStep = useAppStore((s) => s.setStep);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // Real progress: each phase maps to an actual awaited step below, so the
    // stepper reflects true state (not a fake timer). 1=fetch, 2=extract JD,
    // 3=score fit. `jobLabel` fills in once the snapshot lands, so the card
    // stops being anonymous mid-wait.
    const [phase, setPhase] = useState(0);
    const [jobLabel, setJobLabel] = useState<{ title: string; company: string } | null>(null);
    const processingRef = useRef(false);

    // Step 1: adopt the URL param, then strip it so a refresh doesn't re-fire.
    useEffect(() => {
        const slug = params.get('promoted');
        if (slug) {
            setPendingPromotedSlug(slug);
            router.replace('/');
        }
    }, [params, router, setPendingPromotedSlug]);

    // Step 2/3: resume once we have an authed user (+ CV).
    useEffect(() => {
        if (!pendingSlug || !user || authLoading || processingRef.current) return;

        // No CV yet → send to upload; keep the slug and resume when cvData lands.
        if (!cvData) {
            setStep(1);
            return;
        }

        processingRef.current = true;
        setBusy(true);
        setError('');
        setPhase(1);
        setJobLabel(null);
        (async () => {
            try {
                const res = await fetch(
                    `/api/store/promoted/by-slug/${encodeURIComponent(pendingSlug)}`,
                    { cache: 'no-store' },
                );
                if (!res.ok) throw new Error('Không tải được tin tuyển dụng.');
                const data = (await res.json()) as Snapshot;
                const { title, company_name, description } = data.job;
                setJobLabel({ title, company: company_name });
                if (!description || description.length < 40) {
                    throw new Error('Tin tuyển dụng thiếu mô tả để tối ưu.');
                }

                setPhase(2);
                let jd = await extractJdStructured(description);
                if (Array.isArray(jd)) jd = jd[0];
                if (!jd) throw new Error('Không trích xuất được yêu cầu công việc.');

                setPhase(3);
                let match = await scoreFit(cvData, jd);
                if (Array.isArray(match)) match = match[0];

                setPhase(4);
                seedPromotedEntry({
                    slug: pendingSlug,
                    title,
                    company: company_name,
                    jdData: jd as JDData,
                    matchResult: match as MatchResult,
                });
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Có lỗi khi chuẩn bị CV.');
                setPendingPromotedSlug(null);
                setPhase(0);
            } finally {
                processingRef.current = false;
                setBusy(false);
            }
        })();
    }, [pendingSlug, user, authLoading, cvData, setStep, seedPromotedEntry, setPendingPromotedSlug]);

    if (!busy && !error) return null;

    const pct = Math.round((Math.min(phase, STEPS.length) / STEPS.length) * 100);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
            display: 'grid', placeItems: 'center', padding: 24,
        }}>
            <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xl)', padding: '26px 26px 24px', width: '100%', maxWidth: 400,
                boxShadow: 'var(--shadow-card-hover)',
            }}>
                {error ? (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--accent-red)' }}>
                            Không thể tối ưu
                        </div>
                        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>{error}</p>
                        <button className="btn-secondary" onClick={() => setError('')}>Đóng</button>
                    </div>
                ) : (
                    <>
                        {/* Header: brand badge + what's happening + which job */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                            <span style={{
                                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                                background: 'var(--gradient-hero)', display: 'grid', placeItems: 'center',
                                boxShadow: '0 4px 14px rgba(196, 59, 46,0.35)',
                            }}>
                                <Target size={21} weight="fill" color="#fff" />
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                                    Đang chấm độ phù hợp
                                </div>
                                <div style={{
                                    fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2,
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {jobLabel ? (
                                        <>
                                            <Buildings size={13} weight="duotone" style={{ flexShrink: 0 }} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {jobLabel.title}{jobLabel.company ? ` · ${jobLabel.company}` : ''}
                                            </span>
                                        </>
                                    ) : 'Chuẩn bị dữ liệu công việc…'}
                                </div>
                            </div>
                        </div>

                        {/* Thin honest progress bar (fills per completed phase) */}
                        <div style={{
                            height: 5, borderRadius: 99, background: 'var(--bg-secondary)',
                            overflow: 'hidden', marginBottom: 18,
                        }}>
                            <div style={{
                                height: '100%', width: `${pct}%`, borderRadius: 99,
                                background: 'var(--gradient-hero)', transition: 'width 0.5s cubic-bezier(.4,0,.2,1)',
                            }} />
                        </div>

                        {/* Stepper — each row bound to a real awaited step */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                            {STEPS.map((s) => {
                                const state = phase > s.id ? 'done' : phase === s.id ? 'active' : 'pending';
                                return (
                                    <div key={s.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 11,
                                        opacity: state === 'pending' ? 0.5 : 1,
                                        transition: 'opacity 0.3s ease',
                                    }}>
                                        <span style={{ width: 20, height: 20, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                                            {state === 'done' && (
                                                <CheckCircle size={20} weight="fill" style={{ color: 'var(--accent-green, #22c55e)' }} />
                                            )}
                                            {state === 'active' && (
                                                <SpinnerGap size={19} weight="bold" style={{ color: 'var(--accent-blue)', animation: 'spin 0.9s linear infinite' }} />
                                            )}
                                            {state === 'pending' && (
                                                <Circle size={17} weight="bold" style={{ color: 'var(--text-muted)' }} />
                                            )}
                                        </span>
                                        <span style={{
                                            fontSize: 13.5,
                                            fontWeight: state === 'active' ? 700 : 500,
                                            color: state === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                                        }}>
                                            {s.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
