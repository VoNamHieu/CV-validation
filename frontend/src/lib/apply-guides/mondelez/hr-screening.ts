import type { GuideSection } from '../types';

/** Phần IV — vòng gọi điện / sàng lọc của HR. */
export const hrScreening: GuideSection = {
    id: 'hr-screening',
    title: 'HR screening',
    summary: 'Giới thiệu bản thân 60–90 giây và các câu hỏi HR hay hỏi.',
    blocks: [
        {
            kind: 'group',
            title: 'Chuẩn bị phần giới thiệu bản thân',
            blocks: [
                { kind: 'p', text: 'Phần giới thiệu nên kéo dài khoảng 60–90 giây, theo cấu trúc:' },
                {
                    kind: 'steps',
                    items: [
                        'Bạn là ai và đang học gì.',
                        'Trải nghiệm liên quan nhất.',
                        'Kỹ năng nổi bật.',
                        'Vì sao bạn chọn vị trí.',
                        'Thời gian bạn có thể làm việc.',
                    ],
                },
                {
                    kind: 'quote',
                    label: 'Ví dụ',
                    text: 'I am a final-year Supply Chain Management student. In my recent academic project, I analyzed historical sales and inventory data using Excel and Power BI to build a demand forecast. Through this project, I developed a strong interest in planning and FMCG operations. I am applying for this internship because I want to learn how demand decisions are made in a real business environment, and I am available for a six-month full-time internship.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Các câu hỏi HR thường gặp',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        'Tell me about yourself.',
                        'Why do you want to join Mondelēz?',
                        'Why are you interested in this position?',
                        'What do you know about our company?',
                        'What are your strengths and weaknesses?',
                        'When can you start?',
                        'Can you work full-time?',
                        'How long can you commit?',
                        'How would you rate your English?',
                        'What are your career goals?',
                    ],
                },
                { kind: 'note', tone: 'tip', text: 'Câu trả lời cần ngắn gọn, cụ thể và liên quan đến vị trí.' },
            ],
        },
    ],
};
