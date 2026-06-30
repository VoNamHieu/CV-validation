import type { Metadata } from 'next';
import LegalShell from '@/components/LegalShell';

export const metadata: Metadata = {
    title: 'Điều khoản sử dụng — JobFit AI',
    description: 'Điều khoản và điều kiện khi sử dụng dịch vụ JobFit AI.',
};

export default function TermsPage() {
    return (
        <LegalShell title="Điều khoản sử dụng" updated="30/06/2026">
            <p className="lead">
                Các điều khoản này điều chỉnh việc bạn sử dụng JobFit AI (&quot;chúng tôi&quot;, &quot;JobFit&quot;) —
                bao gồm ứng dụng web và tiện ích mở rộng trình duyệt Chrome. Bằng việc tạo tài khoản hoặc sử dụng
                dịch vụ, bạn đồng ý với các điều khoản này. Nếu không đồng ý, vui lòng không sử dụng dịch vụ.
            </p>

            <h2>1. Mô tả dịch vụ</h2>
            <p>JobFit AI là công cụ hỗ trợ tìm việc bằng AI: phân tích CV, gợi ý vị trí và công ty đang tuyển,
                chấm điểm độ phù hợp, gợi ý tối ưu CV theo từng vị trí, và hỗ trợ điền đơn ứng tuyển qua tiện ích
                trình duyệt. JobFit là công cụ hỗ trợ — không phải đơn vị tuyển dụng, không phải đại diện của bất
                kỳ nhà tuyển dụng nào, và không đảm bảo bạn sẽ được phỏng vấn hay nhận việc.</p>

            <h2>2. Tài khoản</h2>
            <p>Bạn cần đăng ký tài khoản (qua email) để dùng các tính năng AI. Bạn chịu trách nhiệm giữ bí mật
                thông tin đăng nhập và cho mọi hoạt động diễn ra dưới tài khoản của mình. Vui lòng cung cấp thông
                tin chính xác và thông báo cho chúng tôi nếu nghi ngờ tài khoản bị truy cập trái phép.</p>

            <h2>3. Điều kiện độ tuổi</h2>
            <p>Dịch vụ dành cho người dùng từ đủ 18 tuổi trở lên. Bằng việc sử dụng JobFit, bạn xác nhận mình đáp
                ứng điều kiện này.</p>

            <h2>4. Credit và thanh toán</h2>
            <p>Một số thao tác AI tiêu tốn &quot;credit&quot;. Tài khoản mới được tặng một lượng credit miễn phí.
                Hiện tại JobFit chưa tích hợp cổng thanh toán và không thu phí. Chúng tôi có thể thay đổi cơ chế
                credit, hạn mức hoặc giới thiệu gói trả phí trong tương lai; mọi thay đổi sẽ được thông báo trên
                dịch vụ trước khi áp dụng.</p>

            <h2>5. Sử dụng được phép</h2>
            <p>Bạn đồng ý chỉ sử dụng JobFit cho mục đích tìm việc hợp pháp của cá nhân bạn. Bạn không được:</p>
            <ul>
                <li>tải lên nội dung sai sự thật, vi phạm pháp luật, hoặc xâm phạm quyền của người khác;</li>
                <li>sử dụng dịch vụ để gửi thư rác (spam) hoặc nộp đơn hàng loạt gây phiền nhiễu cho nhà tuyển dụng;</li>
                <li>cố gắng dò tìm, can thiệp, đảo ngược kỹ thuật hoặc gây quá tải hệ thống;</li>
                <li>dùng công cụ tự động để truy cập dịch vụ ngoài các tính năng được cung cấp chính thức;</li>
                <li>vi phạm điều khoản của các trang tuyển dụng hay nền tảng bên thứ ba khi dùng tính năng tự động điền.</li>
            </ul>

            <h2>6. Nội dung của bạn</h2>
            <p>Bạn giữ toàn bộ quyền sở hữu đối với CV, mô tả công việc và nội dung khác bạn cung cấp. Bạn cấp cho
                JobFit quyền xử lý các nội dung đó (bao gồm gửi tới nhà cung cấp AI) chỉ nhằm cung cấp dịch vụ cho
                bạn. Bạn cam kết có quyền hợp pháp đối với nội dung mình tải lên.</p>

            <h2>7. Tính năng AI và giới hạn</h2>
            <p>Các tính năng AI có thể đưa ra kết quả không chính xác hoặc không đầy đủ. Chúng tôi áp dụng nguyên
                tắc &quot;không bịa nội dung&quot; khi tối ưu CV — AI chỉ viết lại dựa trên thông tin bạn cung cấp,
                không thêm dữ kiện không có thật. Tuy vậy, điểm phù hợp, gợi ý và nội dung do AI tạo ra chỉ mang
                tính tham khảo. <strong>Bạn có trách nhiệm tự kiểm tra và xác nhận mọi nội dung trước khi gửi cho
                nhà tuyển dụng.</strong></p>

            <h2>8. Tiện ích Chrome và tự động điền đơn</h2>
            <p>Tính năng tự động điền chỉ hoạt động khi bạn chủ động kích hoạt trên một trang tuyển dụng. Bạn có
                trách nhiệm rà soát kỹ toàn bộ thông tin được điền và chịu trách nhiệm cho đơn ứng tuyển trước khi
                nhấn nộp. JobFit không chịu trách nhiệm cho nội dung bạn đã nộp, và việc bạn sử dụng tính năng này
                phải tuân thủ điều khoản của trang tuyển dụng liên quan.</p>

            <h2>9. Sở hữu trí tuệ</h2>
            <p>Dịch vụ, thương hiệu, giao diện, mã nguồn và các thành phần của JobFit thuộc quyền sở hữu của chúng
                tôi và được pháp luật bảo hộ. Điều khoản này không trao cho bạn bất kỳ quyền nào đối với chúng,
                ngoài quyền sử dụng dịch vụ theo đúng các điều khoản này.</p>

            <h2>10. Miễn trừ bảo đảm</h2>
            <p>Dịch vụ được cung cấp &quot;nguyên trạng&quot; (as is) và &quot;theo khả năng sẵn có&quot;. Trong
                phạm vi pháp luật cho phép, chúng tôi không bảo đảm dịch vụ luôn sẵn sàng, không gián đoạn, không
                lỗi, hay rằng kết quả AI là chính xác hoặc phù hợp cho mục đích cụ thể của bạn.</p>

            <h2>11. Giới hạn trách nhiệm</h2>
            <p>Trong phạm vi pháp luật cho phép, JobFit không chịu trách nhiệm cho các thiệt hại gián tiếp, ngẫu
                nhiên hoặc hệ quả phát sinh từ việc sử dụng (hoặc không thể sử dụng) dịch vụ, bao gồm nhưng không
                giới hạn ở việc mất cơ hội việc làm, mất dữ liệu, hay sai sót trong nội dung do AI tạo ra.</p>

            <h2>12. Tạm ngừng và chấm dứt</h2>
            <p>Bạn có thể ngừng sử dụng và yêu cầu xoá tài khoản bất kỳ lúc nào (xem Chính sách Quyền riêng tư).
                Chúng tôi có thể tạm ngừng hoặc chấm dứt quyền truy cập của bạn nếu bạn vi phạm các điều khoản này
                hoặc sử dụng dịch vụ theo cách gây hại cho hệ thống, người dùng khác hoặc bên thứ ba.</p>

            <h2>13. Thay đổi điều khoản</h2>
            <p>Chúng tôi có thể cập nhật các điều khoản này theo thời gian. Phiên bản mới sẽ được đăng tại trang
                này kèm ngày cập nhật. Việc tiếp tục sử dụng dịch vụ sau khi điều khoản thay đổi đồng nghĩa bạn
                chấp nhận các thay đổi đó.</p>

            <h2>14. Luật áp dụng</h2>
            <p>Các điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Mọi tranh chấp phát sinh sẽ được ưu tiên
                giải quyết thông qua thương lượng; nếu không thành, sẽ được giải quyết theo quy định pháp luật
                hiện hành.</p>

            <h2>15. Liên hệ</h2>
            <p>Mọi câu hỏi về các điều khoản này, vui lòng liên hệ:{' '}
                <a href="mailto:vonamhieu.work@gmail.com">vonamhieu.work@gmail.com</a>.</p>
        </LegalShell>
    );
}
