// Server component front door. Reads the `copo-authed` hint cookie so the
// initial HTML is correct WITHOUT running JS: anonymous visitors and crawlers
// (no cookie) get the full <Landing /> markup server-rendered; returning members
// (cookie present) get a blank during session-restore to avoid a landing flash.
// All interactive logic lives in the client island <HomeClient />.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import HomeClient from '@/components/HomeClient';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function Home() {
  const authed = (await cookies()).has('copo-authed');
  return <HomeClient initialAuthed={authed} />;
}
