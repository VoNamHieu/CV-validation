// All API calls use Next.js API routes (relative paths)
import type { CVData } from './types';

export type OptimizeStyle = 'formal' | 'direct' | 'impact-driven' | 'storytelling';
export type OptimizeFocus = 'balanced' | 'technical' | 'leadership' | 'metrics' | 'ats-keyword';
export type OptimizeLength = 'concise' | 'detailed';

export interface OptimizeOptions {
    style?: OptimizeStyle;
    focus?: OptimizeFocus;
    length?: OptimizeLength;
    variants?: number;
    useGaps?: boolean;
}

export interface OptimizeVariant {
    label: string;
    style: OptimizeStyle;
    focus: OptimizeFocus;
    length: OptimizeLength;
    cv: CVData;
}

export interface OptimizeResponse {
    variants: OptimizeVariant[];
}

export async function parsePdfWithAI(file: File, type: 'cv' | 'jd') {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64, type }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to parse PDF');
    }
    return res.json();
}

export async function extractCvStructured(rawText: string) {
    const res = await fetch('/api/ai/extract-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract CV');
    }
    return res.json();
}

export async function extractJdStructured(rawText: string) {
    const res = await fetch('/api/ai/extract-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract JD');
    }
    return res.json();
}

export async function scoreFit(cv: unknown, jd: unknown) {
    const res = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to score fit');
    }
    return res.json();
}

export async function optimizeCvVariants(
    cv: unknown,
    jd: unknown,
    match: unknown,
    options?: OptimizeOptions,
): Promise<OptimizeResponse> {
    const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd, match, options }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to optimize CV');
    }
    return res.json();
}

/** Backwards-compatible single-variant optimize. Returns first variant's CV. */
export async function optimizeCv(
    cv: unknown,
    jd: unknown,
    match: unknown,
    options?: OptimizeOptions,
): Promise<CVData> {
    const data = await optimizeCvVariants(cv, jd, match, options);
    return data.variants[0].cv;
}

export async function crawlUrl(url: string, keepLinks = false): Promise<{ text: string; textWithLinks?: string; jsonLd?: Record<string, unknown> | null; source_url?: string }> {
    const res = await fetch('/api/crawl-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keepLinks }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to crawl URL');
    }
    return res.json();
}

// ── Smart Search: AI infers job title from CV + generates search URL ──
export async function smartSearch(cv: unknown, siteUrl: string) {
    const res = await fetch('/api/ai/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, siteUrl }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to generate search');
    }
    return res.json();
}

// ── Extract job links from search results page ──
export async function extractJobLinks(htmlText: string, siteUrl: string) {
    const res = await fetch('/api/ai/extract-job-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html_text: htmlText, site_url: siteUrl }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract job links');
    }
    return res.json();
}

// ── Fetch a single page with Playwright via Railway backend ──
export async function fetchPage(url: string): Promise<{
    success: boolean;
    text: string;
    method: string;
    error?: string;
    jsonLd?: Record<string, unknown>;
    blocked?: boolean;
}> {
    const res = await fetch('/api/fetch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to fetch page');
    }
    return res.json();
}

// ── Extension presence check ──
export function isExtensionAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).__jobfitExtensionId;
}

// ── Crawl a URL by opening it in a background tab via the Chrome extension.
//    Bypasses Cloudflare because the request originates from the user's own
//    browser on their residential IP, with their normal cookies/session.    ──
export async function extensionCrawl(url: string, timeoutMs = 45000): Promise<{
    success: boolean;
    text: string;
    html?: string;
    jsonLd?: Record<string, unknown> | null;
    error?: string;
}> {
    if (typeof window === 'undefined') {
        return { success: false, text: '', error: 'No window (SSR)' };
    }
    if (!isExtensionAvailable()) {
        return { success: false, text: '', error: 'Extension not installed' };
    }

    const requestId = `extcrawl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const d = event.data;
            if (d?.type !== 'JOBFIT_EXT_CRAWL_RESPONSE' || d.requestId !== requestId) return;
            cleanup();
            resolve({
                success: !!d.success,
                text: d.text || '',
                html: d.html,
                jsonLd: d.jsonLd ?? null,
                error: d.error,
            });
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve({ success: false, text: '', error: `Extension crawl timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
        };

        window.addEventListener('message', onMessage);
        window.postMessage({ type: 'JOBFIT_EXT_CRAWL', requestId, url }, '*');
    });
}
