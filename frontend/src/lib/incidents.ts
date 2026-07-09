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
    message?: string;
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
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
                    message: input.message,
                    code: input.code,
                    stack: input.stack,
                    context: input.context,
                    session_id: sessionId(),
                }),
                keepalive: true, // survive a navigation right after the error
            });
        } catch {
            /* fire-and-forget — the reporter must never break the app */
        }
    })();
}
