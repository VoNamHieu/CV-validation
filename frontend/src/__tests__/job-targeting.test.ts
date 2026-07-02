import { describe, it, expect } from 'vitest';
import {
    titleMatchScore, requiredYearsFromJd, experienceGapExceeds, buildSearchUrl,
} from '@/lib/job-targeting';

describe('titleMatchScore — Vietnamese-aware', () => {
    it('matches accented Vietnamese titles (was 0 before accent-folding)', () => {
        expect(
            titleMatchScore('Chuyên viên xuất nhập khẩu', 'Chuyên Viên Xuất Nhập Khẩu (Hà Nội)'),
        ).toBeGreaterThan(0);
    });

    it('domain tokens outweigh a shared rank word', () => {
        const domain = titleMatchScore('Kỹ sư phần mềm', 'Kỹ sư phần mềm Java');
        const rankOnly = titleMatchScore('Kỹ sư phần mềm', 'Kỹ sư cầu đường');
        expect(domain).toBeGreaterThan(rankOnly);
        expect(rankOnly).toBe(0);
    });

    it('still matches plain English titles', () => {
        expect(titleMatchScore('Frontend Engineer', 'Senior Frontend Engineer')).toBeGreaterThan(
            titleMatchScore('Frontend Engineer', 'Backend Engineer'),
        );
    });
});

describe('requiredYearsFromJd — backend-parity guards', () => {
    it('does not read "tuyển 05 nam" (gender) as a years requirement', () => {
        expect(requiredYearsFromJd({ seniority_expected: 'tuyển 05 nam' })).toBeNull();
    });

    it('reads unaccented "nam kinh nghiem"', () => {
        expect(requiredYearsFromJd({ seniority_expected: '3 nam kinh nghiem' })).toBe(3);
    });

    it('takes the LOWER bound of a range (was returning the upper)', () => {
        expect(requiredYearsFromJd({ seniority_expected: '3-5 năm' })).toBe(3);
        expect(requiredYearsFromJd({ seniority_expected: '3-5 years' })).toBe(3);
    });

    it('prefers the extractor field when present', () => {
        expect(requiredYearsFromJd({ required_years_min: 2, seniority_expected: 'Senior' })).toBe(2);
    });

    it('gender line does not trip the gap filter', () => {
        const { exceeds } = experienceGapExceeds({ seniority_expected: 'tuyển 05 nam' }, 0);
        expect(exceeds).toBe(false);
    });
});

describe('buildSearchUrl — slug accents', () => {
    it('hyphenate folds accents for careerbuilder slugs', () => {
        const { search_url } = buildSearchUrl('https://careerbuilder.vn', 'Kỹ sư phần mềm');
        expect(search_url).toContain('ky-su-phan-mem');
    });
});
