import type { GuideSection } from '../types';

/** Phần V — vòng với hiring manager: STAR, câu hỏi chuyên môn, Excel test. */
export const interview: GuideSection = {
    id: 'phong-van',
    title: 'Phỏng vấn với Hiring Manager',
    summary: 'STAR, câu hỏi theo nhóm vị trí, Excel test và case study.',
    blocks: [
        {
            kind: 'group',
            title: 'Chuẩn bị câu chuyện theo STAR',
            blocks: [
                { kind: 'p', text: 'STAR gồm:' },
                {
                    kind: 'list',
                    items: [
                        'Situation: bối cảnh',
                        'Task: nhiệm vụ',
                        'Action: bạn đã làm gì',
                        'Result: kết quả',
                    ],
                },
                { kind: 'p', text: 'Nên chuẩn bị trước các câu chuyện về:' },
                {
                    kind: 'list',
                    items: [
                        'Một lần sử dụng dữ liệu để giải quyết vấn đề.',
                        'Một lần làm việc nhóm.',
                        'Một lần có bất đồng.',
                        'Một lần làm việc dưới áp lực.',
                        'Một lần mắc lỗi.',
                        'Một lần chủ động cải thiện công việc.',
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: 'Khi trả lời, phải nói rõ phần việc của cá nhân bạn, không chỉ nói “team của em đã làm”.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Câu hỏi theo nhóm vị trí',
            blocks: [
                {
                    kind: 'group',
                    title: 'Sales Operations',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Bạn từng làm báo cáo chưa?',
                                'Bạn kiểm tra số liệu bằng cách nào?',
                                'Nếu hai nguồn dữ liệu không khớp, bạn sẽ làm gì?',
                                'Bạn xử lý nhiều yêu cầu cùng lúc như thế nào?',
                                'Bạn từng phối hợp với nhiều bên chưa?',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Demand Planning',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Bạn hiểu demand forecast là gì?',
                                'Sales target và forecast khác nhau thế nào?',
                                'Bạn xử lý dữ liệu bất thường ra sao?',
                                'Promotion ảnh hưởng nhu cầu như thế nào?',
                                'Bạn từng dùng Excel hoặc Power BI trong project nào?',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Marketing và E-commerce',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Bạn đánh giá một campaign bằng chỉ số nào?',
                                'Traffic tăng nhưng doanh thu giảm có thể do đâu?',
                                'Bạn hiểu gì về consumer insight?',
                                'Bạn từng vận hành sàn thương mại điện tử chưa?',
                                'Bạn sẽ đề xuất gì nếu một sản phẩm bán chậm?',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Human Resources',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Bạn từng tổ chức recruitment hoặc event chưa?',
                                'Bạn quản lý nhiều ứng viên như thế nào?',
                                'Bạn xử lý một stakeholder khó hợp tác ra sao?',
                                'Bạn ưu tiên công việc khi có nhiều deadline như thế nào?',
                            ],
                        },
                    ],
                },
            ],
        },
        {
            kind: 'group',
            title: 'Chuẩn bị Excel test hoặc case study',
            blocks: [
                { kind: 'p', text: 'Một số vị trí có thể có bài test. Nên luyện:' },
                {
                    kind: 'list',
                    items: [
                        'Làm sạch dữ liệu.',
                        'PivotTable.',
                        'XLOOKUP hoặc INDEX-MATCH.',
                        'SUMIFS.',
                        'IF.',
                        'Tính phần trăm tăng trưởng.',
                        'So sánh actual với target.',
                        'Tạo biểu đồ.',
                        'Viết insight.',
                        'Đề xuất hành động.',
                    ],
                },
                {
                    kind: 'note',
                    tone: 'tip',
                    text: 'Đừng chỉ mô tả số liệu. Hãy giải thích nguyên nhân có thể xảy ra và bước kiểm tra tiếp theo.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Câu hỏi nên hỏi interviewer',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        'What would be the key responsibilities for this intern?',
                        'What would success look like during the first three months?',
                        'Which teams will the intern work with?',
                        'What tools does the team use?',
                        'What are the current challenges of the team?',
                        'How will the intern’s performance be evaluated?',
                    ],
                },
                { kind: 'note', tone: 'tip', text: 'Việc đặt câu hỏi cho thấy bạn thực sự quan tâm đến công việc.' },
            ],
        },
    ],
};
