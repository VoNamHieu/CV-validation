/**
 * Platform-wide behaviours measured the hard way — the ones that cost days and
 * must never be re-learned. Scoped to Workday CXS, not to any one tenant.
 *
 * Each is a fact + its evidence + what it forces on the engine. When a Workday
 * update makes one false, its `evidence` is the re-measure checklist.
 */

/** @type {Array<{id:string, statement:string, forces:string, evidence:string}>} */
export const workdayQuirks = [
    {
        id: 'skillsearch.shape',
        statement: 'GET /wday/cxs/{tenant}/skillsearch?search=TERM → [{id, descriptor}]. '
            + 'A catalog row id is REMOTE_SKILL-…; the CREATE row is LAST and its id EQUALS its descriptor. '
            + 'No pagination, no wildcard, empty search → []. There is no bulk catalog dump.',
        forces: 'skillsearch is the ORACLE for "does this skill exist + how is it spelled", read per-term at fill time; never a precomputed file.',
        evidence: 'mdlz 2026-08-13; maersk 2026-08-14',
    },
    {
        id: 'skillsearch.padding-is-per-tenant',
        statement: 'Result COUNT differs by tenant: MDLZ pads every query to ~16 (so an exact term ALWAYS has a create-twin of the same text); '
            + 'Maersk returns only the create row (n=1, no catalog at all).',
        forces: 'do NOT assume a catalog exists or a fixed result size — a tenant quirk, measured, not hardcoded.',
        evidence: 'mdlz: pad-16 + twins; maersk: create-only',
    },
    {
        id: 'isolated-world.no-fiber',
        statement: 'A DOM node\'s __reactFiber$ expando is a PER-WORLD JS property. The content script runs in the ISOLATED world and never sees it.',
        forces: 'any fiber read/write (e.g. the Skills onSelect data-write) must cross to the MAIN world via a background chrome.scripting bridge; '
            + 'the engine\'s own fiber read has always returned null in production — the skillsearch API read is what actually carried it.',
        evidence: 'mdlz 2026-08-14 (SKILL_FIBER_WRITE bridge)',
    },
    {
        id: 'hidden-tab.what-lives',
        statement: 'A backgrounded tab throttles/pauses rAF, paint, the virtualiser render, IntersectionObserver, and setTimeout (→~1/min after 5min). '
            + 'It does NOT throttle: JS execution, fetch, microtasks, DOM mutation, scrollTop set, or React\'s discrete-event state commit.',
        forces: 'never depend on paint/rAF hidden; drive by discrete events + network; borrow the SW clock (AGENT_SLEEP) for waits; '
            + 'commit an unpaintable row by DATA (fiber onSelect), not by clicking a node that was never rendered.',
        evidence: 'mdlz 2026-08-07..13 (the whole hidden-tab campaign)',
    },
    {
        id: 'virtualiser.index-mismatch',
        statement: 'The skillsearch API order and the rendered (virtualised) UI order can DISAGREE (measured: API idx 6 = "Urban Economics", UI idx 6 = "Production Economics"). '
            + 'While hidden the scroller clientHeight collapses to ~1px and only ~2 of 16 rows paint.',
        forces: 'an item\'s index is for SCROLLING only, never identity; click by unique label in the newest list, else data-write by id.',
        evidence: 'mdlz 2026-08-13',
    },
    {
        id: 'chip-search.mechanics',
        statement: 'Search list opens on a real CLICK (focus+value alone opens nothing); Enter SUBMITS the query (not a commit); a checkbox click on a rendered row commits; '
            + 'the DELETE_charm on a chip answers only to a mousedown-led pointer sequence — a bare .click() is a no-op.',
        forces: 'the activate + commit + rollback sequences in the chip-search capabilities.',
        evidence: 'mdlz R-174102 2026-08-09..13',
    },
    {
        id: 'draft.server-truth',
        statement: 'Field values live in client React state and are the SERVER draft only after Save-and-Continue. A long-hidden tab\'s client state can drift; reload restores server truth.',
        forces: 'chips/values are trusted after the step\'s Save-and-Continue; the engine ends each page on that button.',
        evidence: 'mdlz 2026-08-13',
    },
    {
        id: 'tenant-identity.location',
        statement: 'The tenant id is NOT always in the path. MDLZ: host myworkdaysite.com, path /recruiting/mdlz/. '
            + 'Maersk: host maersk.wd3.myworkdayjobs.com (tenant in SUBDOMAIN), path /Maersk_Careers/ (that segment is the SITE, not the tenant).',
        forces: 'derive tenant from host-subdomain OR /wday/cxs/{tenant}/, never a single path regex; the current fetchSkillOptions regex assumes path and would fall back to \'mdlz\' on Maersk.',
        evidence: 'maersk 2026-08-14',
    },
];
