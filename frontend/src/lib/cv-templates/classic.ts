import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, durationLabel, avatarInner, joinAddress } from './types';

export function classicTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #2a2a2a; padding: 36px 44px; line-height: 1.55; font-size: 10.5pt; }
  .header { display: grid; grid-template-columns: 96px 1fr; gap: 24px; align-items: center; margin-bottom: 22px; }
  .avatar { width: 92px; height: 92px; border-radius: 50%; background: #e8e8e8; display: flex; align-items: center; justify-content: center; font-size: 38pt; color: #999; font-weight: 600; overflow: hidden; }
  .name { font-size: 22pt; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
  .title { font-size: 11pt; color: #555; margin-bottom: 8px; font-style: italic; }
  .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 22px; font-size: 9.5pt; color: #444; }
  .contact-grid div { display: flex; gap: 6px; }
  .contact-label { color: #888; min-width: 72px; flex-shrink: 0; }
  h2 { font-size: 11pt; color: #1a1a1a; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1.5px solid #2a2a2a; padding-bottom: 4px; margin: 22px 0 12px; font-weight: 700; }
  .timeline-row { display: grid; grid-template-columns: 110px 1fr; gap: 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .timeline-date { color: #666; font-size: 9.5pt; padding-top: 1px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #1a1a1a; }
  .item-meta { font-size: 9.5pt; color: #555; margin-bottom: 4px; font-style: italic; }
  .item-desc { font-size: 10pt; color: #333; line-height: 1.65; }
  .item-desc ul { padding-left: 18px; }
  .item-desc li { margin-bottom: 2px; }
  .skills { display: flex; flex-wrap: wrap; gap: 6px; }
  .skill { background: #f3f3f3; border: 1px solid #ddd; border-radius: 3px; padding: 2px 9px; font-size: 9.5pt; color: #333; }
  .summary { color: #333; font-size: 10pt; line-height: 1.7; padding: 0 4px; }
</style>
</head><body>
  <div class="header">
    <div class="avatar">${avatar}</div>
    <div>
      <div class="name">${esc(cv.name || '')}</div>
      ${emp.current_title ? `<div class="title">${esc(emp.current_title)}</div>` : ''}
      <div class="contact-grid">
        ${p.date_of_birth ? `<div><span class="contact-label">Ngày sinh:</span><span>${esc(p.date_of_birth)}</span></div>` : ''}
        ${p.gender ? `<div><span class="contact-label">Giới tính:</span><span>${esc(p.gender)}</span></div>` : ''}
        ${c.phone ? `<div><span class="contact-label">Số điện thoại:</span><span>${esc(c.phone)}</span></div>` : ''}
        ${c.email ? `<div><span class="contact-label">Email:</span><span>${esc(c.email)}</span></div>` : ''}
        ${c.linkedin ? `<div><span class="contact-label">LinkedIn:</span><span>${esc(c.linkedin)}</span></div>` : ''}
        ${addr ? `<div><span class="contact-label">Địa chỉ:</span><span>${esc(addr)}</span></div>` : ''}
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

  ${cv.skills?.length ? `
    <h2>Kỹ năng</h2>
    <div class="skills">${cv.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('')}</div>
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
</body></html>`;
}
