// Workday CXS apply-API client (background side) — MVP.
//
// Instead of driving Workday's fragile UI, POST the application straight to its
// REST API (the same endpoints the SPA uses). Auth is the user's own session:
//   - the session cookie is sent automatically (credentials:'include' + the
//     extension's host_permission for *.myworkdayjobs.com; runs in the background
//     so it's not subject to the page's CSP),
//   - writes additionally need the double-submit CSRF header
//     `X-CALYPSO-CSRF-TOKEN`, whose value is the HttpOnly `CALYPSO_CSRF_TOKEN`
//     cookie — unreadable from page JS but readable here via chrome.cookies.
//
// MVP milestone 1: parse the job → read CSRF → get/create the application →
// write ONE section (name) to prove an authenticated write works end-to-end from
// the extension. Field mapping for the rest (address/phone/source/experience/
// questionnaire, with GUID resolution) is milestone 2+.

const CX = (tenant) => `/wday/calypso/cxs/jobapplication/${tenant}`;       // application path
const COMMON = (tenant) => `/wday/calypso/cxs/common/${tenant}`;          // reference data path

// Known-stable Workday GLOBAL country ids (same across every tenant). MVP only
// needs Vietnam; a runtime resolver (GET /values/names/countries) replaces this.
const COUNTRY = { VN: 'db69e8c8446c11de98360015c5e6daf6' };

export function parseWorkdayJob(url) {
    const clean = String(url || '').trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '');   // tolerate <…>/quotes
    const u = new URL(clean);
    const tenant = u.hostname.split('.')[0];              // "3m"
    const jobId =
        (u.pathname.match(/\/([^/]+)\/apply(?:\/|$)/) || [])[1] ||
        (u.pathname.match(/\/job\/[^/]+\/([^/]+?)(?:\/|$)/) || [])[1] || '';
    return { origin: u.origin, tenant, jobId };
}

function getCsrf(origin) {
    return new Promise(resolve =>
        chrome.cookies.get({ url: origin, name: 'CALYPSO_CSRF_TOKEN' },
            c => resolve((c && c.value) || '')));
}

// Authenticated Workday fetch. GET needs only the cookie; writes add the CSRF
// header. Returns { status, ok, json, text }.
async function wdFetch(origin, path, { method = 'GET', body } = {}) {
    const headers = { 'Accept': 'application/json' };
    if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        const csrf = await getCsrf(origin);
        if (csrf) headers['X-CALYPSO-CSRF-TOKEN'] = csrf;
    }
    const res = await fetch(origin + path, {
        method, credentials: 'include', headers,
        body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html/empty */ }
    return { status: res.status, ok: res.ok, json, text };
}

const firstGuid = v => (JSON.stringify(v || '').match(/[0-9a-f]{32}/) || [])[0] || null;
const snip = r => r.json ? JSON.stringify(r.json).slice(0, 400) : (r.text || '').slice(0, 250);

// Obtain the jobApplication instance id. applyflowpages is only the flow
// DEFINITION (pages/sections), not the instance — the instance id comes from
// CREATE (POST jobapplications) or, for an already-started job, from the
// candidate's applications list. Diagnostic while we pin the exact id fields.
export async function getOrCreateApplication({ origin, tenant, jobId }) {
    const debug = {};
    const cont = await wdFetch(origin, `${CX(tenant)}/job/${jobId}/canapplycontinue`);
    debug.canApply = cont.json;

    // Create (works for a fresh job; 400s if an application already exists).
    const created = await wdFetch(origin, `/wday/cxs/${tenant}/jobpostings/${jobId}/jobapplications`,
        { method: 'POST', body: {} });
    debug.create = { status: created.status, body: snip(created) };
    let appId = created.json && (created.json.jobApplicationId || created.json.id || firstGuid(created.json));
    if (appId && created.ok) return { appId, created: true, via: 'jobapplications', debug };

    // Already started → find the existing application for this job.
    const apps = await wdFetch(origin, `/wday/cxs/${tenant}/Search/applications`);
    debug.applications = { status: apps.status, body: snip(apps) };
    const list = (apps.json && (apps.json.applications || apps.json.data || apps.json)) || [];
    const mine = Array.isArray(list)
        ? list.find(a => JSON.stringify(a).includes(jobId)) || list[0]
        : null;
    appId = mine && (mine.jobApplicationId || mine.applicationId || mine.id || firstGuid(mine));
    return { appId, created: false, via: 'existing', debug };
}

