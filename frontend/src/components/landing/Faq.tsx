import { FAQS } from './content';
import styles from './landing.module.css';

export default function Faq() {
    return (
        <section className={styles.faq} id="faq">
            <div className={styles.wrap}>
                <p className={`${styles.eyebrow} ${styles.reveal}`} style={{ marginBottom: 16 }}>Những điều bạn có quyền hỏi</p>
                <h2 className={`${styles.h2} ${styles.reveal}`}>Câu hỏi thẳng, trả lời thẳng.</h2>
                {FAQS.map((f, i) => (
                    <details className={styles.reveal} key={i}>
                        <summary>{f.q}</summary>
                        <p className={styles.faqA}>{f.a}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}
