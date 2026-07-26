import type { CVData } from '@/lib/types';

// Section + contact labels for the CV templates, in the CV's own content language.
// WHY this exists: an English-content CV rendered with Vietnamese section headers
// ("Học vấn", "Chứng chỉ") is (a) inconsistent to a human reader and (b) UNPARSEABLE
// by ATS résumé parsers (SmartRecruiters, Workday…), which are tuned for standard
// English/localized headers. A parser that can't find "EDUCATION" drops the school;
// and because our certs render with the same year|title|subtitle shape as education,
// an unrecognized "Chứng chỉ" header lets the certs bleed into Education. Matching the
// header language to the content language fixes both.
export interface CvLabels {
    summary: string;
    education: string;
    skills: string;
    experience: string;
    projects: string;
    certifications: string;
    awards: string;
    activities: string;
    languages: string;
    contact: string;
    // contact-line labels
    dob: string;
    gender: string;
    phone: string;
    email: string;
    linkedin: string;
    address: string;
    // date helpers
    present: string;
    year: string;
    month: string;
}

export const VI_LABELS: CvLabels = {
    summary: 'Mục tiêu nghề nghiệp',
    education: 'Học vấn',
    skills: 'Kỹ năng',
    experience: 'Kinh nghiệm làm việc',
    projects: 'Dự án',
    certifications: 'Chứng chỉ',
    awards: 'Giải thưởng',
    activities: 'Hoạt động',
    languages: 'Ngoại ngữ',
    contact: 'Liên hệ',
    dob: 'Ngày sinh',
    gender: 'Giới tính',
    phone: 'Số điện thoại',
    email: 'Email',
    linkedin: 'LinkedIn',
    address: 'Địa chỉ',
    present: 'Hiện tại',
    year: 'năm',
    month: 'tháng',
};

export const EN_LABELS: CvLabels = {
    summary: 'Summary',
    education: 'Education',
    skills: 'Skills',
    experience: 'Work Experience',
    projects: 'Projects',
    certifications: 'Certifications',
    awards: 'Awards',
    activities: 'Activities',
    languages: 'Languages',
    contact: 'Contact',
    dob: 'Date of Birth',
    gender: 'Gender',
    phone: 'Phone',
    email: 'Email',
    linkedin: 'LinkedIn',
    address: 'Address',
    present: 'Present',
    year: 'yr',
    month: 'mo',
};

/**
 * Detect the CV's content language from its free-text fields. Vietnamese text
 * carries diacritics (combining marks + đ) essentially absent from English, so
 * even a low ratio is a reliable "vi" signal; otherwise "en". Defaults to "vi"
 * when there's no free text (the app is Vietnam-facing).
 */
export function detectCvLang(cv: CVData): 'en' | 'vi' {
    const text = [
        cv.summary ?? '',
        ...(cv.experience ?? []).map((e) => e?.description ?? ''),
        ...(cv.education ?? []).map((e) => e?.degree ?? ''),
    ].join(' ');
    if (!text.trim()) return 'vi';
    const viMarks = (text.normalize('NFD').match(/[̀-ͯ]|đ/gi) || []).length;
    const letters = (text.match(/\p{L}/gu) || []).length || 1;
    return viMarks / letters > 0.02 ? 'vi' : 'en';
}

/** Labels for a CV: an explicit `lang` override, else auto-detected from content. */
export function getCvLabels(cv: CVData, lang?: 'en' | 'vi'): CvLabels {
    return (lang ?? detectCvLang(cv)) === 'en' ? EN_LABELS : VI_LABELS;
}
