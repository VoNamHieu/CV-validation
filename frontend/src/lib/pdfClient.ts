'use client';

export async function extractTextFromPdf(file: File): Promise<string> {
    // Dynamically import pdfjs-dist only in the browser
    const pdfjsLib = await import('pdfjs-dist');

    // Disable worker to avoid CDN version mismatch issues
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
    }).promise;

    const textParts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
        textParts.push(pageText);
    }

    return textParts.join('\n');
}
