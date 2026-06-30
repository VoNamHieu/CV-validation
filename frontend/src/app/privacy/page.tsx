import type { Metadata } from 'next';
import LegalShell from '@/components/LegalShell';
import { PrivacyContent } from '@/components/legal/LegalContent';

export const metadata: Metadata = {
    title: 'Chính sách Quyền riêng tư — JobFit AI',
    description: 'Cách JobFit AI thu thập, sử dụng, chia sẻ và bảo vệ dữ liệu cá nhân của bạn.',
};

export default function PrivacyPage() {
    return (
        <LegalShell title="Chính sách Quyền riêng tư" updated="30/06/2026">
            <PrivacyContent />
        </LegalShell>
    );
}
