import { BELIEFS } from './content';
import styles from './landing.module.css';

export default function Beliefs() {
    return (
        <section className={styles.beliefs}>
            <div className={styles.wrap}>
                <p className={`${styles.eyebrow} ${styles.reveal}`}>Niềm tin không đứng một mình</p>
                <h2 className={`${styles.h2} ${styles.reveal}`}>
                    Mỗi điều chúng tôi tin đều có một tính năng đứng sau làm bằng chứng.
                </h2>
                {BELIEFS.map((b, i) => (
                    <div className={`${styles.belief} ${styles.reveal}`} key={i}>
                        <p className={styles.beliefClaim}>{b.claim}</p>
                        <p className={styles.beliefProof}>
                            {b.proof}
                            <br />
                            {b.tags.map((t) => <span className={styles.tag} key={t}>{t}</span>)}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}
