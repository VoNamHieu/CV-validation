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

export async function spendCredits(
    request: Request,
    action: string,
    units = 1,
): Promise<void> {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return; // no backend configured (local dev) → don't block

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = request.headers.get("authorization");
    const xuid = request.headers.get("x-user-id");
    if (auth) headers["authorization"] = auth;
    if (xuid) headers["x-user-id"] = xuid;

    let res: Response;
    try {
        res = await fetch(`${backendUrl}/credits/spend`, {
            method: "POST",
            headers,
            body: JSON.stringify({ action, units }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        return; // network/timeout → fail open
    }

    if (res.ok) return;
    if (res.status === 401 || res.status === 402) {
        const payload = await res.json().catch(() => ({}));
        throw new CreditError(res.status, payload);
    }
    return; // other backend error → fail open
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
