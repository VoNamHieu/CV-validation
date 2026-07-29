import styles from './landing.module.css';

export default function LandingFooter() {
    return (
        <footer className={styles.footer}>
            <div className={`${styles.wrap} ${styles.footerIn}`}>
                <span>© 2026 Copo — Viết tại Hà Nội, cho ứng viên.</span>
                <div className={styles.footerLinks}>
                    <a href="/privacy">Quyền riêng tư</a>
                    <a href="/terms">Điều khoản</a>
                    <a href="mailto:charles@copoai.net">Liên hệ</a>
                </div>
            </div>
        </footer>
    );
}
