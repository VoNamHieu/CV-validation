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
import { SpinnerGap } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import { extractJdStructured, scoreFit } from '@/lib/api';
import type { JDData, MatchResult } from '@/lib/types';

type Snapshot = {
    job: { title: string; company_name: string; description: string };
};

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
        (async () => {
            try {
                const res = await fetch(
                    `/api/store/promoted/by-slug/${encodeURIComponent(pendingSlug)}`,
                    { cache: 'no-store' },
                );
                if (!res.ok) throw new Error('Không tải được tin tuyển dụng.');
                const data = (await res.json()) as Snapshot;
                const { title, company_name, description } = data.job;
                if (!description || description.length < 40) {
                    throw new Error('Tin tuyển dụng thiếu mô tả để tối ưu.');
                }

                let jd = await extractJdStructured(description);
                if (Array.isArray(jd)) jd = jd[0];
                if (!jd) throw new Error('Không trích xuất được yêu cầu công việc.');

                let match = await scoreFit(cvData, jd);
                if (Array.isArray(match)) match = match[0];

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
            } finally {
                processingRef.current = false;
                setBusy(false);
            }
        })();
    }, [pendingSlug, user, authLoading, cvData, setStep, seedPromotedEntry, setPendingPromotedSlug]);

    if (!busy && !error) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
            display: 'grid', placeItems: 'center', padding: 24,
        }}>
            <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xl)', padding: '28px 32px', maxWidth: 380,
                textAlign: 'center', boxShadow: 'var(--shadow-card-hover)',
            }}>
                {error ? (
                    <>
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--accent-red)' }}>
                            Không thể tối ưu
                        </div>
                        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>{error}</p>
                        <button className="btn-secondary" onClick={() => setError('')}>Đóng</button>
                    </>
                ) : (
                    <>
                        <SpinnerGap size={30} weight="bold" style={{ color: 'var(--accent-blue)', animation: 'spin 0.9s linear infinite' }} />
                        <div style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 6px' }}>Đang chuẩn bị CV…</div>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Đang phân tích mô tả công việc và chấm độ phù hợp với CV của bạn.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
