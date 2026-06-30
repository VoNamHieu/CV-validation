import type { Metadata } from 'next';
import LegalShell from '@/components/LegalShell';
import { TermsContent } from '@/components/legal/LegalContent';

export const metadata: Metadata = {
    title: 'Điều khoản sử dụng — JobFit AI',
    description: 'Điều khoản và điều kiện khi sử dụng dịch vụ JobFit AI.',
};

export default function TermsPage() {
    return (
        <LegalShell title="Điều khoản sử dụng" updated="30/06/2026">
            <TermsContent />
        </LegalShell>
    );
}
