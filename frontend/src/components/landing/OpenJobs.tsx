import { JOBS } from './content';
import styles from './landing.module.css';

export default function OpenJobs({ onStart }: { onStart: () => void }) {
    return (
        <section className={styles.jobs} id="viec">
            <div className={styles.wrap}>
                <div className={`${styles.jobsHead} ${styles.reveal}`}>
                    <div>
                        <p className={styles.eyebrow} style={{ marginBottom: 16 }}>Đang mở tuần này</p>
                        <h2 className={styles.h2} style={{ marginBottom: 0 }}>Việc thật. Nguồn thật. Vừa được làm mới.</h2>
                    </div>
                    <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onStart}>Xem tất cả vị trí</button>
                </div>
                <div className={styles.jobsGrid}>
                    {JOBS.map((j) => (
                        <button className={`${styles.jobCard} ${styles.reveal}`} key={j.title} onClick={onStart}>
                            <div className={styles.jobCo}>
                                <span className={styles.jobLogo}>{j.logo}</span>
                                <span>{j.co}<small>{j.meta}</small></span>
                            </div>
                            <p className={styles.jobTitle}>{j.title}</p>
                            <div className={styles.jobMeta}><span>{j.type}</span><span className={styles.jobFresh}>{j.fresh}</span></div>
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}
