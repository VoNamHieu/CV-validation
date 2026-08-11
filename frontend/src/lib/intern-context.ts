/**
 * When an application is an INTERNSHIP, and what such an application still needs.
 *
 * Measured on Workday (R-172558 Marketing Intern, 2026-08-11): the intern
 * postings mark Education's "Overall Result (GPA)" and "Field of Study"
 * required, while the executive postings never render them. A résumé parse
 * supplies neither, so with nothing filled the apply-agent stalls on My
 * Experience mid-run — the one page that cannot be re-done once submitted.
 *
 * User decision (2026-08-11): collect them upfront, but ONLY where they are
 * relevant — a candidate applying to executive roles must not be forced to enter
 * a GPA their target forms never ask for. So this is used two ways: to require
 * the fields in the profile form when the CV reads as a student/new grad, and to
 * gate — per job, not globally — the auto-apply of an intern posting that would
 * otherwise gap. Everything here is a pure function of data already on hand.
 */

import type { CVData } from './types';
import { isCatalogueFieldOfStudy } from './field-of-study';

/** A job title/label that reads as an internship or campus / early-career hire. */
const INTERN_RE = /\b(intern|internship|thực\s*tập|thuc\s*tap|campus|fresher|graduate\s+trainee|management\s+trainee|apprentice)\b/i;

export interface JobLike {
    jobTitle?: string | null;
    label?: string | null;
}

/** Does this posting read as an internship? Title/label only — the reliable signal. */
export function isInternJob(job: JobLike | null | undefined): boolean {
    if (!job) return false;
    return INTERN_RE.test(`${job.jobTitle ?? ''} ${job.label ?? ''}`);
}

/**
 * Does the CV read as a student / new grad? — the other "intern-relevant" signal,
 * the one available in the profile form (which has no target job). Deliberately
 * generous: one year or less of experience, or no work history at all.
 */
export function isStudentOrNewGrad(cv: CVData | null | undefined): boolean {
    if (!cv) return false;
    const yoe = cv.employment?.years_of_experience;
    if (typeof yoe === 'number' && yoe <= 1) return true;
    if (!cv.experience?.length) return true;
    return false;
}

/**
 * The fields an INTERN application needs before it can even be dispatched, read
 * off the first education entry — a fast, synchronous PRESENCE check for the
 * profile form / early feedback. Empty array means "nothing obviously missing".
 *
 * Field of study is required in its OWN right: a degree is NOT a major and cannot
 * fill Workday's Field of Study, so — unlike before — a present degree no longer
 * masks a missing major here. Whether the major actually lands on the closed
 * catalogue is a separate, resolution-aware check (see internApplyGaps), because
 * that needs the async resolver; this one only asks "did the candidate give a
 * major at all".
 */
export function internCvGaps(cv: CVData | null | undefined): string[] {
    const edu = cv?.education?.[0];
    const gaps: string[] = [];
    if (!String(edu?.gpa ?? '').trim()) gaps.push('Điểm TB (GPA)');
    if (!String(edu?.field_of_study ?? '').trim()) gaps.push('Ngành học');
    return gaps;
}

/**
 * The apply-time gate, run on a CV whose field of study has ALREADY been through
 * resolveCvFieldsOfStudy. Pure and synchronous so it is trivially testable; the
 * async resolution happens in the caller.
 *
 * The difference from internCvGaps that closes the mid-run gap: Field of Study is
 * a REQUIRED CLOSED catalogue on the intern form, so presence is not enough — the
 * value must be an actual catalogue row, or the search finds nothing and My
 * Experience gaps mid-run (the page that cannot be re-done once submitted). A
 * value that did not resolve — LLM/network error, or a genuinely unmappable major
 * — is not a catalogue row, so it is BLOCKED here rather than dispatched. No
 * fail-open for the required closed-enum.
 */
export function internApplyGaps(resolvedCv: CVData | null | undefined): string[] {
    const edu = resolvedCv?.education?.[0];
    const gaps: string[] = [];
    if (!String(edu?.gpa ?? '').trim()) gaps.push('Điểm TB (GPA)');
    if (!isCatalogueFieldOfStudy(edu?.field_of_study)) gaps.push('Ngành học');
    return gaps;
}

/**
 * Why an intern posting cannot be auto-applied yet, or null when it can. A
 * non-intern posting is never blocked — that is what "only block intern jobs"
 * means.
 */
export function internBlockReason(job: JobLike | null | undefined, cv: CVData | null | undefined): string | null {
    if (!isInternJob(job)) return null;
    const gaps = internCvGaps(cv);
    return gaps.length ? gaps.join(', ') : null;
}
