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
