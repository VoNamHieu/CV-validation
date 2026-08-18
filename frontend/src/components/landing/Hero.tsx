import Strike from './Strike';
import styles from './landing.module.css';

export default function Hero({ onStart }: { onStart: () => void }) {
    return (
        <header className={styles.hero} id="top">
            <div className={styles.wrap}>
                <p className={styles.eyebrow}>Một tuyên ngôn từ Copo</p>
                <div className={styles.heroGrid}>
                    <div>
                        <h1 className={styles.h1}>
                            Đừng đi <Strike d="M2 8 C 25 4, 55 10, 98 5">xin</Strike> việc nữa.
                        </h1>
                        <p className={styles.heroSub}>
                            Sự nghiệp của bạn không phải một lá đơn. Mọi công nghệ tuyển dụng đều được
                            xây để phục vụ phía tuyển — <b>Copo là AI đầu tiên đứng về phía bạn.</b>
                        </p>
                    </div>

                    <div className={styles.dzCard}>
                        <div className={styles.dzHead}>
                            <span>Hồ sơ của bạn</span>
                            <span className={styles.dzDot} aria-hidden="true" />
                        </div>
                        <div className={styles.dzBody}>
                            <button className={styles.dz} type="button" onClick={onStart}>
                                <div className={styles.dzIcon}>↑</div>
                                <div className={styles.dzTitle}>Thả CV vào đây — xem điểm khớp ngay</div>
                                <div className={styles.dzNote}>PDF · Không cần tạo tài khoản để xem thử</div>
                            </button>
                            <div className={styles.dzTrust}>
                                <span><b>✓</b> Không bịa nội dung</span>
                                <span><b>✓</b> Nguồn tuyển dụng chính thức</span>
                                <span><b>✓</b> Xoá dữ liệu bất cứ lúc nào</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
}
