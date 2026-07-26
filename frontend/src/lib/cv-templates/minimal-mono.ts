import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, dateRangeLabel, joinAddress, entryHead, ENTRY_CSS} from './types';
import { VI_LABELS } from './labels';

// Text-only template — intentionally has NO image holder (hasPhoto: false),
// so RenderOptions.avatarBase64 is ignored. Best for ATS-strict applications.
export function minimalMonoTemplate(cv: CVData, opts?: RenderOptions): string {
    const L = opts?.labels ?? VI_LABELS;
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px 48px; line-height: 1.6; font-size: 10.5pt; }
  .name { font-size: 24pt; font-weight: 300; letter-spacing: 3px; text-transform: uppercase; color: #111; margin-bottom: 2px; }
  .title { font-size: 11pt; color: #666; letter-spacing: 1px; margin-bottom: 12px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 9.5pt; color: #555; padding-bottom: 16px; border-bottom: 2px solid #111; }
  .contact-row span.sep { color: #aaa; }
  h2 { font-size: 10.5pt; color: #111; text-transform: uppercase; letter-spacing: 3px; margin: 22px 0 10px; font-weight: 700; }
  .item { margin-bottom: 13px; padding-left: 14px; border-left: 2px solid #ddd; page-break-inside: avoid; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #111; }
  .item-date { font-size: 9pt; color: #888; white-space: nowrap; }
  .item-meta { font-size: 9.5pt; color: #555; margin-bottom: 4px; }
  .item-desc { font-size: 10pt; color: #333; line-height: 1.65; }
  .item-desc ul { padding-left: 16px; }
  .item-desc li { margin-bottom: 2px; }
  .skills { font-size: 10pt; color: #333; line-height: 1.8; }
  .summary { color: #333; font-size: 10pt; line-height: 1.75; }
  ${ENTRY_CSS}
</style>
</head><body>
  <div class="name" data-f="name">${esc(cv.name || '')}</div>
  ${emp.current_title ? `<div class="title" data-f="employment.current_title">${esc(emp.current_title)}</div>` : ''}
  <div class="contact-row">
    ${[
      c.phone ? `<span data-f="contact.phone">${esc(c.phone)}</span>` : '',
      c.email ? `<span data-f="contact.email">${esc(c.email)}</span>` : '',
      c.linkedin ? `<span data-f="contact.linkedin">${esc(c.linkedin)}</span>` : '',
      c.github ? `<span data-f="contact.github">${esc(c.github)}</span>` : '',
      addr ? esc(addr) : '',
      p.date_of_birth ? `<span data-f="personal.date_of_birth">${esc(p.date_of_birth)}</span>` : '',
    ].filter(Boolean).join('<span class="sep"> | </span>')}
  </div>

  ${cv.summary ? `<h2>${L.summary}</h2><p class="summary" data-f="summary">${esc(cv.summary)}</p>` : ''}

  ${cv.experience?.length ? `
    <h2>${L.experience}</h2>
    ${cv.experience.map((e, i) => `
      <div class="item">
        ${entryHead({ title: e.title, titlePath: `experience.${i}.title`, subtitle: e.company, subPath: `experience.${i}.company`, date: dateRangeLabel(e, L), datePath: `experience.${i}.daterange` })}
        <div class="item-desc">${descToBullets(e.description, `experience.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.education?.length ? `
    <h2>${L.education}</h2>
    ${cv.education.map((e, i) => `
      <div class="item">
        ${entryHead({ title: e.institution || '', titlePath: `education.${i}.institution`, subtitle: e.degree || '', subPath: `education.${i}.degree`, date: e.year || '', datePath: `education.${i}.year` })}
      </div>
    `).join('')}
  ` : ''}

  ${cv.skills?.length ? `<h2>${L.skills}</h2><p class="skills">${cv.skills.map((s, i) => `<span data-f="skills.${i}">${esc(s)}</span>`).join(' · ')}</p>` : ''}

  ${cv.projects?.length ? `
    <h2>${L.projects}</h2>
    ${cv.projects.map((pj, i) => `
      <div class="item">
        <div class="item-title" data-f="projects.${i}.name">${esc(pj.name)}</div>
        <div class="item-desc">${descToBullets(pj.description, `projects.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.certifications?.length ? `
    <h2>${L.certifications}</h2>
    ${cv.certifications.map((ct, i) => `
      <div class="item">
        <div class="item-top">
          <div class="item-title" data-f="certifications.${i}.name">${esc(ct.name)}</div>
          <div class="item-date" data-f="certifications.${i}.year">${esc(ct.year)}</div>
        </div>
        ${ct.issuer ? `<div class="item-meta" data-f="certifications.${i}.issuer">${esc(ct.issuer)}</div>` : ''}
      </div>
    `).join('')}
  ` : ''}

  ${cv.languages?.length ? `<h2>${L.languages}</h2><p class="skills">${cv.languages.map((l, i) => `<span data-f="languages.${i}">${esc(l.language)}${l.level ? `: ${esc(l.level)}` : ''}</span>`).join(' · ')}</p>` : ''}

  ${cv.awards?.length ? `
    <h2>${L.awards}</h2>
    ${cv.awards.map((a, i) => `
      <div class="item">
        <div class="item-top">
          <div class="item-title" data-f="awards.${i}.title">${esc(a.title)}</div>
          <div class="item-date" data-f="awards.${i}.year">${esc(a.year)}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.activities?.length ? `
    <h2>${L.activities}</h2>
    ${cv.activities.map((ac, i) => `
      <div class="item">
        <div class="item-title" data-f="activities.${i}.name">${esc(ac.name)}</div>
        <div class="item-desc">${descToBullets(ac.description, `activities.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}
</body></html>`;
}
