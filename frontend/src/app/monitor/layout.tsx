import type { Metadata } from 'next';

// Internal monitoring surface — keep it out of search indexes.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MonitorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
