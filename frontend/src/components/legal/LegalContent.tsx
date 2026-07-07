// Shared legal copy — rendered both on the /terms, /privacy pages (inside
// LegalShell) and inside the scroll-to-accept modal at signup. Single source
// of truth so the contract a user scroll-accepts is exactly the published page.

// Prose styling for the legal bodies. Injected wherever the content renders
// (LegalShell page + TermsAcceptModal) so the same markup looks identical.
export const LEGAL_PROSE_CSS = `
.legal-prose { color: var(--text-secondary); font-size: 0.92rem; line-height: 1.7; }
.legal-prose h1 { font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary); margin: 0 0 6px; }
.legal-prose .legal-updated { color: var(--text-muted); font-size: 0.82rem; margin: 0 0 28px; }
.legal-prose h2 { font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 30px 0 8px; letter-spacing: -0.01em; }
.legal-prose h3 { font-size: 0.92rem; font-weight: 700; color: var(--text-primary); margin: 16px 0 4px; }
.legal-prose p { margin: 0 0 12px; }
.legal-prose ul { margin: 0 0 12px; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; }
.legal-prose li { line-height: 1.6; }
.legal-prose a { color: var(--accent-blue); text-decoration: none; }
.legal-prose a:hover { text-decoration: underline; }
.legal-prose strong { color: var(--text-primary); font-weight: 600; }
.legal-prose .lead { color: var(--text-secondary); }
`;

export function TermsContent() {
    return (
        <>
            <p className="lead">
                Các điều khoản này điều chỉnh việc bạn sử dụng Copo (&quot;chúng tôi&quot;, &quot;Copo&quot;),
                bao gồm ứng dụng web và tiện ích mở rộng trình duyệt Chrome. Bằng việc tạo tài khoản hoặc sử dụng
                dịch vụ, bạn đồng ý với các điều khoản này. Nếu không đồng ý, vui lòng không sử dụng dịch vụ.
            </p>

            <h2>1. Mô tả dịch vụ</h2>
            <p>Copo là công cụ hỗ trợ tìm việc bằng AI: phân tích CV, gợi ý vị trí và công ty đang tuyển,
                chấm điểm độ phù hợp, gợi ý tối ưu CV theo từng vị trí, và hỗ trợ điền đơn ứng tuyển qua tiện ích
                trình duyệt. Copo là công cụ hỗ trợ. Đây không phải đơn vị tuyển dụng, không phải đại diện của bất
                kỳ nhà tuyển dụng nào, và không đảm bảo bạn sẽ được phỏng vấn hay nhận việc.</p>

            <h2>2. Tài khoản</h2>
            <p>Bạn cần đăng ký tài khoản (qua email) để dùng các tính năng AI. Bạn chịu trách nhiệm giữ bí mật
                thông tin đăng nhập và cho mọi hoạt động diễn ra dưới tài khoản của mình. Vui lòng cung cấp thông
                tin chính xác và thông báo cho chúng tôi nếu nghi ngờ tài khoản bị truy cập trái phép.</p>

            <h2>3. Điều kiện độ tuổi</h2>
            <p>Dịch vụ dành cho người dùng từ đủ 18 tuổi trở lên. Bằng việc sử dụng Copo, bạn xác nhận mình đáp
                ứng điều kiện này.</p>

            <h2>4. Credit và thanh toán</h2>
            <p>Một số thao tác AI tiêu tốn &quot;credit&quot;. Tài khoản mới được tặng một lượng credit miễn phí.
                Hiện tại Copo chưa tích hợp cổng thanh toán và không thu phí. Chúng tôi có thể thay đổi cơ chế
                credit, hạn mức hoặc giới thiệu gói trả phí trong tương lai; mọi thay đổi sẽ được thông báo trên
                dịch vụ trước khi áp dụng.</p>

            <h2>5. Sử dụng được phép</h2>
            <p>Bạn đồng ý chỉ sử dụng Copo cho mục đích tìm việc hợp pháp của cá nhân bạn. Bạn không được:</p>
            <ul>
                <li>tải lên nội dung sai sự thật, vi phạm pháp luật, hoặc xâm phạm quyền của người khác;</li>
                <li>sử dụng dịch vụ để gửi thư rác (spam) hoặc nộp đơn hàng loạt gây phiền nhiễu cho nhà tuyển dụng;</li>
                <li>cố gắng dò tìm, can thiệp, đảo ngược kỹ thuật hoặc gây quá tải hệ thống;</li>
                <li>dùng công cụ tự động để truy cập dịch vụ ngoài các tính năng được cung cấp chính thức;</li>
                <li>vi phạm điều khoản của các trang tuyển dụng hay nền tảng bên thứ ba khi dùng tính năng tự động điền.</li>
            </ul>

            <h2>6. Nội dung của bạn</h2>
            <p>Bạn giữ toàn bộ quyền sở hữu đối với CV, mô tả công việc và nội dung khác bạn cung cấp. Bạn cấp cho
                Copo quyền xử lý các nội dung đó (bao gồm gửi tới nhà cung cấp AI) chỉ nhằm cung cấp dịch vụ cho
                bạn. Bạn cam kết có quyền hợp pháp đối với nội dung mình tải lên.</p>

            <h2>7. Tính năng AI và giới hạn</h2>
            <p>Các tính năng AI có thể đưa ra kết quả không chính xác hoặc không đầy đủ. Chúng tôi áp dụng nguyên
                tắc &quot;không bịa nội dung&quot; khi tối ưu CV. AI chỉ viết lại dựa trên thông tin bạn cung cấp,
                không thêm dữ kiện không có thật. Tuy vậy, điểm phù hợp, gợi ý và nội dung do AI tạo ra chỉ mang
                tính tham khảo. <strong>Bạn có trách nhiệm tự kiểm tra và xác nhận mọi nội dung trước khi gửi cho
                nhà tuyển dụng.</strong></p>

            <h2>8. Tiện ích Chrome và tự động điền đơn</h2>
            <p>Tính năng tự động điền chỉ hoạt động khi bạn chủ động kích hoạt trên một trang tuyển dụng. Bạn có
                trách nhiệm rà soát kỹ toàn bộ thông tin được điền và chịu trách nhiệm cho đơn ứng tuyển trước khi
                nhấn nộp. Copo không chịu trách nhiệm cho nội dung bạn đã nộp, và việc bạn sử dụng tính năng này
                phải tuân thủ điều khoản của trang tuyển dụng liên quan.</p>

            <h2>9. Sở hữu trí tuệ</h2>
            <p>Dịch vụ, thương hiệu, giao diện, mã nguồn và các thành phần của Copo thuộc quyền sở hữu của chúng
                tôi và được pháp luật bảo hộ. Điều khoản này không trao cho bạn bất kỳ quyền nào đối với chúng,
                ngoài quyền sử dụng dịch vụ theo đúng các điều khoản này.</p>

            <h2>10. Miễn trừ bảo đảm</h2>
            <p>Dịch vụ được cung cấp &quot;nguyên trạng&quot; (as is) và &quot;theo khả năng sẵn có&quot;. Trong
                phạm vi pháp luật cho phép, chúng tôi không bảo đảm dịch vụ luôn sẵn sàng, không gián đoạn, không
                lỗi, hay rằng kết quả AI là chính xác hoặc phù hợp cho mục đích cụ thể của bạn.</p>

            <h2>11. Giới hạn trách nhiệm</h2>
            <p>Trong phạm vi pháp luật cho phép, Copo không chịu trách nhiệm cho các thiệt hại gián tiếp, ngẫu
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
                <a href="mailto:charles@copoai.net">charles@copoai.net</a>.</p>
        </>
    );
}

