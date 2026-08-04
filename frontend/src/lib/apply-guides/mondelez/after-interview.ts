import type { GuideSection } from '../types';

/** Phần VI — thank-you email, follow-up, và checklist chốt trước khi apply. */
export const afterInterview: GuideSection = {
    id: 'sau-phong-van',
    title: 'Sau phỏng vấn & checklist',
    summary: 'Thank-you email, follow-up, và checklist chốt trước khi apply.',
    blocks: [
        {
            kind: 'group',
            title: 'Gửi lời cảm ơn',
            blocks: [
                { kind: 'p', text: 'Có thể gửi email cảm ơn trong vòng 24 giờ. Nội dung nên gồm:' },
                {
                    kind: 'list',
                    items: [
                        'Cảm ơn interviewer.',
                        'Nhắc đến một nội dung thú vị trong cuộc trao đổi.',
                        'Khẳng định lại sự quan tâm.',
                        'Nêu ngắn gọn giá trị bạn có thể đóng góp.',
                    ],
                },
                {
                    kind: 'p',
                    text: 'Nếu chưa nhận được phản hồi, có thể follow up sau khoảng năm đến bảy ngày làm việc, trừ khi recruiter đã đưa ra timeline khác.',
                },
            ],
        },
        {
            kind: 'group',
            title: 'Checklist cuối cùng',
            blocks: [
                { kind: 'p', text: 'Trước khi apply:' },
                {
                    kind: 'checklist',
                    items: [
                        'Đã đọc kỹ JD.',
                        'Đã chọn đúng track.',
                        'CV đã tailor.',
                        'Có ít nhất ba bullet có kết quả cụ thể.',
                        'Skills có bằng chứng.',
                        'Availability rõ ràng.',
                        'LinkedIn và CV nhất quán.',
                        'Đã lưu JD.',
                        'Đã tìm hiểu công ty và thương hiệu.',
                        'Đã chuẩn bị giới thiệu bản thân.',
                        'Đã chuẩn bị sáu câu chuyện STAR.',
                        'Đã luyện câu hỏi chuyên môn cơ bản.',
                        'Đã chuẩn bị câu hỏi cho interviewer.',
                    ],
                },
            ],
        },
        {
            kind: 'note',
            tone: 'tip',
            text: 'Một ứng viên intern tốt không cần biết tất cả mọi thứ. Tuy nhiên, ứng viên cần chứng minh rằng mình hiểu công việc, có nền tảng phù hợp, học nhanh và có thể được tin tưởng giao việc.',
        },
    ],
};
