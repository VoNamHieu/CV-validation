import { renderCvHtml } from '@/lib/cv-templates';
import type { CvTemplateId } from '@/lib/cv-templates';
import { syncCvFileToExtension } from '@/lib/extension-sync';
import type { CVData } from '@/lib/types';

// Render an optimized CV to PDF eagerly so the extension can upload it during
// auto-apply without paying the render cost per job, and push it into
// extension storage right away so applies launched outside the batch flow
// (floating button / single apply) also have a CV file.
// Failure is non-fatal — the batch flow falls back to rendering on demand.
export async function buildCvPdfCache(
    cv: CVData,
    opts: {
        jobTitle?: string;
        templateId?: CvTemplateId;
        avatarBase64?: string | null;
    } = {},
): Promise<{ optimizedCvPdfBase64?: string; optimizedCvFileName?: string }> {
    try {
        const html = renderCvHtml(cv, opts.templateId, {
            avatarBase64: opts.avatarBase64 ?? undefined,
        });
        const safeTitle = (opts.jobTitle || 'job').replace(/\s+/g, '_').slice(0, 40);
        const filename = `${cv.name.replace(/\s+/g, '_')}_${safeTitle}.pdf`;
        const res = await fetch('/api/render-cv-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, filename }),
        });
        if (!res.ok) return {};
        const { base64, filename: outName } = await res.json() as { base64: string; filename: string };
        syncCvFileToExtension(base64, outName).then((r) => {
            if (!r.ok) console.warn('[buildCvPdfCache] CV file sync → extension failed:', r.error);
        });
        return { optimizedCvPdfBase64: base64, optimizedCvFileName: outName };
    } catch (err) {
        console.warn('[buildCvPdfCache] PDF cache render failed (non-fatal):', err);
        return {};
    }
}
