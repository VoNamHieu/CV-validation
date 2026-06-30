// Where users get the Latosa auto-apply Chrome extension. Centralised so every
// "cần cài extension" prompt points at the same place.
export const EXTENSION_INSTALL_URL =
    'https://drive.google.com/file/d/1Ja5_jyISkHF0NAuHMv8sbPRYdYIPD7YQ/view?usp=sharing';

// Fired by any extension-required action when the extension isn't detected.
// A single globally-mounted <InstallExtensionModal/> listens and shows the
// install prompt — so callers just dispatch, no prop drilling.
export const NEED_EXTENSION_EVENT = 'jobfit:need-extension';

export function promptInstallExtension(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(NEED_EXTENSION_EVENT));
}
