import type { Metadata } from 'next';
import LegalShell from '@/components/LegalShell';

export const metadata: Metadata = {
    title: 'Chính sách Quyền riêng tư — JobFit AI',
    description: 'Cách JobFit AI thu thập, sử dụng, chia sẻ và bảo vệ dữ liệu cá nhân của bạn.',
};

export default function PrivacyPage() {
    return (
        <LegalShell title="Chính sách Quyền riêng tư" updated="30/06/2026">
            <p className="lead">
                JobFit AI (&quot;chúng tôi&quot;, &quot;JobFit&quot;) là dịch vụ hỗ trợ tìm việc bằng AI, bao gồm
                ứng dụng web và tiện ích mở rộng trình duyệt Chrome. Chính sách này giải thích chúng tôi
                thu thập, sử dụng, chia sẻ và bảo vệ dữ liệu cá nhân của bạn như thế nào khi bạn sử dụng
                JobFit AI.
            </p>

            <h2>1. Dữ liệu chúng tôi thu thập</h2>
            <p><strong>1.1 Thông tin tài khoản</strong> — Email và thông tin xác thực khi bạn đăng ký/đăng nhập
                (qua Supabase Auth). Chúng tôi không lưu trữ mật khẩu của bạn dưới dạng văn bản thuần.</p>
            <p><strong>1.2 Dữ liệu CV</strong> — Nội dung file CV bạn tải lên (PDF) và các trường thông tin được
                trích xuất từ đó: họ tên, thông tin liên hệ, học vấn, kinh nghiệm làm việc, kỹ năng.</p>
            <p><strong>1.3 Dữ liệu tin tuyển dụng</strong> — Link hoặc nội dung mô tả công việc (JD) bạn nhập vào
                hệ thống để phân tích và so khớp.</p>
            <p><strong>1.4 Dữ liệu sử dụng dịch vụ</strong> — Lịch sử các hành động bạn thực hiện (trích xuất CV,
                chấm điểm phù hợp, tối ưu CV, tự động điền đơn) và số credit đã sử dụng. Hiện tại JobFit chưa
                tích hợp cổng thanh toán, nên chúng tôi không thu thập hoặc lưu trữ thông tin thẻ/tài khoản
                ngân hàng của bạn.</p>
            <p><strong>1.5 Dữ liệu theo dõi ứng tuyển</strong> — Trạng thái các đơn ứng tuyển bạn lưu lại trong
                hệ thống (đã tối ưu, đã điền, đã nộp, có phản hồi, phỏng vấn, trúng tuyển, bị từ chối), tên công
                ty, vị trí, điểm phù hợp.</p>
            <h3>1.6 Dữ liệu từ tiện ích mở rộng Chrome</h3>
            <p>Khi bạn chủ động kích hoạt agent tự động điền đơn trên một trang tuyển dụng, tiện ích sẽ đọc cấu
                trúc trang (tên trường nhập liệu, nút bấm, nội dung lỗi hiển thị) để xác định cách điền — chỉ
                phục vụ mục đích điền form, không thu thập nội dung trang ngoài phạm vi đó.</p>
            <p>Tiện ích không thu thập dữ liệu duyệt web của bạn trên các trang không liên quan đến tìm việc/ứng
                tuyển, và không tự động gửi dữ liệu lên máy chủ trừ khi bạn chủ động thực hiện một hành động
                (điền đơn, gỡ lỗi, đồng bộ hồ sơ).</p>

            <h2>2. Mục đích sử dụng dữ liệu</h2>
            <p>Chúng tôi sử dụng dữ liệu trên để: vận hành các tính năng cốt lõi (phân tích CV, so khớp công
                việc, tối ưu CV, tự động điền đơn ứng tuyển); duy trì tài khoản và lịch sử sử dụng của bạn; cải
                thiện độ chính xác của các adapter nhận diện hệ thống tuyển dụng (ATS); và liên hệ với bạn về
                các vấn đề liên quan đến tài khoản khi cần thiết. Chúng tôi không sử dụng dữ liệu CV hoặc JD của
                bạn cho mục đích quảng cáo nhắm mục tiêu.</p>

            <h2>3. Chia sẻ dữ liệu với bên thứ ba</h2>
            <p>Chúng tôi không bán dữ liệu cá nhân của bạn. Dữ liệu được chia sẻ với một số bên xử lý kỹ thuật
                cần thiết để vận hành dịch vụ:</p>
            <ul>
                <li><strong>Google Gemini API</strong> — Nội dung CV và JD được gửi đến Gemini để thực hiện trích
                    xuất thông tin, chấm điểm phù hợp và viết lại nội dung CV. Việc xử lý tuân theo điều khoản sử
                    dụng API thương mại hiện hành của Google. (Khuyến nghị: kiểm tra và dẫn nguồn điều khoản dữ
                    liệu mới nhất của Google Gemini API tại thời điểm công bố chính sách, vì điều khoản này có thể
                    thay đổi.)</li>
                <li><strong>Supabase</strong> — Nền tảng lưu trữ tài khoản, dữ liệu CV và lịch sử ứng tuyển của bạn.</li>
                <li><strong>Railway</strong> — Hạ tầng máy chủ backend xử lý các yêu cầu của ứng dụng.</li>
            </ul>
            <p>Chúng tôi có thể tiết lộ dữ liệu nếu pháp luật yêu cầu, hoặc để bảo vệ quyền, tài sản, an toàn của
                JobFit AI, người dùng, hoặc bên thứ ba.</p>

            <h2>4. Lưu trữ và bảo mật</h2>
            <p>Dữ liệu được truyền tải qua kết nối mã hoá (HTTPS) và xác thực bằng JWT. Quyền truy cập dữ liệu
                được giới hạn theo từng tài khoản người dùng ở tầng ứng dụng. Tuy nhiên, không có hệ thống nào an
                toàn tuyệt đối — chúng tôi không thể đảm bảo an toàn tuyệt đối cho mọi thông tin truyền qua
                internet.</p>

            <h2>5. Thời gian lưu trữ và quyền xoá dữ liệu</h2>
            <p>Dữ liệu của bạn được lưu trữ trong thời gian tài khoản còn hoạt động. Bạn có thể yêu cầu xoá tài
                khoản và dữ liệu liên quan bất kỳ lúc nào bằng cách liên hệ{' '}
                <a href="mailto:vonamhieu.work@gmail.com">vonamhieu.work@gmail.com</a>. Một số dữ liệu ứng tuyển
                đã hoàn tất (ví dụ: kết quả phỏng vấn, trúng tuyển) có thể được ẩn danh hoá thay vì xoá hoàn toàn
                nhằm phục vụ thống kê tổng hợp, không định danh cá nhân.</p>

            <h2>6. Quyền của bạn</h2>
            <p>Theo quy định pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP), bạn có các
                quyền cơ bản: được biết về việc xử lý dữ liệu của mình; đồng ý hoặc rút lại đồng ý; truy cập dữ
                liệu; yêu cầu chỉnh sửa hoặc xoá dữ liệu; hạn chế xử lý; phản đối xử lý; và khiếu nại nếu quyền
                của bạn bị vi phạm. Để thực hiện các quyền này, vui lòng liên hệ{' '}
                <a href="mailto:vonamhieu.work@gmail.com">vonamhieu.work@gmail.com</a>.</p>

            <h2>7. Tiện ích mở rộng Chrome</h2>
            <p>Tiện ích JobFit AI yêu cầu một số quyền truy cập trình duyệt (đọc/tương tác với nội dung trang,
                quản lý tab) để thực hiện chức năng tự động điền đơn ứng tuyển trên các trang tuyển dụng. Phạm vi
                quyền truy cập được giới hạn ở mức cần thiết cho chức năng này; tiện ích không theo dõi hoạt động
                duyệt web của bạn ngoài mục đích đã nêu, và không thu thập hay truyền dữ liệu mà không có hành
                động chủ động từ bạn.</p>

            <h2>8. Cookie</h2>
            <p>Ứng dụng web sử dụng cookie/local storage cần thiết để duy trì phiên đăng nhập của bạn. Chúng tôi
                hiện không sử dụng cookie theo dõi quảng cáo của bên thứ ba.</p>

            <h2>9. Trẻ em</h2>
            <p>JobFit AI không hướng đến và không cố ý thu thập dữ liệu từ người dùng dưới 18 tuổi. Nếu bạn cho
                rằng chúng tôi đã vô tình thu thập dữ liệu của người dưới 18 tuổi, vui lòng liên hệ để chúng tôi
                xử lý.</p>

            <h2>10. Thay đổi chính sách</h2>
            <p>Chúng tôi có thể cập nhật chính sách này theo thời gian. Phiên bản mới sẽ được đăng tại trang này
                kèm ngày cập nhật. Việc tiếp tục sử dụng dịch vụ sau khi chính sách thay đổi đồng nghĩa bạn chấp
                nhận các thay đổi đó.</p>

            <h2>11. Liên hệ</h2>
            <p>Nếu có câu hỏi về chính sách này hoặc về cách dữ liệu của bạn được xử lý, vui lòng liên hệ:{' '}
                <a href="mailto:vonamhieu.work@gmail.com">vonamhieu.work@gmail.com</a>.</p>
        </LegalShell>
    );
}