// Does Workday serve the form SCHEMA to a GET once the application is active?
// (Bare /namedefinition 500s; the SPA gets 200 mid-flow.) Dumps package + the
// section definitions so we can decide data-driven vs hardcoded filling.
export async function probeSchema({ origin, tenant }, appId) {
    const out = {};
    const targets = [
        ['package', `${CX(tenant)}/package/${appId}`],
        ['nameDef', `${CX(tenant)}/namedefinition`],
        ['addressDef', `${CX(tenant)}/addressdefinition`],
    ];
    for (const [k, path] of targets) {
        const r = await wdFetch(origin, path);
        out[k] = { status: r.status, head: snip(r) };
    }
    return out;
}

// Initialize the application instance — the capture shows this precedes the
// section writes. Idempotent-ish; ignore a non-fatal status.
export async function initializeApplication({ origin, tenant }, appId) {
    const r = await wdFetch(origin, `/wday/cxs/${tenant}/jobapplication/${appId}/initialize`,
        { method: 'POST', body: {} });
    return { status: r.status, ok: r.ok, detail: r.ok ? 'ok' : snip(r) };
}

// ── GUID resolver ──────────────────────────────────────────────────────────
// Every Workday dropdown value is a WID/GUID that must be looked up from a
// reference endpoint. Refs are an array of {id, descriptor} (sometimes wrapped in
// {data:[…]} / {values:[…]}). Pick the entry whose descriptor matches `wants`
// (first match wins; falls back to the first entry).
async function getRef(origin, path) {
    const r = await wdFetch(origin, path);
    return Array.isArray(r.json) ? r.json : (r.json && (r.json.data || r.json.values)) || [];
}
function pickWid(list, wants) {
    const lc = s => String(s || '').toLowerCase();
    for (const w of [].concat(wants)) {
        const hit = list.find(e => lc(e.descriptor) === lc(w)) || list.find(e => lc(e.descriptor).includes(lc(w)));
        if (hit) return { id: hit.id, descriptor: hit.descriptor };
    }
    return list[0] ? { id: list[0].id, descriptor: list[0].descriptor } : null;
}

// Email — plain string, no GUID.
export async function postEmail({ origin, tenant }, appId, profile) {
    const r = await wdFetch(origin, `${CX(tenant)}/jobapplication/${appId}/emailaddress`,
        { method: 'POST', body: { email: profile.email || '' } });
    return { status: r.status, ok: r.ok, detail: r.ok ? 'ok' : snip(r) };
}

// "How did you hear about us" source — single GUID (exercises the resolver).
// Optional & tenant-specific: if the tenant exposes no sources, skip cleanly.
export async function postSource({ origin, tenant }, appId) {
    const raw = await wdFetch(origin, `${CX(tenant)}/values/sources/sources`);
    const list = Array.isArray(raw.json) ? raw.json : (raw.json && (raw.json.data || raw.json.values)) || [];
    if (!list.length) return { status: raw.status, ok: true, skipped: true, reason: 'no sources for tenant', rawHead: snip(raw) };
    const src = pickWid(list, ['Company Website', 'Company Career Site', 'Website', 'Other', 'Job Board']);
    const r = await wdFetch(origin, `${CX(tenant)}/jobapplication/${appId}/source`,
        { method: 'POST', body: { sourcePopulatedFromUrl: false, source: src } });
    return { status: r.status, ok: r.ok, picked: src.descriptor, detail: r.ok ? 'ok' : snip(r) };
}

// Address — resolves the province (countryRegion) to a GUID. city = "District or
// Town", countryRegion = "Province or City" (dropdown). VN only for now.
export async function postAddress({ origin, tenant }, appId, profile) {
    const country = COUNTRY.VN;
    const regions = await getRef(origin, `${COMMON(tenant)}/countries/${country}/regions`);
    const region = profile.addressProvince ? pickWid(regions, [profile.addressProvince]) : null;
    const body = {
        addressLine1: profile.addressStreet || profile.addressDistrict || '',
        city: profile.addressDistrict || profile.addressProvince || '',
        postalCode: profile.postalCode || '',
        country: { id: country },
        ...(region ? { countryRegion: region } : {}),
    };
    const r = await wdFetch(origin, `${CX(tenant)}/jobapplication/${appId}/address`,
        { method: 'POST', body });
    return { status: r.status, ok: r.ok, region: region && region.descriptor, regionsCount: regions.length, detail: r.ok ? 'ok' : snip(r) };
}

