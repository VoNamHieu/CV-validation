import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Public surfaces: `/` (landing), `/j/*` (job pages), `/privacy`, `/terms`.
// Everything else is app-internal or an API and should not be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/monitor', '/compat', '/auth/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
