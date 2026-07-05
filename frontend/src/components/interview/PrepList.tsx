'use client';

// Landing list for the interview tab: one bar per job the user has already
// prepped ("<job title> — Chuẩn bị phỏng vấn"), openable anytime. Joins the
// lightweight prep rows to the job history for titles; dedupes to one bar per
// job (a job re-prepped after a CV change has multiple rows).
import { useEffect, useState } from 'react';
import { ChatCircleDots, CaretRight, ClockCounterClockwise } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { account, type InterviewPrepSummary } from '@/lib/db';

function formatDate(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PrepList() {
    const jobHistory = useAppStore((s) => s.jobHistory);
    const loadJobHistory = useAppStore((s) => s.loadJobHistory);
    const openInterviewPrep = useAppStore((s) => s.openInterviewPrep);

    const [preps, setPreps] = useState<InterviewPrepSummary[] | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        void loadJobHistory();
        (async () => {
            try {
                const rows = await account.listInterviewPreps();
                if (!cancelled) setPreps(rows);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được danh sách.');
            }
        })();
        return () => { cancelled = true; };
    }, [loadJobHistory]);

    // One bar per job (rows are newest-first, so keep the first seen).
    const seen = new Set<string>();
    const unique = (preps ?? []).filter((p) => (seen.has(p.job_ref) ? false : (seen.add(p.job_ref), true)));

    return (
        <div className="animate-fade-in" style={{ maxWidth: 820, margin: '0 auto', padding: '40px 32px' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <ChatCircleDots size={22} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                Phỏng vấn
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24 }}>
                Các buổi chuẩn bị phỏng vấn bạn đã tạo. Bấm để mở lại và luyện tập bất cứ lúc nào.
            </p>

            {error && <p style={{ color: 'var(--accent-red)', fontSize: '0.88rem' }}>{error}</p>}

            {preps === null && !error && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '40px 0', textAlign: 'center' }}>Đang tải…</p>
            )}

            {preps !== null && unique.length === 0 && (
                <div style={{ padding: '48px 24px', textAlign: 'center', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--gradient-card)' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 420, margin: '0 auto' }}>
                        Chưa có buổi chuẩn bị nào. Vào tab <strong>Lịch sử</strong>, chọn một việc đã tối ưu CV và bấm <strong>“Chuẩn bị phỏng vấn”</strong>.
                    </p>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unique.map((p) => {
                    const rec = jobHistory.find((r) => r.id === p.job_ref);
                    const title = rec?.jobTitle || 'Việc đã lưu';
                    const company = rec?.company;
                    return (
                        <button
                            key={p.id}
                            onClick={() => openInterviewPrep(p.job_ref)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                                padding: '14px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                            }}
                        >
                            <ChatCircleDots size={18} weight="duotone" style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {title}: Chuẩn bị phỏng vấn
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                    {company && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</span>}
                                    {p.question_count > 0 && <span>{p.question_count} câu hỏi</span>}
                                    {p.updated_at && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><ClockCounterClockwise size={11} />{formatDate(p.updated_at)}</span>}
                                </span>
                            </span>
                            <CaretRight size={15} weight="bold" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
