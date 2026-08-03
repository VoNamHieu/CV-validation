import type { GuideSection } from '../types';

/** Phần II — cấu trúc CV, cách viết bullet có kết quả, và lỗi thường gặp. */
export const writeCv: GuideSection = {
    id: 'viet-cv',
    title: 'Viết CV',
    summary: 'Cấu trúc một trang, bullet có kết quả, tailor theo JD.',
    blocks: [
        {
            kind: 'group',
            title: 'Cấu trúc CV đề xuất',
            blocks: [
                { kind: 'p', text: 'CV intern nên dài khoảng một trang và gồm:' },
                {
                    kind: 'group',
                    title: 'Thông tin cá nhân',
                    blocks: [
                        { kind: 'list', items: ['Họ và tên', 'Số điện thoại', 'Email', 'LinkedIn', 'Thành phố đang sinh sống'] },
                        {
                            kind: 'note',
                            tone: 'warn',
                            text: 'Không cần ghi địa chỉ nhà đầy đủ, số căn cước hoặc thông tin không liên quan.',
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Giới thiệu ngắn',
                    blocks: [
                        { kind: 'p', text: 'Viết từ hai đến ba dòng, nêu rõ:' },
                        {
                            kind: 'list',
                            items: [
                                'Bạn đang học ngành gì.',
                                'Bạn quan tâm đến vị trí nào.',
                                'Bạn có kỹ năng nổi bật nào.',
                                'Bạn có thể cam kết làm việc trong bao lâu.',
                            ],
                        },
                        {
                            kind: 'quote',
                            label: 'Ví dụ',
                            text: 'Final-year Business Administration student with experience in sales reporting, project coordination and data analysis using Excel. Interested in developing a career in FMCG Sales Operations and available for a six-month full-time internship.',
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Học vấn',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Tên trường',
                                'Chuyên ngành',
                                'Thời gian học',
                                'GPA nếu tốt',
                                'Môn học liên quan nếu chưa có nhiều kinh nghiệm',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Kinh nghiệm',
                    blocks: [
                        { kind: 'p', text: 'Có thể sử dụng:' },
                        {
                            kind: 'list',
                            items: [
                                'Internship',
                                'Part-time job',
                                'Câu lạc bộ',
                                'Dự án học tập',
                                'Case competition',
                                'Dự án cá nhân',
                                'Hoạt động tình nguyện',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Kỹ năng',
                    blocks: [
                        { kind: 'p', text: 'Có thể chia thành:' },
                        {
                            kind: 'list',
                            items: [
                                'Data: Excel, Power BI, SQL',
                                'Business: Reporting, Forecasting, Market Research',
                                'Communication: Presentation, Stakeholder Coordination',
                                'Languages: Vietnamese, English',
                            ],
                        },
                    ],
                },
            ],
        },
        {
            kind: 'group',
            title: 'Cách viết bullet trong CV',
            blocks: [
                { kind: 'p', text: 'Không chỉ liệt kê nhiệm vụ. Hãy mô tả bạn đã làm gì và đạt được kết quả gì.' },
                { kind: 'note', tone: 'tip', text: 'Công thức: Hành động + Phạm vi công việc + Công cụ + Kết quả.' },
                {
                    kind: 'compare',
                    bad: 'Supported sales reports.',
                    good: 'Consolidated weekly sales data from five product groups using Excel and identified reporting discrepancies before submission.',
                },
                {
                    kind: 'compare',
                    bad: 'Organized a student event.',
                    good: 'Coordinated a six-member team and three external vendors to organize a career event for more than 250 students.',
                },
                {
                    kind: 'compare',
                    bad: 'Analyzed customer data.',
                    good: 'Cleaned and analyzed 8,000 customer records in Excel, identifying the three segments contributing the highest order volume.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Điều chỉnh CV theo từng vị trí',
            blocks: [
                { kind: 'p', text: 'Trước khi gửi CV, hãy so sánh với JD. Nếu JD nhắc nhiều đến:' },
                {
                    kind: 'list',
                    items: [
                        'Reporting: CV cần có ví dụ làm báo cáo.',
                        'Excel: CV cần cho thấy bạn từng dùng Excel để làm gì.',
                        'Stakeholder management: CV cần có ví dụ phối hợp nhiều bên.',
                        'Power BI: nên có project hoặc dashboard minh chứng.',
                        'Forecasting: nên có bài tập hoặc dự án liên quan đến dữ liệu lịch sử.',
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: 'Không nên chỉ thêm keyword vào Skills mà không có bằng chứng trong Experience hoặc Projects.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Các lỗi CV phổ biến',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        'Dùng một CV chung cho mọi vị trí.',
                        'Viết quá nhiều đoạn văn.',
                        'Không có kết quả hoặc số liệu.',
                        'Liệt kê kỹ năng nhưng không có ví dụ.',
                        'CV có quá nhiều màu sắc hoặc icon.',
                        'Dùng thanh phần trăm để chấm kỹ năng.',
                        'Sai chính tả.',
                        'Ngày tháng không nhất quán.',
                        'Tên file không chuyên nghiệp.',
                        'Chuyển toàn bộ CV thành ảnh khiến hệ thống khó đọc.',
                    ],
                },
                { kind: 'note', tone: 'tip', text: 'Tên file đề xuất: NguyenVanA_Mondelez_SalesOperationsIntern_CV.pdf' },
            ],
        },
    ],
};
