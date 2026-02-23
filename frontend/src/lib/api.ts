const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function uploadPdfForExtraction(file: File, endpoint: 'cv' | 'jd'): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/extract/${endpoint}/pdf`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract PDF');
    }

    const data = await res.json();
    return data.extracted_text;
}

export async function extractCvStructured(rawText: string) {
    const res = await fetch(`${API_BASE}/ai/extract-cv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) throw new Error('Failed to extract CV');
    return res.json();
}

export async function extractJdStructured(rawText: string) {
    const res = await fetch(`${API_BASE}/ai/extract-jd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) throw new Error('Failed to extract JD');
    return res.json();
}

export async function scoreFit(cv: unknown, jd: unknown) {
    const res = await fetch(`${API_BASE}/ai/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd }),
    });
    if (!res.ok) throw new Error('Failed to score fit');
    return res.json();
}

export async function optimizeCv(cv: unknown, jd: unknown, match: unknown) {
    const res = await fetch(`${API_BASE}/ai/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd, match }),
    });
    if (!res.ok) throw new Error('Failed to optimize CV');
    return res.json();
}
