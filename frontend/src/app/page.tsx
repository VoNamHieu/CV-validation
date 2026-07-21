// Server component front door. Reads the `copo-authed` hint cookie so the
// initial HTML is correct WITHOUT running JS: anonymous visitors and crawlers
// (no cookie) get the full <Landing /> markup server-rendered; returning members
// (cookie present) get a blank during session-restore to avoid a landing flash.
// All interactive logic lives in the client island <HomeClient />.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import HomeClient from '@/components/HomeClient';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

// Organization entity — helps knowledge graphs / answer engines identify Copo.
const orgJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Copo',
  url: SITE_URL,
  logo: `${SITE_URL}/copo-logo.png`,
  description: 'Nền tảng nghề nghiệp ứng dụng AI: khám phá cơ hội phù hợp, chấm điểm độ khớp CV và tối ưu hồ sơ, cam kết không bịa nội dung.',
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'charles@copoai.net',
    contactType: 'customer support',
  },
}).replace(/</g, '\\u003c');

export default async function Home() {
  const authed = (await cookies()).has('copo-authed');
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: orgJsonLd }} />
      <HomeClient initialAuthed={authed} />
    </>
  );
}
