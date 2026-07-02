import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    spendCredits, refundCredits, withCredits, CreditError, type SpendReceipt,
} from '@/lib/credits-guard';

function req(): Request {
    return new Request('http://app.local/api/ai/score', {
        method: 'POST',
        headers: { authorization: 'Bearer jwt-abc' },
    });
}

function okResponse(body: unknown = { balance: 45 }, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BACKEND_URL', 'http://backend.local');
});

afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

function sentBody(call: number): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

describe('spendCredits — receipts + idempotent retry', () => {
    it('returns a charged receipt and sends the request_id', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        const r = await spendCredits(req(), 'score', 1);
        expect(r.charged).toBe(true);
        expect(r.requestId).toMatch(/[0-9a-f-]{36}/);
        expect(sentBody(0)).toMatchObject({ action: 'score', units: 1, request_id: r.requestId });
    });

    it('retries ONCE on network failure with the SAME request_id, then fails open', async () => {
        fetchMock.mockRejectedValue(new Error('timeout'));
        const r = await spendCredits(req(), 'score', 1);
        expect(r.charged).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sentBody(0).request_id).toBe(sentBody(1).request_id);
    });

    it('recovers when the retry succeeds', async () => {
        fetchMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(okResponse());
        const r = await spendCredits(req(), 'optimize', 2);
        expect(r.charged).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws CreditError on 402 (nothing charged, no retry)', async () => {
        fetchMock.mockResolvedValueOnce(okResponse({ detail: 'broke' }, 402));
        await expect(spendCredits(req(), 'score', 1)).rejects.toBeInstanceOf(CreditError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('refundCredits — server-initiated only, best-effort', () => {
    const charged: SpendReceipt = { charged: true, requestId: 'rid-1', action: 'score', units: 1 };

    it('no-ops when nothing was charged', async () => {
        await refundCredits(req(), { ...charged, charged: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-ops when CREDITS_INTERNAL_KEY is not configured (fail closed)', async () => {
        await refundCredits(req(), charged);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts the request_id with the internal key and forwarded auth', async () => {
        vi.stubEnv('CREDITS_INTERNAL_KEY', 's3cret');
        fetchMock.mockResolvedValueOnce(okResponse({ status: 'refunded' }));
        await refundCredits(req(), charged);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://backend.local/credits/refund');
        expect(init.headers['x-internal-key']).toBe('s3cret');
        expect(init.headers['authorization']).toBe('Bearer jwt-abc');
        expect(JSON.parse(init.body)).toEqual({ request_id: 'rid-1' });
    });

    it('never throws — a refund hiccup must not mask the AI error', async () => {
        vi.stubEnv('CREDITS_INTERNAL_KEY', 's3cret');
        fetchMock.mockRejectedValueOnce(new Error('backend down'));
        await expect(refundCredits(req(), charged)).resolves.toBeUndefined();
    });
});

describe('withCredits — the debit → work → refund envelope', () => {
    it('refunds and rethrows when the work fails after a charge', async () => {
        vi.stubEnv('CREDITS_INTERNAL_KEY', 's3cret');
        fetchMock
            .mockResolvedValueOnce(okResponse())                       // spend
            .mockResolvedValueOnce(okResponse({ status: 'refunded' })); // refund
        const boom = new Error('gemini exploded');
        await expect(
            withCredits(req(), 'score', 1, async () => { throw boom; }),
        ).rejects.toBe(boom);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe('http://backend.local/credits/refund');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).request_id)
            .toBe(sentBody(0).request_id);
    });

    it('does not refund on success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        const out = await withCredits(req(), 'score', 1, async () => 'result');
        expect(out).toBe('result');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('propagates CreditError from the debit without any refund call', async () => {
        fetchMock.mockResolvedValueOnce(okResponse({ detail: 'broke' }, 402));
        await expect(
            withCredits(req(), 'score', 1, async () => 'never'),
        ).rejects.toBeInstanceOf(CreditError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
