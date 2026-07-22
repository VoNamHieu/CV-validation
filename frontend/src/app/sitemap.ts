import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Rebuilt at most hourly; the job set changes slowly and the fetch hits the
// backend, so we don't want it on every crawler request.
export const revalidate = 3600;

type SitemapRow = { slug: string; updated_at: string };

// Published /j/ pages, straight from the backend's public sitemap endpoint.
// Best-effort: any failure yields an empty list so the static routes still ship.
async function promotedEntries(): Promise<MetadataRoute.Sitemap> {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return [];
  try {
    const res = await fetch(`${backendUrl}/store/promoted/sitemap`, {
      next: { revalidate },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as SitemapRow[];
    return rows.map((r) => ({
      url: `${SITE_URL}/j/${r.slug}`,
      lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ];
  return [...staticRoutes, ...(await promotedEntries())];
}
