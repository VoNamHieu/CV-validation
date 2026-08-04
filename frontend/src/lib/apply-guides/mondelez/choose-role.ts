import type { GuideSection } from '../types';

/** Phần I — hiểu bức tranh chung rồi khoanh vùng vị trí trước khi viết CV. */
export const chooseRole: GuideSection = {
    id: 'chon-vi-tri',
    title: 'Chọn vị trí phù hợp',
    summary: 'Đọc JD, hiểu tiêu chí, khoanh vùng tối đa hai nhóm vị trí.',
    blocks: [
        { kind: 'p', text: 'Mondelēz Kinh Đô thường tuyển thực tập sinh cho nhiều phòng ban khác nhau:' },
        {
            kind: 'list',
            items: [
                'Sales và Sales Operations',
                'Customer/Category Planning & Activation',
                'Marketing và Trade Marketing',
                'E-commerce',
                'Demand Planning',
                'Supply Chain',
                'Finance',
                'Human Resources',
                'Procurement',
            ],
        },
        { kind: 'p', text: 'Mỗi vị trí có yêu cầu khác nhau, nhưng phần lớn đều đánh giá ứng viên dựa trên bốn yếu tố:' },
        {
            kind: 'steps',
            items: [
                'Có nền tảng phù hợp với công việc.',
                'Có khả năng làm việc với dữ liệu và công cụ văn phòng.',
                'Giao tiếp và phối hợp tốt với người khác.',
                'Chủ động, cẩn thận và có tinh thần trách nhiệm.',
            ],
        },
        {
            kind: 'note',
            tone: 'tip',
            text: 'Bạn không nhất thiết phải có kinh nghiệm tại một công ty FMCG. Kinh nghiệm từ trường học, câu lạc bộ, công việc part-time và dự án cá nhân vẫn có giá trị nếu được trình bày đúng cách.',
        },
        {
            kind: 'group',
            title: 'Đọc kỹ mô tả công việc',
            blocks: [
                { kind: 'p', text: 'Trước khi apply, hãy xác định ba nội dung:' },
                {
                    kind: 'group',
                    title: 'Công việc chính',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Làm báo cáo và kiểm tra dữ liệu.',
                                'Theo dõi hiệu quả bán hàng.',
                                'Hỗ trợ campaign.',
                                'Phân tích nhu cầu thị trường.',
                                'Phối hợp với Sales, Marketing hoặc Supply Chain.',
                                'Làm việc với nhà cung cấp hoặc đối tác.',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Công cụ cần sử dụng',
                    blocks: [
                        {
                            kind: 'list',
                            items: [
                                'Microsoft Excel',
                                'PowerPoint',
                                'Power BI',
                                'SQL',
                                'Power Query',
                                'Các hệ thống nội bộ hoặc ERP',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Yêu cầu về thời gian',
                    blocks: [
                        { kind: 'p', text: 'Một số vị trí có thể yêu cầu:' },
                        {
                            kind: 'list',
                            items: [
                                'Làm full-time.',
                                'Cam kết từ ba đến sáu tháng.',
                                'Có mặt tại văn phòng một số ngày cố định.',
                                'Có thể bắt đầu trong thời gian ngắn.',
                            ],
                        },
                        {
                            kind: 'note',
                            tone: 'warn',
                            text: 'Chỉ nên apply khi bạn thực sự đáp ứng được phần lớn yêu cầu về thời gian.',
                        },
                    ],
                },
            ],
        },
        {
            kind: 'group',
            title: 'Chọn tối đa hai nhóm vị trí',
            blocks: [
                { kind: 'p', text: 'Không nên gửi cùng một CV cho quá nhiều phòng ban khác nhau. Bạn có thể chia thành các nhóm:' },
                {
                    kind: 'group',
                    title: 'Sales Operations hoặc Trade Marketing',
                    blocks: [
                        { kind: 'p', text: 'Phù hợp nếu bạn:' },
                        {
                            kind: 'list',
                            items: [
                                'Thích làm việc với dữ liệu bán hàng.',
                                'Có khả năng theo dõi và tổng hợp báo cáo.',
                                'Giao tiếp tốt với nhiều bên.',
                                'Quan tâm đến thị trường bán lẻ, cửa hàng và hành vi người mua.',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Demand Planning hoặc Supply Chain',
                    blocks: [
                        { kind: 'p', text: 'Phù hợp nếu bạn:' },
                        {
                            kind: 'list',
                            items: [
                                'Có tư duy số liệu.',
                                'Học Supply Chain, Logistics, Business Analytics hoặc ngành liên quan.',
                                'Thích forecasting, inventory và planning.',
                                'Có Excel, Power BI hoặc SQL.',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Marketing hoặc E-commerce',
                    blocks: [
                        { kind: 'p', text: 'Phù hợp nếu bạn:' },
                        {
                            kind: 'list',
                            items: [
                                'Quan tâm đến thương hiệu và người tiêu dùng.',
                                'Có kinh nghiệm làm nội dung, campaign hoặc vận hành sàn.',
                                'Biết theo dõi các chỉ số như doanh thu, traffic và conversion.',
                                'Có khả năng làm presentation tốt.',
                            ],
                        },
                    ],
                },
                {
                    kind: 'group',
                    title: 'Human Resources',
                    blocks: [
                        { kind: 'p', text: 'Phù hợp nếu bạn:' },
                        {
                            kind: 'list',
                            items: [
                                'Có khả năng giao tiếp.',
                                'Từng làm recruitment, event hoặc quản lý dữ liệu.',
                                'Thích làm việc với con người.',
                                'Có kỹ năng tổ chức và follow-up.',
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