// Phone — resolves device type (Mobile) + country phone code (VN) to GUIDs.
export async function postPhone({ origin, tenant }, appId, profile) {
    if (!profile.phone) return { status: 0, ok: true, skipped: true, reason: 'no phone in profile' };
    const country = COUNTRY.VN;
    const types = await getRef(origin, `${CX(tenant)}/values/phone/deviceTypes`);
    const type = pickWid(types, ['Mobile', 'Cell', 'Cellular', 'Landline']);
    const codes = await getRef(origin, `${COMMON(tenant)}/countries/${country}/countryphonecode`);
    const code = pickWid(codes, ['+84', '84', 'Vietnam', 'Viet']);
    const number = String(profile.phone).replace(/[^\d]/g, '').replace(/^840?|^0/, '');   // strip +84 / leading 0
    const body = {
        phoneNumber: number || String(profile.phone),
        ...(type ? { phoneType: type } : {}),
        ...(code ? { countryPhoneCode: code } : {}),
    };
    const r = await wdFetch(origin, `${CX(tenant)}/jobapplication/${appId}/phonenumber`, { method: 'POST', body });
    return {
        status: r.status, ok: r.ok, type: type && type.descriptor, code: code && code.descriptor,
        typesCount: types.length, codesCount: codes.length, detail: r.ok ? 'ok' : snip(r),
    };
}

// Write the My Information "name" section — proves an authenticated write works.
export async function postName({ origin, tenant }, appId, profile) {
    const body = {
        legalName: {
            firstName: profile.firstName || '',
            lastName: profile.lastName || '',
            firstNameLocal: profile.firstName || '',
            lastNameLocal: profile.lastName || '',
            country: { id: COUNTRY.VN },
        },
    };
    const r = await wdFetch(origin, `${CX(tenant)}/jobapplication/${appId}/name`,
        { method: 'POST', body });
    return { status: r.status, ok: r.ok, detail: r.ok ? 'ok' : r.text.slice(0, 200) };
}

