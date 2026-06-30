import { redirect } from 'next/navigation';

// The link-health monitor now lives inside the admin console (gated).
export default function MonitorRedirect() {
    redirect('/admin?tab=monitor');
}
