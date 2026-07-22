import { ImageResponse } from 'next/og';
import { beVietnamFont, OG } from './_og/og';

// Default social card for every route without its own og:image (homepage,
// privacy, terms). Node runtime so we can read the font off disk.
export const runtime = 'nodejs';
export const alt = 'Copo, trợ lý AI tìm việc, tối ưu CV và tự động ứng tuyển';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const font = await beVietnamFont();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '96px',
          background: OG.bg,
          backgroundImage: `radial-gradient(1200px 500px at 15% -10%, ${OG.brand}18, transparent)`,
          fontFamily: 'Be Vietnam Pro',
        }}
      >
        <div style={{ display: 'flex', fontSize: 150, fontWeight: 600, color: OG.ink, letterSpacing: '-0.04em' }}>
          Copo<span style={{ color: OG.brand }}>.</span>
        </div>
        <div style={{ display: 'flex', marginTop: 12, fontSize: 44, color: OG.muted, maxWidth: 980 }}>
          Tìm việc · Tối ưu CV · Tự động ứng tuyển bằng AI
        </div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 30, color: OG.brand }}>
          Cam kết không bịa nội dung
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Be Vietnam Pro', data: font, weight: 600, style: 'normal' }] },
  );
}