// READ the whole application form in one shot — every section's current
// values/structure + the (POST-only) questionnaire definition. Lets us build the
// remaining sections from one dump instead of testing page by page.
export async function readForm(jobUrl, opts = {}) {
    const job = parseWorkdayJob(jobUrl);
    const { origin, tenant } = job;
    const app = opts.appId ? { appId: opts.appId, reused: true } : await getOrCreateApplication(job);
    if (!app.appId) return { ok: false, error: 'no appId', app };
    if (!opts.appId) await initializeApplication(job, app.appId);

    const PKG = `${CX(tenant)}/package/${app.appId}`;
    const APP = `${CX(tenant)}/jobapplication/${app.appId}`;
    const out = { appId: app.appId, sections: {}, refs: {} };

    // Parent structure — applyflowpages carries per-page CUSTOM section schema
    // (id/label/required/hidden/instructionalText). Standard pages (My Info,
    // Voluntary) list 0 sections (their fields are the universal candidate model).
    const flow = await wdFetch(origin, `${CX(tenant)}/jobpostings/${job.jobId}/applyflowpages`);
    out.flowPages = ((flow.json && flow.json.data) || []).map(p => ({
        page: p.descriptor,
        sections: (p.sections || []).map(s => ({
            label: s.label, required: s.required, hidden: s.hidden,
            instr: (s.instructionalText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
            id: s.id,
        })),
    }));

    const pkg = await wdFetch(origin, PKG);
    out.package = pkg.json;

    for (const s of ['names', 'addresses', 'phonenumbers', 'emailaddresses', 'educations',
        'workexperiences', 'skills', 'socials', 'webaddresses', 'languages',
        'resumeattachments', 'certifications']) {
        const r = await wdFetch(origin, `${PKG}/${s}`);
        out.sections[s] = { status: r.status, body: r.json != null ? r.json : (r.text || '').slice(0, 120) };
    }

    // Questionnaire (Application Questions) — definition is a POST. Find its id.
    const qa = await wdFetch(origin, `${APP}/questionnaireanswers`);
    out.sections.questionnaireanswers = qa.json;
    const qid = (JSON.stringify(qa.json || pkg.json || '').match(/questionnaire[^"]*?([0-9a-f]{32})/i) || [])[1]
        || (JSON.stringify(pkg.json || '').match(/"questionnaire"\s*:\s*"?([0-9a-f]{32})/i) || [])[1];
    if (qid) {
        const def = await wdFetch(origin, `${COMMON(tenant)}/questionnaire/${qid}/definition`, { method: 'POST', body: {} });
        out.questionnaire = { id: qid, status: def.status, definition: def.json };
    } else {
        out.questionnaire = { id: null, note: 'no questionnaire id found in package/answers' };
    }

    // Reference lists we already use (so we can eyeball them once).
    out.refs.gender = (await wdFetch(origin, `${CX(tenant)}/values/personalInfo/gender`)).json;
    return out;
}

// Resume upload — Workday parses it to auto-fill My Experience. It's a multipart
// scan-then-attach flow; diagnostic here to learn the exact shape (scanfile
// response → then POST resumeattachments). cv = { base64, fileName }.
export async function postResume({ origin, tenant }, appId, cv) {
    if (!cv || !cv.base64) return { skipped: true, reason: 'no CV synced (cvFileBase64)' };
    try {
        const bytes = Uint8Array.from(atob(cv.base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const fd = new FormData();
        fd.append('file', blob, cv.fileName || 'resume.pdf');
        const csrf = await getCsrf(origin);
        const scan = await fetch(`${origin}${COMMON(tenant)}/scanfile`, {
            method: 'POST', credentials: 'include',
            headers: csrf ? { 'X-CALYPSO-CSRF-TOKEN': csrf } : {},   // multipart → let the browser set Content-Type
            body: fd,
        });
        const scanTxt = await scan.text();
        let scanJson = null; try { scanJson = JSON.parse(scanTxt); } catch { /* html */ }
        return { scanStatus: scan.status, scanHead: scanTxt.slice(0, 300), scanJson };
    } catch (e) {
        return { error: e.message };
    }
}

// Voluntary Disclosures consent (Terms & Conditions). Body shape best-guess;
// validate confirms whether it took.
export async function putConsent({ origin, tenant }, appId) {
    const body = { agreedToTermsAndConditions: true, acceptTermsAndAgreements: true };
    const r = await wdFetch(origin, `/wday/cxs/${tenant}/jobapplication/${appId}/termsandconditions`,
        { method: 'PUT', body });
    return { status: r.status, ok: r.ok, detail: r.ok ? 'ok' : snip(r) };
}

// Validate the package — Workday returns the list of missing/invalid fields, i.e.
// exactly what still needs filling before submit. The guide for the rest.
export async function validateApplication({ origin, tenant }, appId) {
    const r = await wdFetch(origin, `${CX(tenant)}/package/${appId}/validate`, { method: 'PUT', body: {} });
    return { status: r.status, ok: r.ok, result: r.json != null ? r.json : (r.text || '').slice(0, 800) };
}

// MVP orchestrator: get/create the application + write the name section.
// Returns a report; never submits.
export async function mvpApply(jobUrl, profile, cv) {
    const job = parseWorkdayJob(jobUrl);
    if (!job.jobId) return { ok: false, error: 'could not parse jobId from URL', job };
    const report = { job, steps: {} };

    const app = await getOrCreateApplication(job);
    report.steps.application = app;
    if (!app.appId) { report.ok = false; report.error = 'no appId — see debug'; return report; }

    report.steps.initialize = await initializeApplication(job, app.appId);
    report.steps.schema = await probeSchema(job, app.appId);   // is the form schema GET-able with context?
    const p = profile || {};
    report.steps.name = await postName(job, app.appId, p);
    report.steps.email = await postEmail(job, app.appId, p);
    report.steps.address = await postAddress(job, app.appId, p);
    report.steps.phone = await postPhone(job, app.appId, p);
    report.steps.source = await postSource(job, app.appId);
    report.steps.resume = await postResume(job, app.appId, cv);
    report.steps.consent = await putConsent(job, app.appId);
    // validate LAST — reports what's still missing (resume/experience/questionnaire).
    report.steps.validate = await validateApplication(job, app.appId);
    // "ok" tracks the core, always-present sections; source is optional/tenant-specific.
    report.ok = report.steps.name.ok && report.steps.email.ok && report.steps.address.ok && report.steps.phone.ok;
    return report;
}
