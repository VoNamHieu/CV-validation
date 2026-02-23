// All API calls use Next.js API routes (relative paths)

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

export async function optimizeCv(cv: unknown, jd: unknown, match: unknown) {
    const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd, match }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to optimize CV');
    }
    return res.json();
}
