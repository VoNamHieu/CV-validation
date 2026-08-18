import { describe, it, expect } from 'vitest';
import { detectJdLang } from '@/lib/jd-lang';
import { recipeWantsApplyMessage, recipeForUrl } from '@/lib/applyRecipes';
import { cvToExtensionProfile } from '@/lib/extension-profile';
import type { CVData } from '@/lib/types';

// Which language the auto-filled message is written in. There is no picker for
// it (nobody watches it get written), so it follows the posting — and a wrong
// answer sends a Vietnamese note to an English-only hiring team, or the reverse.
describe('detectJdLang', () => {
    it('reads a Vietnamese posting as Vietnamese', () => {
        expect(detectJdLang({
            title: 'Chuyên viên Phát triển Sản phẩm',
            responsibilities: ['Xây dựng lộ trình sản phẩm', 'Làm việc với đội kỹ thuật'],
        })).toBe('vi');
    });

    it('reads an English posting as English', () => {
        expect(detectJdLang({
            title: 'Embedded Android Developer',
            responsibilities: ['Develop and maintain Android BSP', 'Work with the platform team'],
        })).toBe('en');
    });

    // The case a keyword rule gets wrong. Vietnamese ads are saturated with
    // English job jargon, and matching on words like "developer"/"team" would
    // flip exactly the postings that most need a Vietnamese reply.
    it('stays Vietnamese when the ad is packed with English jargon', () => {
        expect(detectJdLang({
            title: 'Senior Product Owner (Fintech)',
            responsibilities: [
                'Quản lý backlog và roadmap cho các sản phẩm digital banking',
                'Phối hợp với stakeholder để định nghĩa OKR theo từng quý',
            ],
        })).toBe('vi');
    });

    it('does not flip to Vietnamese on a diacritic-free Vietnamese company name', () => {
        expect(detectJdLang({
            title: 'Data Analyst', company: 'Techcombank',
            responsibilities: ['Build dashboards and reports for the risk team'],
        })).toBe('en');
    });

    it('falls back to Vietnamese on an empty JD rather than throwing', () => {
        expect(detectJdLang(null)).toBe('vi');
        expect(detectJdLang({})).toBe('vi');
    });
});

// Generation costs a credit, so it must not run for forms with no message box.
describe('recipeWantsApplyMessage', () => {
    it('is true for SmartRecruiters, whose form has the box', () => {
        const url = 'https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/abc';
        expect(recipeForUrl(url)?.ats).toBe('smartrecruiters');
        expect(recipeWantsApplyMessage(url)).toBe(true);
    });

    it('is false for Workday, whose recipe has no such field', () => {
        expect(recipeWantsApplyMessage('https://mdlz.wd3.myworkdayjobs.com/en-US/External/job/x')).toBe(false);
    });

    // No recipe means the generic agent path, where the extension decides at
    // fill time — it can see the form and we cannot, so guessing here would
    // spend a credit on a page that may have nothing to fill.
    it('is false for an unrecognised host', () => {
        expect(recipeWantsApplyMessage('https://careers.example.com/jobs/1')).toBe(false);
        expect(recipeWantsApplyMessage(undefined)).toBe(false);
    });
});

describe('the message that reaches the extension profile', () => {
    const cv = {
        name: 'Nguyen Van A',
        summary: 'Product Owner with 4 years in B2B SaaS.',
        skills: ['Product Management'],
    } as unknown as CVData;

    it('prefers the generated message over the letter', () => {
        const p = cvToExtensionProfile(cv, 'THE LETTER', 'THE MESSAGE');
        expect(p.applyMessage).toBe('THE MESSAGE');
        expect(p.coverLetter).toBe('THE LETTER');
    });

    it('falls back to a letter the user actually wrote', () => {
        expect(cvToExtensionProfile(cv, 'THE LETTER').applyMessage).toBe('THE LETTER');
    });

    // The bug this whole path exists to fix: the message box used to read
    // `coverLetter`, which falls back to the CV summary — so an application
    // whose owner never generated a letter sent a third-person paragraph about
    // themselves to a box asking what they wanted to say.
    it('never falls back to the CV summary — an empty optional box is better', () => {
        const p = cvToExtensionProfile(cv);
        expect(p.coverLetter).toBe('Product Owner with 4 years in B2B SaaS.');
        expect(p.applyMessage).toBe('');
    });

    it('treats whitespace-only overrides as absent', () => {
        expect(cvToExtensionProfile(cv, '   ', '  \n ').applyMessage).toBe('');
    });
});
