import Strike from './Strike';
import styles from './landing.module.css';

export default function FinalCta({ onStart }: { onStart: () => void }) {
    return (
        <section className={styles.final}>
            <div className={styles.wrap}>
                <h2 className={styles.reveal}>
                    Lần cuối bạn <Strike d="M2 7 C 30 3, 60 10, 98 5">xin</Strike> — <br />là hôm nay.
                </h2>
                <p className={styles.reveal}>Thả CV vào, xem mình đứng ở đâu. Không cần tài khoản để bắt đầu.</p>
                <button className={`${styles.btn} ${styles.btnSeal} ${styles.reveal}`} onClick={onStart}>Tải CV lên ngay</button>
                <small className={styles.reveal}>50 credit miễn phí khi đăng ký · Xoá dữ liệu bất cứ lúc nào</small>
            </div>
        </section>
    );
}
