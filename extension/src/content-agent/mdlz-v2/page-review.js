/**
 * P6 — Review. The controller that does not touch anything.
 *
 * This page has one button and it sends the application. Workday reuses
 * `pageFooterNextButton` for Submit here — measured, and the reason the agent's
 * final-step handling exists at all — and the recipe also records a distinct
 * `pageFooterSubmitButton`. Either of them ends the application, so the rule is
 * not "avoid the submit button", it is DO NOT CLICK ON THIS PAGE.
 *
 * That rule is already enforced twice over, and owning the page adds the third:
 *   · the navigation transaction refuses REVIEW by name and refuses any button
 *     whose label says Submit;
 *   · this controller never calls it;
 *   · and because v2 owns the page, the click choke point refuses every caller
 *     that is not v2 — so v1, the generic recipe and the planner cannot click
 *     here either. Porting Review is what makes the page click-proof for the
 *     whole agent rather than just for the part that remembered.
 *
 * What it does instead is READ: what the review says, section by section, and
 * what the CV holds that the review does not mention. A missing row here is the
 * last chance to notice that a page three steps back did not take.
 *
 * It does not press "More" to expand a truncated list either. Nobody has
 * measured that control, and an unmeasured click on the page that submits is
 * the worst place to start guessing. A list this reads as truncated is reported
 * as truncated.
 */

import { COPY, RESULT, SEL } from './config.js';
import { trace } from '../trace.js';

const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const fold = (s) => String(s || '').toLowerCase();

/** Section headings, in Workday's own words. */
const SECTIONS = [
    ['work', COPY.sections.work],
    ['education', COPY.sections.education],
    ['languages', COPY.sections.languages],
    ['skills', COPY.sections.skills],
    ['websites', COPY.sections.websites],
];

/**
 * The container a heading names — the same climb rows are found by: stop where
 * the ancestor would take in another section's heading.
 */
function sectionUnder(title) {
    if (typeof document === 'undefined' || !title) return null;
    const others = SECTIONS.map(([, t]) => t).filter((t) => t !== title);
    const holds = (node, text) => [...(node.querySelectorAll?.('h1,h2,h3,h4,h5,label,div,span') || [])]
        .some((el) => txt(el) === text);
    const head = [...document.querySelectorAll('h1,h2,h3,h4,h5,label,div,span')]
        .filter((el) => txt(el) === title)
        .find((el) => el.offsetParent !== null);
    if (!head) return null;
    let node = head;
    while (node.parentNode && node.parentNode !== document.documentElement) {
        const parent = node.parentNode;
        if (others.some((t) => holds(parent, t))) break;
        node = parent;
        if (txt(node).length > title.length) return node;
    }
    return node;
}

/** What the review says, section by section. Reading only. */
export function reviewSnapshot() {
    const sections = {};
    for (const [key, title] of SECTIONS) {
        const node = sectionUnder(title);
        if (!node) continue;
        const body = txt(node).slice(title.length).trim();
        sections[key] = {
            heading: title,
            text: body,
            // Workday truncates long lists on this page. Reported, never
            // expanded: the control that would expand it has not been measured,
            // and this is the page where an unmeasured click submits.
            truncated: /\bmore\b|\.\.\.|…/i.test(body),
        };
    }
    return sections;
}

/**
 * What the CV holds that the review does not mention.
 *
 * The last chance to notice that a page three steps back did not take. It
 * compares by CONTENT — a title, a company, a school, a language — because that
 * is all a summary page shows, and it reports rather than fixes: fixing means
 * going back, and going back from here is the user's decision.
 */
export function missingFromReview(snapshot, cv) {
    const gaps = [];
    const has = (key, needle) => {
        const body = fold(snapshot[key]?.text || '');
        return !!needle && body.includes(fold(needle));
    };
    for (const e of (cv?.experience || [])) {
        if (e.title && !has('work', e.title)) gaps.push({ section: 'work', want: e.title, why: 'not on the review' });
        else if (e.company && !has('work', e.company)) gaps.push({ section: 'work', want: e.company, why: 'company not on the review' });
    }
    for (const e of (cv?.education || [])) {
        const school = e.institution || e.school;
        if (school && !has('education', school)) gaps.push({ section: 'education', want: school, why: 'not on the review' });
    }
    for (const l of (cv?.languages || [])) {
        if (l.language && !has('languages', l.language)) gaps.push({ section: 'languages', want: l.language, why: 'not on the review' });
    }
    return gaps;
}

/**
 * Run the page — which means look at it.
 *
 * Returns `filled: 0` and never anything resembling "submitted": the agent does
 * not send applications, and a report that said otherwise would be the one
 * sentence a user reads before believing they are done.
 */
export async function runReviewPage(ctx = {}) {
    const snapshot = reviewSnapshot();
    const gaps = missingFromReview(snapshot, ctx.cv);
    const truncated = Object.entries(snapshot).filter(([, s]) => s.truncated).map(([k]) => k);

    trace('mdlz.review', {
        sections: Object.keys(snapshot).join(',') || '(none read)',
        gaps: gaps.map((g) => `${g.section}:${g.want}`).join(' · ') || '(none)',
        truncated: truncated.join(',') || '(none)',
        note: 'read-only — nothing on this page is clicked',
    });

    return {
        took: true,
        result: RESULT.SATISFIED,
        readOnly: true,
        snapshot,
        gaps,
        truncated,
        report: {
            matched: true,
            // Nothing was filled here and nothing was sent. The user presses
            // Submit, on a page nothing else may click.
            filled: 0,
            step: 'Review',
            answers: [],
            v2: true,
            handoff: 'awaiting user submit',
            review: snapshot,
            fieldGaps: gaps,
        },
    };
}

/** The submit controls, named so a test can assert nobody touched them. */
export const SUBMIT_CONTROLS = [SEL.nextButton, '[data-automation-id="pageFooterSubmitButton"]'];
