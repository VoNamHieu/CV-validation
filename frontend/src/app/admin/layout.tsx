import type { Metadata } from 'next';

// Operator surface — keep it out of search indexes.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
