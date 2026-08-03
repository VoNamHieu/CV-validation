import type { GuideSection } from '../types';

/** Phần III — thời điểm apply và cách điền form application cho khớp CV. */
export const submit: GuideSection = {
    id: 'nop-ho-so',
    title: 'Nộp hồ sơ',
    summary: 'Apply sớm, form khớp CV, lưu lại JD.',
    blocks: [
        {
            kind: 'group',
            title: 'Apply sớm nhưng không apply vội',
            blocks: [
                { kind: 'p', text: 'Các vị trí intern tại công ty lớn có thể nhận nhiều hồ sơ trong thời gian ngắn. Bạn nên:' },
                {
                    kind: 'steps',
                    items: [
                        'Đọc JD ngay khi vị trí được đăng.',
                        'Điều chỉnh CV trong ngày.',
                        'Kiểm tra lại lỗi.',
                        'Apply qua kênh chính thức.',
                        'Lưu lại JD để chuẩn bị phỏng vấn.',
                    ],
                },
                { kind: 'note', tone: 'warn', text: 'Không nên đợi đến ngày cuối mới apply.' },
            ],
        },
        {
            kind: 'group',
            title: 'Hoàn thành form application',
            blocks: [
                { kind: 'p', text: 'Thông tin trên form phải nhất quán với CV:' },
                {
                    kind: 'list',
                    items: [
                        'Tên công ty',
                        'Chức danh',
                        'Thời gian làm việc',
                        'Trường học',
                        'Ngày tốt nghiệp',
                        'Trình độ tiếng Anh',
                        'Availability',
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: 'Không nên copy cả đoạn dài từ CV vào từng ô nếu hệ thống chỉ yêu cầu nội dung ngắn.',
                },
            ],
        },
    ],
};
