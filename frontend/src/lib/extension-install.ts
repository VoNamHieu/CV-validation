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
