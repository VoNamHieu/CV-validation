// Canonical public origin of the app. Used by metadataBase, robots.ts and
// sitemap.ts so absolute URLs (og:url, canonical, sitemap entries) are correct.
// Override per-env with NEXT_PUBLIC_SITE_URL (e.g. a preview deploy) if needed.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://copoai.net';
