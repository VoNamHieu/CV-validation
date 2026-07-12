// Where users get the Copo auto-apply Chrome extension. Centralised so every
// "cần cài extension" prompt points at the same place. Chrome Web Store =
// one-click install, trusted origin (no manual .crx download / pin step).
export const EXTENSION_INSTALL_URL =
    'https://chromewebstore.google.com/detail/copo-%E2%80%94-auto-apply/nppifndmcdcleegpbpdekpkegadgbabo';

// Fired by any extension-required action when the extension isn't detected.
// A single globally-mounted <InstallExtensionModal/> listens and shows the
// install prompt — so callers just dispatch, no prop drilling.
export const NEED_EXTENSION_EVENT = 'jobfit:need-extension';

export function promptInstallExtension(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(NEED_EXTENSION_EVENT));
}

// Fired when an extension action fails because host permission for this site
// isn't granted yet. That grant can ONLY happen from the extension popup — the
// web-app user gesture is lost on the way to the background service worker, so
// the app can't request it (nor reliably open the popup; Chrome blocks that).
// A globally-mounted <GrantPermissionModal/> listens and walks the user through
// opening the popup and granting.
export const NEED_PERMISSION_EVENT = 'jobfit:need-permission';

export function promptGrantPermission(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(NEED_PERMISSION_EVENT));
}

// The extension reports missing host permission with a Vietnamese message
// containing "cấp quyền" / "quyền truy cập". Detect it so callers show the
// grant guide instead of a raw error banner.
export function isPermissionError(message: string): boolean {
    return /cấp quyền|quyền truy cập/i.test(message || '');
}
