import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, dateRangeLabel, avatarInner, joinAddress } from './types';

export function blueSidebarTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1a2533; background: #fff; }
  .layout { display: grid; grid-template-columns: 34% 66%; min-height: 100vh; }
  .sidebar { background: #1e3a5f; color: #e5edf5; padding: 32px 22px; }
  .main { padding: 32px 30px; }
  .avatar-wrap { display: flex; justify-content: center; margin-bottom: 18px; }
  .avatar { width: 124px; height: 124px; border-radius: 50%; background: linear-gradient(135deg, #4a78a8, #6a9bc8); display: flex; align-items: center; justify-content: center; font-size: 48pt; color: #fff; font-weight: 700; border: 3px solid rgba(255,255,255,0.15); overflow: hidden; }
  .sb-name { font-size: 16pt; font-weight: 700; color: #fff; text-align: center; margin-bottom: 4px; line-height: 1.25; }
  .sb-title { font-size: 9.5pt; color: #a8c2dd; text-align: center; margin-bottom: 18px; font-style: italic; }

  .sb-section { margin-top: 16px; }
  .sb-section h3 { font-size: 9.5pt; color: #88b0d4; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; font-weight: 700; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.15); }

  .sb-contact { font-size: 8.5pt; line-height: 1.7; color: #d0dde9; }
  .sb-contact div { display: flex; gap: 7px; margin-bottom: 3px; word-break: break-word; align-items: flex-start; }
  .sb-contact .ico { color: #88b0d4; flex-shrink: 0; font-weight: 700; min-width: 14px; }

  .sb-skills li { font-size: 9pt; color: #d0dde9; list-style: none; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
  .sb-skills li::before { content: ''; width: 5px; height: 5px; background: #88b0d4; border-radius: 50%; flex-shrink: 0; }

  .sb-extras { font-size: 9pt; color: #d0dde9; }
  .sb-extras .row { padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.12); }
  .sb-extras .row:last-child { border: none; }

  .main h2 { font-size: 11pt; color: #1e3a5f; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 12px; padding: 6px 0; border-bottom: 2px solid #1e3a5f; }
  .main h2:not(:first-child) { margin-top: 22px; }
  .summary { font-size: 10pt; color: #333; line-height: 1.7; margin-bottom: 8px; padding: 10px 14px; background: #f3f7fc; border-left: 3px solid #1e3a5f; }
  .item { padding: 6px 0 12px; margin-bottom: 6px; border-bottom: 1px dashed #d8e1ed; page-break-inside: avoid; }
  .item:last-child { border-bottom: none; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #1e3a5f; }
  .item-date { font-size: 9pt; color: #4a78a8; font-weight: 600; white-space: nowrap; background: #eaf2fb; padding: 2px 8px; border-radius: 3px; }
  .item-meta { font-size: 9.5pt; color: #4a78a8; margin-bottom: 4px; font-style: italic; font-weight: 600; }
  .item-desc { font-size: 9.5pt; color: #333; line-height: 1.65; }
  .item-desc ul { padding-left: 16px; }
  .item-desc li { margin-bottom: 2px; }
</style>
</head><body>
<div class="layout">
  <div class="sidebar">
    <div class="avatar-wrap"><div class="avatar">${avatar}</div></div>
    <div class="sb-name" data-f="name">${esc(cv.name || '')}</div>
    ${emp.current_title ? `<div class="sb-title" data-f="employment.current_title">${esc(emp.current_title)}</div>` : ''}

    <div class="sb-section">
      <h3>Liên hệ</h3>
      <div class="sb-contact">
        ${c.phone ? `<div><span class="ico">☎</span><span data-f="contact.phone">${esc(c.phone)}</span></div>` : ''}
        ${c.email ? `<div><span class="ico">✉</span><span data-f="contact.email">${esc(c.email)}</span></div>` : ''}
        ${c.linkedin ? `<div><span class="ico">in</span><span data-f="contact.linkedin">${esc(c.linkedin)}</span></div>` : ''}
        ${c.github ? `<div><span class="ico">gh</span><span data-f="contact.github">${esc(c.github)}</span></div>` : ''}
        ${c.portfolio ? `<div><span class="ico">⚲</span><span data-f="contact.portfolio">${esc(c.portfolio)}</span></div>` : ''}
        ${addr ? `<div><span class="ico">⌖</span>${esc(addr)}</div>` : ''}
        ${p.date_of_birth ? `<div><span class="ico">◷</span><span data-f="personal.date_of_birth">${esc(p.date_of_birth)}</span></div>` : ''}
        ${p.gender ? `<div><span class="ico">⚥</span>${esc(p.gender)}</div>` : ''}
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
        <div class="sb-extras">
          ${cv.education.map((e, i) => `
            <div class="row">
              <div style="font-weight:600; color:#fff;" data-f="education.${i}.institution">${esc(e.institution || '')}</div>
              <div style="color:#a8c2dd;" data-f="education.${i}.degree">${esc(e.degree || '')}</div>
              <div style="color:#88b0d4; font-size:8.5pt;" data-f="education.${i}.year">${esc(e.year || '')}</div>
            </div>
          `).join('')}
        </div>
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
        <div class="sb-extras">
          ${cv.certifications.map((ct, i) => `
            <div class="row">
              <div style="font-weight:600; color:#fff;" data-f="certifications.${i}.name">${esc(ct.name || '')}</div>
              ${ct.issuer ? `<div style="color:#a8c2dd;" data-f="certifications.${i}.issuer">${esc(ct.issuer)}</div>` : ''}
              ${ct.year ? `<div style="color:#88b0d4; font-size:8.5pt;" data-f="certifications.${i}.year">${esc(ct.year)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  </div>

  <div class="main">
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
            ${a.year ? `<div class="item-date" data-f="awards.${i}.year">${esc(a.year)}</div>` : ''}
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
</div>
</body></html>`;
}
