import { ImageResponse } from 'next/og';
import { beVietnamFont, OG } from '../../_og/og';

// Per-job social card (1200×630) — a real banner beats the old square logo.
export const runtime = 'nodejs';
export const alt = 'Tin tuyển dụng trên Copo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Minimal read of the public snapshot — just the text this card needs. Kept
// separate from page.tsx's fetcher (no preview / cross-links here).
async function jobHeader(slug: string): Promise<{ title: string; company: string; location: string }> {
  const fallback = { title: 'Cơ hội việc làm', company: 'Copo', location: '' };
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return fallback;
  try {
    const res = await fetch(`${backendUrl}/store/promoted/by-slug/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return fallback;
    const page = await res.json();
    return {
      title: page?.job?.title || fallback.title,
      company: page?.job?.company_name || fallback.company,
      location: page?.job?.location || '',
    };
  } catch {
    return fallback;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ title, company, location }, font] = await Promise.all([jobHeader(slug), beVietnamFont()]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: OG.bg,
          backgroundImage: `radial-gradient(1200px 500px at 15% -10%, ${OG.brand}18, transparent)`,
          fontFamily: 'Be Vietnam Pro',
        }}
      >
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: OG.ink }}>
          Copo<span style={{ color: OG.brand }}>.</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {company && (
            <div style={{ display: 'flex', fontSize: 38, color: OG.brand, marginBottom: 14 }}>{company}</div>
          )}
          <div
            style={{
              display: 'flex',
              fontSize: 68,
              fontWeight: 600,
              color: OG.ink,
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              // clamp very long titles so the card never overflows
              maxHeight: 260,
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 32, color: OG.muted }}>
          {location ? `${location}  ·  Việc làm được tuyển chọn` : 'Việc làm được tuyển chọn'}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Be Vietnam Pro', data: font, weight: 600, style: 'normal' }] },
  );
}
