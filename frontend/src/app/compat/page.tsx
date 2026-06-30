import { redirect } from 'next/navigation';

// The compatibility prober now lives inside the admin console (gated).
export default function CompatRedirect() {
    redirect('/admin?tab=compat');
}
