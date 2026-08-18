// Landing copy/data, kept out of the section components so the markup stays
// about layout and the words stay easy to edit in one place.
import type { ReactNode } from 'react';

export type Company = { name: string; domain: string };
export type Truth = { n: string; s: string; text: ReactNode };
export type Belief = { claim: string; proof: ReactNode; tags: string[] };
export type Job = { logo: string; co: string; meta: string; title: string; type: string; fresh: string };
export type CreditRow = { label: ReactNode; cost: string };
export type Faq = { q: string; a: ReactNode };

// Recognizable employers from the featured pool → social-proof strip. Domains
// feed a logo CDN; a failed load falls back to the wordmark (see CompanyStrip).
export const COMPANIES: Company[] = [
    { name: 'Shopee', domain: 'shopee.vn' },
    { name: 'VNG', domain: 'vng.com.vn' },
    { name: 'MoMo', domain: 'momo.vn' },
    { name: 'Grab', domain: 'grab.com' },
    { name: 'TikTok', domain: 'tiktok.com' },
    { name: 'FPT Software', domain: 'fpt-software.com' },
    { name: 'Techcombank', domain: 'techcombank.com.vn' },
    { name: 'VPBank', domain: 'vpbank.com.vn' },
    { name: 'Vinamilk', domain: 'vinamilk.com.vn' },
    // domain MUST equal companies.domain in the store (www-stripped) so the
    // uploaded logo resolves via /companies/logo-by-domain — global .com
    // domains miss the VN-registered rows and fall back to a wordmark.
    { name: 'Bosch', domain: 'bosch.com.vn' },
    { name: 'Heineken', domain: 'heinekenvietnam.com' },
    { name: 'Maersk', domain: 'maersk.com' },
    { name: 'Visa', domain: 'visa.com.vn' },
];

export const TRUTHS: Truth[] = [
    { n: '40', s: '', text: <>CV gửi đi. Hai phản hồi. <em>Không một lời giải thích.</em></> },
    { n: '75', s: '%', text: <>hồ sơ bị máy lọc trước khi một con người kịp đọc — và bạn không bao giờ biết vì sao.</> },
    { n: '0', s: 'đ', text: <>là giá trị job board đặt vào thời gian của bạn. Bạn không phải khách hàng của họ. <em>Bạn là hàng.</em></> },
];

export const BELIEFS: Belief[] = [
    {
        claim: 'Bạn xứng đáng biết mình đứng ở đâu.',
        proof: <><b>Điểm khớp và báo cáo khoảng cách</b> cho từng vị trí: khớp bao nhiêu phần trăm, mạnh chỗ nào, thiếu kỹ năng gì — với lý do cụ thể, không phải một con số câm.</>,
        tags: ['match score', 'gap report'],
    },
    {
        claim: 'Sự thật thắng sự đánh bóng.',
        proof: <><b>Tối ưu CV có dẫn chứng.</b> Mỗi câu viết lại đều truy được về một dữ kiện trong CV gốc của bạn. Không thêm kỹ năng ảo, không phóng đại con số.</>,
        tags: ['no-hallucination', 'before / after'],
    },
    {
        claim: 'Nguồn thật, không tin rác.',
        proof: <><b>Hơn 200 công ty trong mạng lưới,</b> quét trực tiếp từ trang tuyển dụng chính thức và làm mới mỗi 24 giờ. Không tin trung gian, không vị trí ma.</>,
        tags: ['official sources', 'refresh 24h'],
    },
    {
        claim: 'Thời gian của bạn dành cho phỏng vấn, không phải điền form.',
        proof: <><b>Extension tự động điền đơn ứng tuyển</b> — AI quan sát form, lên kế hoạch và điền từng bước từ hồ sơ của bạn. Còn <b>luyện phỏng vấn theo đúng JD</b> để bạn bước vào phòng với lợi thế.</>,
        tags: ['auto-fill agent', 'interview prep'],
    },
];

export const JOBS: Job[] = [
    { logo: 'OM', co: 'One Mount', meta: 'Công nghệ · Hà Nội', title: 'Senior Frontend Engineer', type: 'Toàn thời gian', fresh: 'cập nhật 3h trước' },
    { logo: 'MM', co: 'MoMo', meta: 'Fintech · TP.HCM', title: 'Product Designer (UI/UX)', type: 'Toàn thời gian', fresh: 'cập nhật 7h trước' },
    { logo: 'FS', co: 'FPT Software', meta: 'Công nghệ · Đà Nẵng', title: 'Solution Architect', type: 'Hybrid', fresh: 'cập nhật 12h trước' },
];

export const CREDITS: CreditRow[] = [
    { label: <><b>Chấm điểm độ khớp</b> — một vị trí, kèm báo cáo khoảng cách</>, cost: '2 credit' },
    { label: <><b>Tối ưu CV theo job</b> — viết lại có dẫn chứng, xuất PDF</>, cost: '5 credit' },
    { label: <><b>Luyện phỏng vấn</b> — bộ câu hỏi theo JD, chấm câu trả lời</>, cost: '5 credit' },
    { label: <><b>Tải CV và xem việc khớp</b></>, cost: 'miễn phí' },
];

export const FAQS: Faq[] = [
    {
        q: 'CV của tôi được lưu ở đâu và ai đọc được?',
        a: <>CV của bạn được mã hoá và chỉ dùng để phân tích cho chính bạn. <b>Chúng tôi không bán, không chia sẻ hồ sơ cho nhà tuyển dụng hay bên thứ ba.</b> Bạn có thể xoá tài khoản cùng toàn bộ dữ liệu bất cứ lúc nào — xoá là xoá thật.</>,
    },
    {
        q: '"Không bịa nội dung" hoạt động thế nào?',
        a: <>AI chỉ được phép viết lại dựa trên dữ kiện đã có trong CV gốc của bạn. Mỗi thay đổi đều truy vết được về nguồn. Nếu bạn thiếu một kỹ năng mà vị trí yêu cầu, chúng tôi nói thẳng trong báo cáo khoảng cách — <b>thay vì bịa ra để bạn thất bại ở vòng phỏng vấn.</b></>,
    },
    {
        q: 'Việc trên Copo lấy từ đâu?',
        a: <>Trực tiếp từ trang tuyển dụng chính thức của các công ty trong mạng lưới, được hệ thống quét và làm mới mỗi 24 giờ. Không lấy lại từ job board, không tin đăng trung gian, không vị trí đã đóng.</>,
    },
    {
        q: 'Hết 50 credit miễn phí thì sao?',
        a: <>Bạn vẫn xem được việc khớp với CV của mình — phần đó miễn phí vĩnh viễn. Chỉ các thao tác AI chuyên sâu (chấm điểm chi tiết, tối ưu CV, luyện phỏng vấn) mới dùng credit, và bạn nạp thêm khi cần. <b>Không gói tháng bắt buộc, không tự động trừ tiền.</b></>,
    },
];
