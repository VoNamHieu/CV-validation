import styles from './landing.module.css';

export default function LiveBand() {
    return (
        <section className={styles.live}>
            <div className={styles.liveIn}>
                <div className={`${styles.liveStat} ${styles.reveal}`}>
                    <div className={styles.liveNum}>200+</div>
                    <p className={styles.liveLabel}><b>công ty</b> trong mạng lưới — quét từ trang tuyển dụng chính thức</p>
                </div>
                <div className={`${styles.liveStat} ${styles.reveal}`}>
                    <div className={styles.liveNum}>1.347<span className={styles.pulse} aria-hidden="true" /></div>
                    <p className={styles.liveLabel}><b>vị trí đang mở</b> lúc này — số liệu trực tiếp, không phải con số marketing</p>
                </div>
                <div className={`${styles.liveStat} ${styles.reveal}`}>
                    <div className={styles.liveNum}>24h</div>
                    <p className={styles.liveLabel}><b>chu kỳ làm mới.</b> Việc đã đóng sẽ biến mất — bạn không lãng phí một đơn nào</p>
                </div>
            </div>
        </section>
    );
}
