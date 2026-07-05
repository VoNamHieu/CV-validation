import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, dateRangeLabel, avatarInner, joinAddress } from './types';

export function slateRightTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #2a2a2a; background: #fff; }
  .layout { display: grid; grid-template-columns: 64% 36%; min-height: 100vh; }
  .main { padding: 32px 26px 32px 32px; }
  .sidebar { background: #3b4859; color: #e7ebf0; padding: 32px 22px; }
  .avatar-wrap { display: flex; justify-content: center; margin-bottom: 16px; }
  .avatar { width: 124px; height: 124px; border-radius: 50%; background: linear-gradient(135deg, #55657c, #76879f); display: flex; align-items: center; justify-content: center; font-size: 48pt; color: #fff; font-weight: 700; border: 4px solid rgba(255,255,255,0.14); overflow: hidden; }
  .sb-section { margin-top: 18px; }
  .sb-section h3 { font-size: 9.5pt; color: #b9c5d4; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid rgba(255,255,255,0.18); padding-bottom: 4px; margin-bottom: 8px; font-weight: 700; }
  .sb-contact { font-size: 9pt; line-height: 1.7; color: #d6dde6; }
  .sb-contact div { display: flex; gap: 6px; margin-bottom: 3px; word-break: break-word; align-items: flex-start; }
  .sb-contact .ico { color: #94a5ba; flex-shrink: 0; font-weight: 700; min-width: 16px; }
  .sb-skills { list-style: none; }
  .sb-skills li { font-size: 9.5pt; padding: 4px 0; color: #d6dde6; border-bottom: 1px dashed rgba(255,255,255,0.1); }
  .sb-skills li:last-child { border: none; }
  .sb-edu { margin-bottom: 10px; }
  .sb-edu .sb-edu-inst { font-weight: 600; font-size: 9.5pt; color: #fff; }
  .sb-edu .sb-edu-degree { font-size: 9pt; color: #c0cad7; }
  .sb-edu .sb-edu-year { font-size: 8.5pt; color: #94a5ba; }

  .hd-name { font-size: 21pt; font-weight: 700; color: #1d2733; margin-bottom: 2px; }
  .hd-title { font-size: 11pt; color: #5b6c82; font-style: italic; margin-bottom: 18px; }
  .main h2 { font-size: 11pt; color: #3b4859; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid #76879f; }
  .main h2:not(:first-of-type) { margin-top: 22px; }
  .summary { font-size: 10pt; color: #333; line-height: 1.7; margin-bottom: 8px; padding: 10px 12px; background: #f4f6f9; border-left: 3px solid #76879f; border-radius: 0 4px 4px 0; }
  .item { margin-bottom: 12px; page-break-inside: avoid; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 2px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #1a1a1a; }
  .item-date { font-size: 9pt; color: #76879f; font-weight: 600; white-space: nowrap; }
  .item-meta { font-size: 9.5pt; color: #555; margin-bottom: 5px; font-style: italic; }
  .item-desc { font-size: 9.5pt; color: #333; line-height: 1.6; }
  .item-desc ul { padding-left: 16px; }
  .item-desc li { margin-bottom: 2px; }
</style>
</head><body>
<div class="layout">
  <div class="main">
    <div class="hd-name" data-f="name">${esc(cv.name || '')}</div>
    ${emp.current_title ? `<div class="hd-title" data-f="employment.current_title">${esc(emp.current_title)}</div>` : ''}

    ${cv.summary ? `<h2>Mục tiêu nghề nghiệp</h2><div class="summary" data-f="summary">${esc(cv.summary)}</div>` : ''}

    ${cv.experience?.length ? `
      <h2>Kinh nghiệm làm việc</h2>
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

    ${cv.projects?.length ? `
      <h2>Dự án</h2>
      ${cv.projects.map((pj, i) => `
        <div class="item">
          <div class="item-title" data-f="projects.${i}.name">${esc(pj.name)}</div>
          <div class="item-desc">${descToBullets(pj.description, `projects.${i}.description`)}</div>
        </div>
      `).join('')}
    ` : ''}

    ${cv.awards?.length ? `
      <h2>Giải thưởng</h2>
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
      <h2>Hoạt động</h2>
      ${cv.activities.map((ac, i) => `
        <div class="item">
          <div class="item-title" data-f="activities.${i}.name">${esc(ac.name)}</div>
          <div class="item-desc">${descToBullets(ac.description, `activities.${i}.description`)}</div>
        </div>
      `).join('')}
    ` : ''}
  </div>

  <div class="sidebar">
    <div class="avatar-wrap"><div class="avatar">${avatar}</div></div>

    <div class="sb-section">
      <h3>Liên hệ</h3>
      <div class="sb-contact">
        ${c.phone ? `<div><span class="ico">☎</span><span data-f="contact.phone">${esc(c.phone)}</span></div>` : ''}
        ${c.email ? `<div><span class="ico">✉</span><span data-f="contact.email">${esc(c.email)}</span></div>` : ''}
        ${c.linkedin ? `<div><span class="ico">in</span><span data-f="contact.linkedin">${esc(c.linkedin)}</span></div>` : ''}
        ${c.github ? `<div><span class="ico">gh</span><span data-f="contact.github">${esc(c.github)}</span></div>` : ''}
        ${addr ? `<div><span class="ico">⌖</span>${esc(addr)}</div>` : ''}
        ${p.date_of_birth ? `<div><span class="ico">◷</span><span data-f="personal.date_of_birth">${esc(p.date_of_birth)}</span></div>` : ''}
      </div>
    </div>

    ${cv.skills?.length ? `
      <div class="sb-section">
        <h3>Kỹ năng</h3>
        <ul class="sb-skills">
          ${cv.skills.map((s, i) => `<li data-f="skills.${i}">${esc(s)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${cv.education?.length ? `
      <div class="sb-section">
        <h3>Học vấn</h3>
        ${cv.education.map((e, i) => `
          <div class="sb-edu">
            <div class="sb-edu-inst" data-f="education.${i}.institution">${esc(e.institution || '')}</div>
            <div class="sb-edu-degree" data-f="education.${i}.degree">${esc(e.degree || '')}</div>
            <div class="sb-edu-year" data-f="education.${i}.year">${esc(e.year || '')}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${cv.languages?.length ? `
      <div class="sb-section">
        <h3>Ngoại ngữ</h3>
        <ul class="sb-skills">
          ${cv.languages.map((l, i) => `<li data-f="languages.${i}">${esc(l.language)}${l.level ? `: ${esc(l.level)}` : ''}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${cv.certifications?.length ? `
      <div class="sb-section">
        <h3>Chứng chỉ</h3>
        ${cv.certifications.map((ct, i) => `
          <div class="sb-edu">
            <div class="sb-edu-inst" data-f="certifications.${i}.name">${esc(ct.name)}</div>
            ${ct.issuer ? `<div class="sb-edu-degree" data-f="certifications.${i}.issuer">${esc(ct.issuer)}</div>` : ''}
            ${ct.year ? `<div class="sb-edu-year" data-f="certifications.${i}.year">${esc(ct.year)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  </div>
</div>
</body></html>`;
}
