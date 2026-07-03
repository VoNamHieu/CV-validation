'use client';

// CTA for a public job landing page. Branches on auth:
//   • anonymous → "Đăng nhập để xem độ phù hợp & ứng tuyển" (opens login prompt)
//   • logged in → "Tối ưu CV cho job này" → jumps into the editor/tailor flow
// DEMO: the logged-in action routes to the app root with ?promoted=<slug>; the
// actual state seed (snapshot JD → tailor step 3) is wired in a later pass.
import { useRouter } from 'next/navigation';
import { Sparkle, SignIn, ShieldCheck, Gauge } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import styles from './PromotedJobCta.module.css';

export default function PromotedJobCta({ slug, title }: { slug: string; title: string }) {
    const router = useRouter();
    const { user, loading, promptLogin } = useAuth();

    const perks = (
        <ul className={styles.perks}>
            <li><Gauge size={15} weight="fill" /> Chấm điểm độ phù hợp CV ↔ mô tả công việc</li>
            <li><Sparkle size={15} weight="fill" /> Tối ưu CV theo đúng yêu cầu vị trí</li>
            <li><ShieldCheck size={15} weight="fill" /> Ứng tuyển ngay trên Copo, không rời trang</li>
        </ul>
    );

    if (loading) {
        return <div className={`${styles.card} ${styles.skeleton}`} aria-hidden />;
    }

    if (!user) {
        return (
            <div className={styles.card}>
                <div className={styles.badge}><Gauge size={13} weight="fill" /> Kiểm tra độ phù hợp</div>
                <h3 className={styles.heading}>Bạn có phù hợp với vị trí này?</h3>
                <p className={styles.sub}>Đăng nhập để xem điểm phù hợp và tối ưu CV để ứng tuyển.</p>
                {perks}
                <button
                    className={styles.cta}
                    onClick={() => promptLogin('Đăng nhập để xem độ phù hợp và ứng tuyển')}
                >
                    <SignIn size={18} weight="bold" />
                    Đăng nhập để xem độ phù hợp
                </button>
                <p className={styles.fine}>Miễn phí · chỉ mất vài giây</p>
            </div>
        );
    }

    return (
        <div className={styles.card}>
            <div className={styles.badge}><Sparkle size={13} weight="fill" /> Sẵn sàng ứng tuyển</div>
            <h3 className={styles.heading}>Tối ưu CV cho vị trí này</h3>
            <p className={styles.sub}>
                Copo điều chỉnh CV của bạn theo mô tả của <b>{title}</b> rồi đưa bạn vào trình chỉnh sửa.
            </p>
            {perks}
            <button
                className={styles.cta}
                onClick={() => router.push(`/?promoted=${encodeURIComponent(slug)}`)}
            >
                <Sparkle size={18} weight="fill" />
                Tối ưu CV cho job này
            </button>
        </div>
    );
}
