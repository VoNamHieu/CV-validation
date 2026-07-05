import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, dateRangeLabel, avatarInner, joinAddress } from './types';

export function elegantSerifTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #2e2a24; padding: 38px 50px; line-height: 1.6; font-size: 10.5pt; background: #fffdf9; }
  .header { text-align: center; margin-bottom: 22px; }
  .avatar { width: 116px; height: 116px; border-radius: 50%; background: #f0e8da; display: inline-flex; align-items: center; justify-content: center; font-size: 46pt; color: #b08d4f; font-weight: 700; border: 3px solid #b08d4f; overflow: hidden; margin-bottom: 12px; }
  .name { font-size: 24pt; font-weight: 700; color: #1f1b14; letter-spacing: 1px; margin-bottom: 4px; }
  .title { font-size: 11pt; color: #b08d4f; font-style: italic; margin-bottom: 10px; }
  .contact-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; font-size: 9.5pt; color: #5a5246; }
  .contact-row span.sep { color: #b08d4f; }
  .rule { border: none; border-top: 1px solid #d9cdb8; margin: 18px auto; width: 60%; position: relative; }
  h2 { font-size: 11.5pt; color: #1f1b14; text-align: center; text-transform: uppercase; letter-spacing: 4px; margin: 24px 0 4px; font-weight: 700; }
  .h2-deco { text-align: center; color: #b08d4f; font-size: 9pt; letter-spacing: 4px; margin-bottom: 14px; }
  .item { margin-bottom: 14px; page-break-inside: avoid; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #1f1b14; }
  .item-date { font-size: 9.5pt; color: #b08d4f; white-space: nowrap; font-style: italic; }
  .item-meta { font-size: 9.5pt; color: #6b6253; margin-bottom: 4px; font-style: italic; }
  .item-desc { font-size: 10pt; color: #3a352c; line-height: 1.7; }
  .item-desc ul { padding-left: 18px; }
  .item-desc li { margin-bottom: 2px; }
  .skills { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 8px; }
  .skill { border: 1px solid #d9cdb8; border-radius: 14px; padding: 3px 12px; font-size: 9.5pt; color: #5a5246; background: #fbf7ef; }
  .summary { color: #3a352c; font-size: 10.5pt; line-height: 1.8; text-align: center; max-width: 86%; margin: 0 auto; font-style: italic; }
</style>
</head><body>
  <div class="header">
    <div class="avatar">${avatar}</div>
    <div class="name" data-f="name">${esc(cv.name || '')}</div>
    ${emp.current_title ? `<div class="title" data-f="employment.current_title">${esc(emp.current_title)}</div>` : ''}
    <div class="contact-row">
      ${[
        c.phone ? `<span data-f="contact.phone">${esc(c.phone)}</span>` : '',
        c.email ? `<span data-f="contact.email">${esc(c.email)}</span>` : '',
        c.linkedin ? `<span data-f="contact.linkedin">${esc(c.linkedin)}</span>` : '',
        addr ? esc(addr) : '',
        p.date_of_birth ? `<span data-f="personal.date_of_birth">${esc(p.date_of_birth)}</span>` : '',
      ].filter(Boolean).join('<span class="sep"> ◆ </span>')}
    </div>
  </div>

  ${cv.summary ? `<h2>Mục tiêu nghề nghiệp</h2><div class="h2-deco">◆ ◆ ◆</div><p class="summary" data-f="summary">${esc(cv.summary)}</p>` : ''}

  ${cv.experience?.length ? `
    <h2>Kinh nghiệm làm việc</h2><div class="h2-deco">◆ ◆ ◆</div>
    ${cv.experience.map((e, i) => `
      <div class="item">
        <div class="item-top">
          <div class="item-title" data-f="experience.${i}.title">${esc(e.title)}</div>
          <div class="item-date" data-f="experience.${i}.daterange">${esc(dateRangeLabel(e))}</div>
        </div>
        <div class="item-meta" data-f="experience.${i}.company">${esc(e.company)}</div>
        <div class="item-desc">${descToBullets(e.description, `experience.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.education?.length ? `
    <h2>Học vấn</h2><div class="h2-deco">◆ ◆ ◆</div>
    ${cv.education.map((e, i) => `
      <div class="item">
        <div class="item-top">
          <div class="item-title" data-f="education.${i}.institution">${esc(e.institution || '')}</div>
          <div class="item-date" data-f="education.${i}.year">${esc(e.year || '')}</div>
        </div>
        <div class="item-meta" data-f="education.${i}.degree">${esc(e.degree || '')}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.skills?.length ? `
    <h2>Kỹ năng</h2><div class="h2-deco">◆ ◆ ◆</div>
    <div class="skills">${cv.skills.map((s, i) => `<span class="skill" data-f="skills.${i}">${esc(s)}</span>`).join('')}</div>
  ` : ''}

  ${cv.projects?.length ? `
    <h2>Dự án</h2><div class="h2-deco">◆ ◆ ◆</div>
    ${cv.projects.map((pj, i) => `
      <div class="item">
        <div class="item-title" data-f="projects.${i}.name">${esc(pj.name)}</div>
        <div class="item-desc">${descToBullets(pj.description, `projects.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}

  ${cv.certifications?.length ? `
    <h2>Chứng chỉ</h2><div class="h2-deco">◆ ◆ ◆</div>
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

  ${cv.languages?.length ? `
    <h2>Ngoại ngữ</h2><div class="h2-deco">◆ ◆ ◆</div>
    <div class="skills">${cv.languages.map((l, i) => `<span class="skill" data-f="languages.${i}">${esc(l.language)}${l.level ? `: ${esc(l.level)}` : ''}</span>`).join('')}</div>
  ` : ''}

  ${cv.awards?.length ? `
    <h2>Giải thưởng</h2><div class="h2-deco">◆ ◆ ◆</div>
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
    <h2>Hoạt động</h2><div class="h2-deco">◆ ◆ ◆</div>
    ${cv.activities.map((ac, i) => `
      <div class="item">
        <div class="item-title" data-f="activities.${i}.name">${esc(ac.name)}</div>
        <div class="item-desc">${descToBullets(ac.description, `activities.${i}.description`)}</div>
      </div>
    `).join('')}
  ` : ''}
</body></html>`;
}