export function PrivacyContent() {
    return (
        <>
            <p className="lead">
                Copo (&quot;chúng tôi&quot;, &quot;Copo&quot;) là dịch vụ hỗ trợ tìm việc bằng AI, bao gồm
                ứng dụng web và tiện ích mở rộng trình duyệt Chrome. Chính sách này giải thích chúng tôi
                thu thập, sử dụng, chia sẻ và bảo vệ dữ liệu cá nhân của bạn như thế nào khi bạn sử dụng
                Copo.
            </p>

            <h2>1. Dữ liệu chúng tôi thu thập</h2>
            <p><strong>1.1 Thông tin tài khoản</strong>: Email và thông tin xác thực khi bạn đăng ký/đăng nhập.
                Chúng tôi không lưu trữ mật khẩu của bạn dưới dạng văn bản thuần.</p>
            <p><strong>1.2 Dữ liệu CV</strong>: Nội dung file CV bạn tải lên (PDF) và các trường thông tin được
                trích xuất từ đó: họ tên, thông tin liên hệ, học vấn, kinh nghiệm làm việc, kỹ năng.</p>
            <p><strong>1.3 Dữ liệu tin tuyển dụng</strong>: Link hoặc nội dung mô tả công việc (JD) bạn nhập vào
                hệ thống để phân tích và so khớp.</p>
            <p><strong>1.4 Dữ liệu sử dụng dịch vụ</strong>: Lịch sử các hành động bạn thực hiện (trích xuất CV,
                chấm điểm phù hợp, tối ưu CV, tự động điền đơn) và số credit đã sử dụng. Hiện tại Copo chưa
                tích hợp cổng thanh toán, nên chúng tôi không thu thập hoặc lưu trữ thông tin thẻ/tài khoản
                ngân hàng của bạn.</p>
            <p><strong>1.5 Dữ liệu theo dõi ứng tuyển</strong>: Trạng thái các đơn ứng tuyển bạn lưu lại trong
                hệ thống (đã tối ưu, đã điền, đã nộp, có phản hồi, phỏng vấn, trúng tuyển, bị từ chối), tên công
                ty, vị trí, điểm phù hợp.</p>
            <h3>1.6 Dữ liệu từ tiện ích mở rộng Chrome</h3>
            <p>Khi bạn chủ động kích hoạt agent tự động điền đơn trên một trang tuyển dụng, tiện ích sẽ đọc cấu
                trúc trang (tên trường nhập liệu, nút bấm, nội dung lỗi hiển thị) để xác định cách điền, chỉ
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
            <p>Chúng tôi không bán dữ liệu cá nhân của bạn. Dữ liệu chỉ được chia sẻ với một số bên xử lý kỹ thuật
                cần thiết để vận hành dịch vụ (ví dụ: xử lý AI, lưu trữ dữ liệu, hạ tầng máy chủ), với quyền truy
                cập giới hạn ở mức cần thiết và bị ràng buộc bởi các điều khoản bảo mật riêng của họ.</p>
            <p>Chúng tôi có thể tiết lộ dữ liệu nếu pháp luật yêu cầu, hoặc để bảo vệ quyền, tài sản, an toàn của
                Copo, người dùng, hoặc bên thứ ba.</p>

            <h2>4. Lưu trữ và bảo mật</h2>
            <p>Dữ liệu được truyền tải qua kết nối mã hoá (HTTPS) và xác thực bằng JWT. Quyền truy cập dữ liệu
                được giới hạn theo từng tài khoản người dùng ở tầng ứng dụng. Tuy nhiên, không có hệ thống nào an
                toàn tuyệt đối. Chúng tôi không thể đảm bảo an toàn tuyệt đối cho mọi thông tin truyền qua
                internet.</p>

            <h2>5. Thời gian lưu trữ và quyền xoá dữ liệu</h2>
            <p>Dữ liệu của bạn được lưu trữ trong thời gian tài khoản còn hoạt động. Bạn có thể yêu cầu xoá tài
                khoản và dữ liệu liên quan bất kỳ lúc nào bằng cách liên hệ{' '}
                <a href="mailto:charles@copoai.net">charles@copoai.net</a>. Một số dữ liệu ứng tuyển
                đã hoàn tất (ví dụ: kết quả phỏng vấn, trúng tuyển) có thể được ẩn danh hoá thay vì xoá hoàn toàn
                nhằm phục vụ thống kê tổng hợp, không định danh cá nhân.</p>

            <h2>6. Quyền của bạn</h2>
            <p>Theo quy định pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP), bạn có các
                quyền cơ bản: được biết về việc xử lý dữ liệu của mình; đồng ý hoặc rút lại đồng ý; truy cập dữ
                liệu; yêu cầu chỉnh sửa hoặc xoá dữ liệu; hạn chế xử lý; phản đối xử lý; và khiếu nại nếu quyền
                của bạn bị vi phạm. Để thực hiện các quyền này, vui lòng liên hệ{' '}
                <a href="mailto:charles@copoai.net">charles@copoai.net</a>.</p>

            <h2>7. Tiện ích mở rộng Chrome</h2>
            <p>Tiện ích Copo yêu cầu một số quyền truy cập trình duyệt (đọc/tương tác với nội dung trang,
                quản lý tab) để thực hiện chức năng tự động điền đơn ứng tuyển trên các trang tuyển dụng. Phạm vi
                quyền truy cập được giới hạn ở mức cần thiết cho chức năng này; tiện ích không theo dõi hoạt động
                duyệt web của bạn ngoài mục đích đã nêu, và không thu thập hay truyền dữ liệu mà không có hành
                động chủ động từ bạn.</p>
            <p>Để tiện ích thực hiện các thao tác AI có tính phí credit thay cho bạn (tự động điền đơn, tối ưu
                CV), mã phiên đăng nhập (JWT) của bạn được đồng bộ từ ứng dụng web và lưu trong bộ nhớ cục bộ của
                tiện ích (chrome.storage). Mã này chỉ dùng để xác thực với máy chủ Copo, không bao giờ được gửi
                tới các trang tuyển dụng bên thứ ba, và bị trình duyệt xoá khi bạn gỡ cài đặt tiện ích.</p>

            <h2>8. Cookie</h2>
            <p>Ứng dụng web sử dụng cookie/local storage cần thiết để duy trì phiên đăng nhập của bạn. Chúng tôi
                hiện không sử dụng cookie theo dõi quảng cáo của bên thứ ba.</p>

            <h2>9. Trẻ em</h2>
            <p>Copo không hướng đến và không cố ý thu thập dữ liệu từ người dùng dưới 18 tuổi. Nếu bạn cho
                rằng chúng tôi đã vô tình thu thập dữ liệu của người dưới 18 tuổi, vui lòng liên hệ để chúng tôi
                xử lý.</p>

            <h2>10. Thay đổi chính sách</h2>
            <p>Chúng tôi có thể cập nhật chính sách này theo thời gian. Phiên bản mới sẽ được đăng tại trang này
                kèm ngày cập nhật. Việc tiếp tục sử dụng dịch vụ sau khi chính sách thay đổi đồng nghĩa bạn chấp
                nhận các thay đổi đó.</p>

            <h2>11. Liên hệ</h2>
            <p>Nếu có câu hỏi về chính sách này hoặc về cách dữ liệu của bạn được xử lý, vui lòng liên hệ:{' '}
                <a href="mailto:charles@copoai.net">charles@copoai.net</a>.</p>
        </>
    );
}
