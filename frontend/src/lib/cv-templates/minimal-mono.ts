import type { CVData } from '@/lib/types';
import { esc, descToBullets, durationLabel, joinAddress } from './types';

// Text-only template — intentionally has NO image holder (hasPhoto: false),
// so RenderOptions.avatarBase64 is ignored. Best for ATS-strict applications.
export function minimalMonoTemplate(cv: CVData): string {
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
</style>
</head><body>
  <div class="name">${esc(cv.name || '')}</div>
  ${emp.current_title ? `<div class="title">${esc(emp.current_title)}</div>` : ''}
  <div class="contact-row">
    ${[
      c.phone ? esc(c.phone) : '',
      c.email ? esc(c.email) : '',
      c.linkedin ? esc(c.linkedin) : '',
      c.github ? esc(c.github) : '',
      addr ? esc(addr) : '',
      p.date_of_birth ? esc(p.date_of_birth) : '',
    ].filter(Boolean).join('<span class="sep"> | </span>')}
  </div>

  ${cv.summary ? `<h2>Mục tiêu nghề nghiệp</h2><p class="summary">${esc(cv.summary)}</p>` : ''}

  ${cv.experience?.length ? `
    <h2>Kinh nghiệm làm việc</h2>
    ${cv.experience.map(e => `
      <div class="item">
        <div class="item-top">
          <div class="item-title">${esc(e.title)}</div>
          <div class="item-date">${esc(durationLabel(e.duration_months))}</div>
        </div>
        <div class="item-meta">${esc(e.company)}</div>
        <div class="item-desc">${descToBullets(e.description)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.education?.length ? `
    <h2>Học vấn</h2>
    ${cv.education.map(e => `
      <div class="item">
        <div class="item-top">
          <div class="item-title">${esc(e.institution || '')}</div>
          <div class="item-date">${esc(e.year || '')}</div>
        </div>
        <div class="item-meta">${esc(e.degree || '')}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.skills?.length ? `<h2>Kỹ năng</h2><p class="skills">${cv.skills.map(s => esc(s)).join(' · ')}</p>` : ''}

  ${cv.projects?.length ? `
    <h2>Dự án</h2>
    ${cv.projects.map(pj => `
      <div class="item">
        <div class="item-title">${esc(pj.name)}</div>
        <div class="item-desc">${descToBullets(pj.description)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.certifications?.length ? `
    <h2>Chứng chỉ</h2>
    ${cv.certifications.map(ct => `
      <div class="item">
        <div class="item-top">
          <div class="item-title">${esc(ct.name)}</div>
          <div class="item-date">${esc(ct.year)}</div>
        </div>
        ${ct.issuer ? `<div class="item-meta">${esc(ct.issuer)}</div>` : ''}
      </div>
    `).join('')}
  ` : ''}

  ${cv.languages?.length ? `<h2>Ngoại ngữ</h2><p class="skills">${cv.languages.map(l => `${esc(l.language)}${l.level ? ` — ${esc(l.level)}` : ''}`).join(' · ')}</p>` : ''}

  ${cv.awards?.length ? `
    <h2>Giải thưởng</h2>
    ${cv.awards.map(a => `
      <div class="item">
        <div class="item-top">
          <div class="item-title">${esc(a.title)}</div>
          <div class="item-date">${esc(a.year)}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.activities?.length ? `
    <h2>Hoạt động</h2>
    ${cv.activities.map(ac => `
      <div class="item">
        <div class="item-title">${esc(ac.name)}</div>
        <div class="item-desc">${descToBullets(ac.description)}</div>
      </div>
    `).join('')}
  ` : ''}
</body></html>`;
}
