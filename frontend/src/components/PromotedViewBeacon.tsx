'use client';

import { useEffect } from 'react';

// Counts one human view of a /j/<slug> page. Fires from the browser (not the
// now-cached server render) so no-JS crawlers don't inflate view_count. The
// store proxy forwards this POST to the backend's /promoted/{slug}/view.
export default function PromotedViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      fetch(`/api/store/promoted/${encodeURIComponent(slug)}/view`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore — a missed view count is harmless */
    }
  }, [slug]);
  return null;
}
