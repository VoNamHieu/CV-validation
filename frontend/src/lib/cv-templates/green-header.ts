import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, durationLabel, avatarInner, joinAddress } from './types';

export function greenHeaderTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #2a3535; padding: 32px 44px; line-height: 1.6; font-size: 10.5pt; }
  .header { display: grid; grid-template-columns: 110px 1fr; gap: 24px; align-items: center; margin-bottom: 14px; }
  .avatar { width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, #c8e6c9, #a5d6a7); display: flex; align-items: center; justify-content: center; font-size: 42pt; color: #1b5e20; font-weight: 700; overflow: hidden; }
  .name { font-size: 23pt; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
  .title { font-size: 11pt; color: #2e7d32; font-weight: 600; margin-bottom: 10px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 5px 18px; font-size: 9.5pt; color: #444; }
  .contact-row div { display: flex; align-items: center; gap: 5px; }
  .contact-row .dot { width: 5px; height: 5px; background: #2e7d32; border-radius: 50%; flex-shrink: 0; }
  h2 { background: #2e7d32; color: white; padding: 7px 14px; font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; border-radius: 4px; margin: 18px 0 12px; }
  .timeline-row { display: grid; grid-template-columns: 110px 1fr; gap: 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .timeline-date { color: #2e7d32; font-size: 9.5pt; font-weight: 600; padding-top: 1px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #1a1a1a; }
  .item-meta { font-size: 9.5pt; color: #555; margin-bottom: 4px; font-style: italic; }
  .item-desc { font-size: 10pt; color: #333; line-height: 1.7; }
  .item-desc ul { padding-left: 18px; }
  .item-desc li { margin-bottom: 2px; }
  .skills { display: flex; flex-wrap: wrap; gap: 6px; }
  .skill { background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; border-radius: 3px; padding: 3px 10px; font-size: 9.5pt; font-weight: 500; }
  .summary { color: #333; font-size: 10pt; line-height: 1.75; padding: 0 4px; }
</style>
</head><body>
  <div class="header">
    <div class="avatar">${avatar}</div>
    <div>
      <div class="name">${esc(cv.name || '')}</div>
      ${emp.current_title ? `<div class="title">${esc(emp.current_title)}</div>` : ''}
      <div class="contact-row">
        ${p.date_of_birth ? `<div><span class="dot"></span>${esc(p.date_of_birth)}</div>` : ''}
        ${c.phone ? `<div><span class="dot"></span>${esc(c.phone)}</div>` : ''}
        ${c.email ? `<div><span class="dot"></span>${esc(c.email)}</div>` : ''}
        ${p.gender ? `<div><span class="dot"></span>${esc(p.gender)}</div>` : ''}
        ${addr ? `<div><span class="dot"></span>${esc(addr)}</div>` : ''}
        ${c.linkedin ? `<div><span class="dot"></span>${esc(c.linkedin)}</div>` : ''}
      </div>
    </div>
  </div>

  ${cv.summary ? `<h2>Mục tiêu nghề nghiệp</h2><p class="summary">${esc(cv.summary)}</p>` : ''}

  ${cv.education?.length ? `
    <h2>Học vấn</h2>
    ${cv.education.map(e => `
      <div class="timeline-row">
        <div class="timeline-date">${esc(e.year || '')}</div>
        <div>
          <div class="item-title">${esc(e.institution || '')}</div>
          <div class="item-meta">${esc(e.degree || '')}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.experience?.length ? `
    <h2>Kinh nghiệm làm việc</h2>
    ${cv.experience.map(e => `
      <div class="timeline-row">
        <div class="timeline-date">${esc(durationLabel(e.duration_months))}</div>
        <div>
          <div class="item-title">${esc(e.title)}</div>
          <div class="item-meta">${esc(e.company)}</div>
          <div class="item-desc">${descToBullets(e.description)}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.skills?.length ? `<h2>Kỹ năng</h2><div class="skills">${cv.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('')}</div>` : ''}

  ${cv.projects?.length ? `
    <h2>Dự án</h2>
    ${cv.projects.map(pj => `
      <div class="timeline-row">
        <div class="timeline-date"></div>
        <div>
          <div class="item-title">${esc(pj.name)}</div>
          <div class="item-desc">${descToBullets(pj.description)}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.certifications?.length ? `
    <h2>Chứng chỉ</h2>
    ${cv.certifications.map(ct => `
      <div class="timeline-row">
        <div class="timeline-date">${esc(ct.year || '')}</div>
        <div>
          <div class="item-title">${esc(ct.name || '')}</div>
          ${ct.issuer ? `<div class="item-meta">${esc(ct.issuer)}</div>` : ''}
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.languages?.length ? `<h2>Ngoại ngữ</h2><div class="skills">${cv.languages.map(l => `<span class="skill">${esc(l.language || '')}${l.level ? ` — ${esc(l.level)}` : ''}</span>`).join('')}</div>` : ''}

  ${cv.awards?.length ? `
    <h2>Giải thưởng</h2>
    ${cv.awards.map(a => `
      <div class="timeline-row">
        <div class="timeline-date">${esc(a.year || '')}</div>
        <div>
          <div class="item-title">${esc(a.title || '')}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.activities?.length ? `
    <h2>Hoạt động</h2>
    ${cv.activities.map(ac => `
      <div class="timeline-row">
        <div class="timeline-date"></div>
        <div>
          <div class="item-title">${esc(ac.name || '')}</div>
          <div class="item-desc">${descToBullets(ac.description)}</div>
        </div>
      </div>
    `).join('')}
  ` : ''}
</body></html>`;
}
