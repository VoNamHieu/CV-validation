import { describe, it, expect } from 'vitest';
import { applyCvFieldEdit } from '@/lib/cv-inline-edit';
import type { CVData } from '@/lib/types';
import {
    EMPTY_CONTACT, EMPTY_PERSONAL, EMPTY_EMPLOYMENT, EMPTY_PREFERENCES,
} from '@/lib/types';

function makeCv(): CVData {
    return {
        name: 'Nguyen Van A',
        summary: 'Old summary',
        skills: ['Go', 'Postgres'],
        experience: [{
            title: 'Dev', company: 'ACME', duration_months: 24,
            start_date: '01/2022', end_date: 'Hiện tại',
            description: 'bullet 1\nbullet 2',
        }],
        education: [{ degree: 'BSc', institution: 'HUST', year: '2020' }],
        projects: [{ name: 'Proj', description: 'line' }],
        languages: [{ language: 'English', level: 'IELTS 7.0' }],
        certifications: [{ name: 'AWS', issuer: 'Amazon', year: '2023' }],
        contact: { ...EMPTY_CONTACT, email: 'a@b.c' },
        personal: { ...EMPTY_PERSONAL },
        employment: { ...EMPTY_EMPLOYMENT, current_title: 'Dev' },
        preferences: { ...EMPTY_PREFERENCES },
    };
}

describe('applyCvFieldEdit', () => {
    it('edits simple top-level and nested fields', () => {
        const cv = makeCv();
        expect(applyCvFieldEdit(cv, 'name', '  Tran B  ').name).toBe('Tran B');
        expect(applyCvFieldEdit(cv, 'contact.email', 'x@y.z').contact.email).toBe('x@y.z');
        expect(applyCvFieldEdit(cv, 'employment.current_title', 'Senior Dev')
            .employment.current_title).toBe('Senior Dev');
        // original untouched (immutability)
        expect(cv.name).toBe('Nguyen Van A');
    });

    it('edits array entry fields', () => {
        const cv = makeCv();
        expect(applyCvFieldEdit(cv, 'experience.0.title', 'Lead').experience[0].title).toBe('Lead');
        expect(applyCvFieldEdit(cv, 'education.0.year', '2021').education[0].year).toBe('2021');
        expect(applyCvFieldEdit(cv, 'certifications.0.issuer', 'AWS Inc')
            .certifications![0].issuer).toBe('AWS Inc');
    });

    it('normalizes multiline description bullets', () => {
        const cv = makeCv();
        const next = applyCvFieldEdit(cv, 'experience.0.description', '• new b1\n\n- new b2\n  new b3 ');
        expect(next.experience[0].description).toBe('new b1\nnew b2\nnew b3');
    });

    it('parses the daterange composite into start/end', () => {
        const cv = makeCv();
        const next = applyCvFieldEdit(cv, 'experience.0.daterange', '03/2021 – 05/2023');
        expect(next.experience[0].start_date).toBe('03/2021');
        expect(next.experience[0].end_date).toBe('05/2023');
        const hyphen = applyCvFieldEdit(cv, 'experience.0.daterange', '03/2021 - Hiện tại');
        expect(hyphen.experience[0].start_date).toBe('03/2021');
        expect(hyphen.experience[0].end_date).toBe('Hiện tại');
        const single = applyCvFieldEdit(cv, 'experience.0.daterange', '03/2021');
        expect(single.experience[0].start_date).toBe('03/2021');
        expect(single.experience[0].end_date).toBe('');
    });

    it('parses the languages composite chip', () => {
        const cv = makeCv();
        const next = applyCvFieldEdit(cv, 'languages.0', 'Japanese — N2');
        expect(next.languages![0]).toEqual({ language: 'Japanese', level: 'N2' });
        const noLevel = applyCvFieldEdit(cv, 'languages.0', 'Japanese');
        expect(noLevel.languages![0]).toEqual({ language: 'Japanese', level: '' });
    });

    it('edits and removes skills chips', () => {
        const cv = makeCv();
        expect(applyCvFieldEdit(cv, 'skills.1', 'PostgreSQL').skills).toEqual(['Go', 'PostgreSQL']);
        expect(applyCvFieldEdit(cv, 'skills.0', '  ').skills).toEqual(['Postgres']);
    });

    it('coerces numeric fields and rejects non-numbers', () => {
        const cv = makeCv();
        expect(applyCvFieldEdit(cv, 'experience.0.duration_months', '36')
            .experience[0].duration_months).toBe(36);
        expect(applyCvFieldEdit(cv, 'experience.0.duration_months', 'abc')).toBe(cv);
    });

    it('returns the CV unchanged for unknown or out-of-range paths', () => {
        const cv = makeCv();
        expect(applyCvFieldEdit(cv, 'experience.5.title', 'x')).toBe(cv);
        expect(applyCvFieldEdit(cv, 'skills.9', 'x')).toBe(cv);
        expect(applyCvFieldEdit(cv, 'nope.deep.path', 'x')).toBe(cv);
        expect(applyCvFieldEdit(cv, 'languages.3', 'x')).toBe(cv);
    });
});
