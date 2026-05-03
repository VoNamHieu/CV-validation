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

export async function crawlUrl(url: string, keepLinks = false): Promise<{ text: string; textWithLinks?: string }> {
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
export async function fetchPage(url: string): Promise<{ success: boolean; text: string; method: string; error?: string; jsonLd?: Record<string, unknown> }> {
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
