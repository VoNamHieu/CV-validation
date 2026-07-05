// Lightweight, self-hosted funnel analytics. track() fires a fire-and-forget
// event to /api/events (→ backend public.events). Used to see how far users get
// in the wizard and where they drop. No third party; data stays in Supabase.
import { getAuthHeaders } from './auth-headers';

// The product funnel, in order. Shared by the tracker (what to emit) and the
// admin AnalyticsPanel (how to render + compute drop-off). Keep the `event` keys
// stable — they're the stored event names the backend aggregates by.
export const FUNNEL_STEPS: { event: string; label: string }[] = [
    { event: 'entered', label: 'Vào app' },
    { event: 'cv_uploaded', label: 'Tải CV' },
    { event: 'search_viewed', label: 'Tới bước tìm việc' },
    { event: 'results_viewed', label: 'Xem kết quả việc' },
    { event: 'optimize_started', label: 'Bắt đầu tối ưu CV' },
    { event: 'editor_reached', label: 'Vào trình sửa CV' },
    { event: 'apply_started', label: 'Bắt đầu ứng tuyển' },
    { event: 'apply_done', label: 'Ứng tuyển xong' },
];

// Stable per-tab session id so the backend can count DISTINCT sessions per step
// (resets on a hard reload / new tab — fine for a funnel).
function sessionId(): string {
    try {
        let id = sessionStorage.getItem('jobfit-sid');
        if (!id) {
            id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
            sessionStorage.setItem('jobfit-sid', id);
        }
        return id;
    } catch {
        return 'anon';
    }
}

export async function track(event: string, meta?: Record<string, unknown>): Promise<void> {
    try {
        await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify({
                event,
                session_id: sessionId(),
                page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
                meta,
            }),
            keepalive: true, // survive a navigation that happens right after
        });
    } catch {
        /* fire-and-forget — analytics must never break the app */
    }
}
