import styles from './landing.module.css';

export default function LandingNav({ onStart, onLogin, showLogin }: {
    onStart: () => void;
    onLogin: () => void;
    showLogin: boolean;
}) {
    return (
        <nav className={styles.nav}>
            <div className={styles.navIn}>
                <a className={styles.brand} href="#top">Copo<i>.</i></a>
                <div className={styles.navLinks}>
                    <a href="#tuyen-ngon" className={styles.hideM}>Tuyên ngôn</a>
                    <a href="#viec" className={styles.hideM}>Việc đang mở</a>
                    <a href="#faq" className={styles.hideM}>Câu hỏi</a>
                    {showLogin && (
                        <button className={`${styles.navlinkBtn} ${styles.hideM}`} onClick={onLogin}>Đăng nhập</button>
                    )}
                    <button className={`${styles.btn} ${styles.btnSm}`} onClick={onStart}>Vào app</button>
                </div>
            </div>
        </nav>
    );
}
