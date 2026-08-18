import { TRUTHS } from './content';
import styles from './landing.module.css';

export default function Truths() {
    return (
        <section className={styles.truths}>
            <div className={styles.wrap}>
                <p className={`${styles.eyebrow} ${styles.reveal}`}>Cách cũ, nói thẳng</p>
                {TRUTHS.map((t, i) => (
                    <div className={`${styles.truth} ${styles.reveal}`} key={i}>
                        <div className={styles.truthNum}>{t.n}{t.s && <small>{t.s}</small>}</div>
                        <p className={styles.truthText}>{t.text}</p>
                    </div>
                ))}
                <p className={`${styles.truthsCoda} ${styles.reveal}`}>
                    Không phải vì bạn thiếu năng lực. Vì cả hệ thống được xây cho phía bên kia của
                    chiếc bàn. Chúng tôi xây lại nó — bắt đầu từ phía bạn.
                </p>
            </div>
        </section>
    );
}
