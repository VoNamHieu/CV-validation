import { NextResponse } from "next/server";

/**
 * Credit metering for the AI routes. A route calls `spendCredits(req, action)`
 * BEFORE doing any Gemini work; the cost is debited on the backend (which holds
 * the authoritative cost map and the user's balance).
 *
 * Fails CLOSED on auth/insufficient (401/402 → the user must log in / top up),
 * but fails OPEN on backend/network errors so a credits-service hiccup never
 * takes the whole product down.
 */
export class CreditError extends Error {
    constructor(public status: number, public payload: unknown) {
        super(`credit_${status}`);
    }
}

/**
 * Proof of what (if anything) was debited for this request. `requestId` is
 * minted server-side per route invocation and is BOTH the idempotency key
 * (a retried /spend with the same id never double-debits) and the refund
 * handle. Never send it to the browser.
 */
export interface SpendReceipt {
    charged: boolean;
    requestId: string;
    action: string;
    units: number;
}

function forwardAuthHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = request.headers.get("authorization");
    const xuid = request.headers.get("x-user-id");
    if (auth) headers["authorization"] = auth;
    if (xuid) headers["x-user-id"] = xuid;
    return headers;
}

export async function spendCredits(
    request: Request,
    action: string,
    units = 1,
): Promise<SpendReceipt> {
    const receipt: SpendReceipt = {
        charged: false, requestId: crypto.randomUUID(), action, units,
    };
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return receipt; // no backend configured (local dev) → don't block

    const headers = forwardAuthHeaders(request);
    const body = JSON.stringify({ action, units, request_id: receipt.requestId });

    // One retry on a network/timeout failure. The request_id makes the replay
    // idempotent server-side, so this narrows the fail-open window instead of
    // widening the double-charge one (retrying WITHOUT the id would).
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
            res = await fetch(`${backendUrl}/credits/spend`, {
                method: "POST", headers, body,
                signal: AbortSignal.timeout(10_000),
            });
        } catch {
            res = null; // network/timeout → retry once, then fail open
        }
    }
    if (!res) return receipt; // still unreachable → fail open, nothing charged

    if (res.ok) {
        receipt.charged = true;
        return receipt;
    }
    if (res.status === 401 || res.status === 402) {
        const payload = await res.json().catch(() => ({}));
        throw new CreditError(res.status, payload); // nothing was debited
    }
    return receipt; // other backend error → fail open
}

/**
 * The standard debit → work → refund-on-failure envelope for AI routes.
 * Charges first (so a broke/anonymous user never triggers Gemini work), runs
 * `work`, and refunds the charge if `work` THROWS — the user must not pay for
 * an AI call that produced nothing. The original error is rethrown untouched
 * so route-level handling (CreditError mapping, 500s) behaves exactly as
 * before. A CreditError from the debit itself propagates with no refund
 * needed — a 401/402 means nothing was charged.
 */
export async function withCredits<T>(
    request: Request,
    action: string,
    units: number,
    work: () => Promise<T>,
): Promise<T> {
    const receipt = await spendCredits(request, action, units);
    try {
        return await work();
    } catch (err) {
        await refundCredits(request, receipt);
        throw err;
    }
}

/**
 * Best-effort reverse of a charged spend — call when the AI work FAILED after
 * the debit, so the user doesn't pay for nothing. No-op when nothing was
 * charged or when CREDITS_INTERNAL_KEY isn't configured (refunds fail closed:
 * the backend only honors server-initiated refunds). Never throws — a refund
 * hiccup must not mask the original AI error the caller is propagating.
 */
export async function refundCredits(request: Request, receipt: SpendReceipt): Promise<void> {
    if (!receipt?.charged) return;
    const backendUrl = process.env.BACKEND_URL;
    const internalKey = process.env.CREDITS_INTERNAL_KEY;
    if (!backendUrl || !internalKey) return;
    const headers = forwardAuthHeaders(request);
    headers["x-internal-key"] = internalKey;
    try {
        await fetch(`${backendUrl}/credits/refund`, {
            method: "POST", headers,
            body: JSON.stringify({ request_id: receipt.requestId }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        // swallow — best-effort; the ledger's request_id lets support fix it up
    }
}

/** Map a thrown CreditError to a response; returns null for other errors. */
export function creditErrorResponse(e: unknown): NextResponse | null {
    if (e instanceof CreditError) {
        if (e.status === 401) {
            return NextResponse.json(
                { detail: "Vui lòng đăng nhập để dùng tính năng AI.", code: "auth_required" },
                { status: 401 },
            );
        }
        // 402 — out of credits; forward the backend payload (needed/balance)
        const payload = (e.payload as { detail?: unknown })?.detail ?? e.payload;
        return NextResponse.json(
            { detail: "Bạn đã hết credit. Hãy nâng cấp hoặc chờ được cấp thêm.", code: "insufficient_credits", info: payload },
            { status: 402 },
        );
    }
    return null;
}
