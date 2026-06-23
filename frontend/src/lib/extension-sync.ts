// Promise-based sync helpers between the web app and the extension's
// content-webapp.js relay. Every sync waits for the relay's *_RESPONSE
// message instead of fire-and-forget, so callers can surface real
// success/failure instead of assuming the postMessage landed.

import type { CVData } from "@/lib/types";
import type { ExtensionProfile } from "@/lib/extension-profile";

export interface SyncResult {
    ok: boolean;
    /** Human-readable reason when ok === false. */
    error?: string;
}

const ACK_TIMEOUT_MS = 3000;

/**
 * Post a message to the extension relay and wait for its response message.
 * Resolves { ok: false } on timeout — which means the content script is not
 * injected on this page (wrong URL / extension reloaded without a tab
 * refresh / extension not installed).
 */
function postAndAwait(
    message: Record<string, unknown>,
    responseType: string,
): Promise<SyncResult> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", handler);
            resolve({
                ok: false,
                error:
                    "Extension không phản hồi — kiểm tra extension đã cài/bật và tải lại (F5) trang này.",
            });
        }, ACK_TIMEOUT_MS);

        const handler = (event: MessageEvent) => {
            if (event.source !== window) return;
            if (event.data?.type !== responseType) return;
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            if (event.data.success) {
                resolve({ ok: true });
            } else {
                resolve({ ok: false, error: event.data.error || "Extension báo lỗi không rõ." });
            }
        };

        window.addEventListener("message", handler);
        window.postMessage(message, "*");
    });
}

/** Sync the 23-field profile into extension storage. */
export function syncProfileToExtension(
    profile: ExtensionProfile,
    cvData?: CVData,
): Promise<SyncResult> {
    return postAndAwait(
        {
            type: "JOBFIT_EXPORT_PROFILE",
            profile,
            cvData,
            lastSyncedAt: Date.now(),
        },
        "JOBFIT_SYNC_PROFILE_RESPONSE",
    );
}

/** Sync a rendered CV PDF into extension storage for agent uploads. */
export function syncCvFileToExtension(
    cvFileBase64: string,
    cvFileName: string,
): Promise<SyncResult> {
    return postAndAwait(
        { type: "JOBFIT_SYNC_CV_FILE", cvFileBase64, cvFileName },
        "JOBFIT_SYNC_CV_FILE_RESPONSE",
    );
}

// ─────────────────────────────── Mode 1 ───────────────────────────────

/**
 * Sync the rich CV JSON into extension storage. The extension needs this to
 * tailor the CV against a job page's JD (Mode 1) — the flat 23-field profile
 * isn't enough (no experience bullets / skills detail).
 */
export function syncCvDataToExtension(cv: CVData): Promise<SyncResult> {
    return postAndAwait(
        { type: "JOBFIT_SYNC_CV_DATA", cv },
        "JOBFIT_SYNC_CV_DATA_RESPONSE",
    );
}

export interface Mode1Result {
    source_ref: string;
    improved_cv: CVData;
    improvements: unknown[];
    match: Record<string, unknown>;
}

/**
 * Subscribe to tailored-CV results pushed from the extension (Mode 1). The
 * extension tailors on the job page, then the background pushes the result
 * here for rendering. Returns an unsubscribe function.
 */
export function onMode1Result(callback: (result: Mode1Result) => void): () => void {
    const handler = (event: MessageEvent) => {
        if (event.source !== window) return;
        if (event.data?.type !== "JOBFIT_MODE1_RESULT") return;
        callback({
            source_ref: event.data.source_ref,
            improved_cv: event.data.improved_cv,
            improvements: event.data.improvements ?? [],
            match: event.data.match ?? {},
        });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
}

/**
 * Trigger the extension to auto-apply for a tailored job. The web app only
 * holds the opaque source_ref; the extension resolves it back to the real job
 * URL locally and opens it — the backend never learns the URL.
 */
export function triggerMode1Apply(
    sourceRef: string,
    opts?: { profile?: ExtensionProfile; cvFileBase64?: string; cvFileName?: string },
): Promise<SyncResult> {
    return postAndAwait(
        {
            type: "JOBFIT_MODE1_APPLY",
            sourceRef,
            profile: opts?.profile,
            cvFileBase64: opts?.cvFileBase64,
            cvFileName: opts?.cvFileName,
        },
        "JOBFIT_MODE1_APPLY_RESPONSE",
    );
}
