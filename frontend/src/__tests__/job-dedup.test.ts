import { describe, it, expect } from 'vitest';
import { filterUnseenCandidates, buildSeenKeys } from '@/lib/job-dedup';
import type { CandidateJob, JobRecord, JDEntry } from '@/store/useAppStore';

function cand(over: Partial<CandidateJob> = {}): CandidateJob {
    return {
        id: 'c1', url: 'https://careers.acme.com/jobs/1', applyUrl: '',
        title: 'Backend Engineer', company: 'Acme', careerUrl: '', location: 'Hà Nội',
        description: '', ...over,
    };
}
function rec(over: Partial<JobRecord> = {}): JobRecord {
    return {
        id: 'r1', jobTitle: 'Backend Engineer', company: 'Acme',
        jobUrl: 'https://careers.acme.com/jobs/1', siteName: '', overallScore: 80,
        timestamp: 0, status: 'saved', ...over,
    };
}
function entry(over: Partial<JDEntry> = {}): JDEntry {
    return { id: 'e1', source: 'https://careers.acme.com/jobs/2', label: 'x', status: 'done',
        jobTitle: 'Data Analyst', company: 'Acme', ...over };
}

describe('job-dedup', () => {
    it('keeps everything when nothing is seen', () => {
        const { kept, removed } = filterUnseenCandidates([cand()], [], []);
        expect(kept).toHaveLength(1);
        expect(removed).toBe(0);
    });

    it('drops a candidate already in history (same URL)', () => {
        const { kept, removed } = filterUnseenCandidates([cand()], [rec()], []);
        expect(kept).toHaveLength(0);
        expect(removed).toBe(1);
    });

    it('matches across differing URLs via company|title', () => {
        const c = cand({ url: 'https://aggregator.vn/listing/999' }); // different URL
        const { kept } = filterUnseenCandidates([c], [rec()], []); // same title+company
        expect(kept).toHaveLength(0);
    });

    it('ignores protocol / www / trailing slash / query on the URL', () => {
        const c = cand({ title: 'X', company: 'Y', url: 'http://www.careers.acme.com/jobs/1/?ref=z' });
        const r = rec({ jobTitle: 'X', company: 'Y', jobUrl: 'https://careers.acme.com/jobs/1' });
        const { kept } = filterUnseenCandidates([c], [r], []);
        expect(kept).toHaveLength(0);
    });

    it('drops a candidate currently queued in jdEntries', () => {
        const c = cand({ title: 'Data Analyst', company: 'Acme', url: 'https://x/9' });
        const { kept } = filterUnseenCandidates([c], [], [entry()]);
        expect(kept).toHaveLength(0);
    });

    it('keeps a genuinely new job', () => {
        const c = cand({ title: 'Product Manager', company: 'Beta', url: 'https://beta.com/p/5' });
        const { kept } = filterUnseenCandidates([c], [rec()], [entry()]);
        expect(kept).toHaveLength(1);
    });

    it('buildSeenKeys collects url + company|title keys', () => {
        const keys = buildSeenKeys([rec()], []);
        expect(keys.has('u:careers.acme.com/jobs/1')).toBe(true);
        expect(keys.has('tc:acme|backend engineer')).toBe(true);
    });
});

describe('job-dedup — query-keyed ATS URLs', () => {
    it('treats detail pages differing only by job-id param as distinct jobs', () => {
        const history = [rec({ jobUrl: 'https://careers.acme.com/job/detail?id=101' })];
        const { kept } = filterUnseenCandidates(
            [cand({ url: 'https://careers.acme.com/job/detail?id=202', title: 'Data Engineer', company: 'Beta' })],
            history, [],
        );
        expect(kept).toHaveLength(1);
    });

    it('still dedupes when only tracking params / param order differ', () => {
        const history = [rec({ jobUrl: 'https://careers.acme.com/job/detail?id=101&utm_source=zalo' })];
        const { removed } = filterUnseenCandidates(
            [cand({ url: 'https://careers.acme.com/job/detail?utm_campaign=x&id=101', title: 'Other', company: 'Other' })],
            history, [],
        );
        expect(removed).toBe(1);
    });
});
