import { CREDITS } from './content';
import styles from './landing.module.css';

export default function Credits() {
    return (
        <section className={styles.credits}>
            <div className={styles.wrap}>
                <p className={`${styles.eyebrow} ${styles.reveal}`} style={{ marginBottom: 16 }}>Minh bạch đến từng credit</p>
                <h2 className={`${styles.h2} ${styles.reveal}`}>Miễn phí để bắt đầu.<br />Rõ ràng khi dùng tiếp.</h2>
                <p className={`${styles.creditsSub} ${styles.reveal}`}>
                    Tạo tài khoản là có ngay <b>50 credit</b>. Không thẻ tín dụng, không tự động gia hạn,
                    không phí ẩn. Đây là chính xác những gì mỗi credit mua được:
                </p>
                <div className={`${styles.creditRows} ${styles.reveal}`}>
                    {CREDITS.map((c, i) => (
                        <div className={styles.creditRow} key={i}><span>{c.label}</span><span>{c.cost}</span></div>
                    ))}
                </div>
            </div>
        </section>
    );
}
