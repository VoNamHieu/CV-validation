import styles from './landing.module.css';

export default function ManifestoLetter() {
    return (
        <section className={styles.letter} id="tuyen-ngon">
            <div className={styles.wrap}>
                <p className={`${styles.eyebrow} ${styles.reveal}`}>Điều chúng tôi tin</p>
                <div className={`${styles.letterBody} ${styles.reveal}`}>
                    <p className={styles.lead}>Chúng tôi tin rằng đi tìm việc không phải là đi xin. Một sự nghiệp không phải chuỗi những lá đơn chờ được chấp thuận — nó là thứ bạn <u>vận hành</u>, mỗi ngày, bằng hiểu biết về chính mình.</p>
                    <p>Chúng tôi tin bạn xứng đáng biết mình đứng ở đâu trước khi bước vào bất kỳ cánh cửa nào. Biết mình khớp bao nhiêu, thiếu điều gì, và điều gì đáng học tiếp — không phải đoán mò trong im lặng.</p>
                    <p>Chúng tôi tin sự thật thắng sự đánh bóng. AI của chúng tôi không bịa một dòng nào vào CV của bạn, vì một cuộc phỏng vấn giành được bằng nội dung giả là một cuộc phỏng vấn đã thua.</p>
                    <p>Và chúng tôi tin thời gian của bạn nên dành cho việc trở nên giỏi hơn — không phải cho việc điền cùng một cái form lần thứ bốn mươi.</p>
                </div>
                <div className={`${styles.letterSign} ${styles.reveal}`}>
                    <div className={styles.seal} aria-hidden="true">COPO</div>
                    <p>Viết tại Hà Nội, 2026.<br />Cho mọi người đang đi tìm chỗ đứng xứng đáng của mình.</p>
                </div>
            </div>
        </section>
    );
}
