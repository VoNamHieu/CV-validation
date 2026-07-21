import type { Metadata } from 'next';

// Extension-compatibility helper page — not a search surface.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CompatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
