// Client-side incident reporter — fire-and-forget POST to /api/incidents
// (→ backend public.incidents). Captures API-call failures (from lib/db.ts
// req() and lib/api.ts) and extension-connection failures. Mirrors the
// analytics track() pattern: never throws, never blocks the flow.
import { getAuthHeaders } from './auth-headers';
import { sessionId } from './analytics';

export type IncidentType = 'api_error' | 'extension_error' | 'system_error';

interface ReportInput {
    incident_type: IncidentType;
    module: string;
    /** 'error' (default) or 'warning' — anything the operator can't act on is a warning. */
    severity?: 'error' | 'warning';
    message?: string;
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
}

// ── Transport noise ──────────────────────────────────────────────────────────
// A rejected fetch ("Failed to fetch" in Chrome, "Load failed" in Safari) means
// the request never reached our edge — so it says nothing about the API. It is
// what a laptop waking from sleep, a wifi handover, a reload mid-flight or a
// restarted dev server look like from JS, and it made up ~3/4 of the incident
// log. Server faults are unaffected: those come back as a real 5xx response.

/** Pure decision, so it can be tested without a DOM. */
export function isTransportNoise(env: {
    online: boolean; hidden: boolean; unloading: boolean; errorName?: string;
}): boolean {
    return !env.online || env.hidden || env.unloading
        || env.errorName === 'AbortError' || env.errorName === 'TimeoutError';
}

// `pagehide` fires before the tab is discarded/navigated; anything in flight at
// that point is cancelled by the browser, not failed by us.
let unloading = false;
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { unloading = true; });
    window.addEventListener('pageshow', () => { unloading = false; });
}

/** Same decision against the live browser state. */
export function isNetworkNoise(err: unknown): boolean {
    if (typeof window === 'undefined') return false;
    return isTransportNoise({
        online: navigator.onLine !== false,
        hidden: document.visibilityState === 'hidden',
        unloading,
        errorName: err instanceof Error ? err.name : undefined,
    });
}

// In-memory dedup: identical (type|module|message) within this window is
// dropped, so a failing endpoint hit in a loop can't flood the log.
const DEDUP_MS = 10_000;
const lastSeen = new Map<string, number>();

// Never report failures of the incident endpoint itself (would loop forever).
const INGEST_PATH = '/api/incidents';

export function reportIncident(input: ReportInput): void {
    if (typeof window === 'undefined') return;
    const endpoint = typeof input.context?.endpoint === 'string' ? input.context.endpoint : '';
    if (endpoint.includes(INGEST_PATH)) return;

    const key = `${input.incident_type}|${input.module}|${input.message ?? ''}`;
    const now = Date.now();
    const prev = lastSeen.get(key);
    if (prev && now - prev < DEDUP_MS) return;
    lastSeen.set(key, now);
    // Bound the map so it can't grow forever on a long-lived tab.
    if (lastSeen.size > 200) {
        for (const [k, t] of lastSeen) {
            if (now - t > DEDUP_MS) lastSeen.delete(k);
        }
    }

    void (async () => {
        try {
            await fetch(INGEST_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    incident_type: input.incident_type,
                    source: 'frontend',
                    module: input.module,
                    severity: input.severity ?? 'error',
                    message: input.message,
                    code: input.code,
                    stack: input.stack,
                    // page_url: without it a localhost dev session and a real
                    // production failure are indistinguishable in the log.
                    context: { ...input.context, page_url: window.location.href },
                    session_id: sessionId(),
                }),
                keepalive: true, // survive a navigation right after the error
            });
        } catch {
            /* fire-and-forget — the reporter must never break the app */
        }
    })();
}
