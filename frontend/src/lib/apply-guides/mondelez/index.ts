// Mondelēz Kinh Đô — hướng dẫn ứng tuyển intern. One file per stage of the
// funnel (chọn vị trí → CV → nộp → HR → phỏng vấn → sau phỏng vấn) so a stage
// can be edited without opening the others. Only loaded when a user actually
// opens the guide (see the registry in ../index.ts).
import type { ApplyGuide } from '../types';
import { chooseRole } from './choose-role';
import { writeCv } from './write-cv';
import { submit } from './submit';
import { hrScreening } from './hr-screening';
import { interview } from './interview';
import { afterInterview } from './after-interview';

export const mondelezGuide: ApplyGuide = {
    id: 'mondelez',
    company: 'Mondelēz Kinh Đô',
    title: 'Hướng dẫn ứng tuyển Intern tại Mondelēz Kinh Đô',
    intro: 'Từ chuẩn bị CV đến phỏng vấn. Bạn không cần biết mọi thứ — cần cho thấy bạn hiểu công việc, có nền tảng phù hợp và học nhanh.',
    sections: [chooseRole, writeCv, submit, hrScreening, interview, afterInterview],
};
