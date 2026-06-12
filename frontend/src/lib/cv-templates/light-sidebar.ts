import type { CVData } from '@/lib/types';
import type { RenderOptions } from './types';
import { esc, descToBullets, dateRangeLabel, avatarInner, joinAddress } from './types';

export function lightSidebarTemplate(cv: CVData, opts?: RenderOptions): string {
    const c = cv.contact ?? {} as Partial<NonNullable<CVData['contact']>>;
    const p = cv.personal ?? {} as Partial<NonNullable<CVData['personal']>>;
    const emp = cv.employment ?? {} as Partial<NonNullable<CVData['employment']>>;
    const addr = joinAddress(cv.contact);
    const avatar = avatarInner(cv.name, opts?.avatarBase64);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1f2d3d; background: #fff; }
  .layout { display: grid; grid-template-columns: 34% 66%; min-height: 100vh; }
  .sidebar { background: #f1f5f7; color: #1f2d3d; padding: 32px 22px; border-right: 1px solid #e2e8ec; }
  .main { padding: 32px 28px; }
  .avatar-wrap { display: flex; justify-content: center; margin-bottom: 16px; }
  .avatar { width: 124px; height: 124px; border-radius: 50%; background: linear-gradient(135deg, #5a8a9a, #7eb0c0); display: flex; align-items: center; justify-content: center; font-size: 48pt; color: #fff; font-weight: 700; border: 3px solid #fff; box-shadow: 0 0 0 1px #d0dde2; overflow: hidden; }

  .sb-name { font-size: 17pt; font-weight: 700; text-align: center; margin-bottom: 4px; line-height: 1.25; color: #1f2d3d; }
  .sb-title { font-size: 10pt; color: #5a8a9a; text-align: center; margin-bottom: 18px; font-style: italic; font-weight: 600; }

  .sb-section { margin-top: 18px; }
  .sb-section h3 { font-size: 9.5pt; color: #2a4a55; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; font-weight: 700; padding-bottom: 4px; border-bottom: 1.5px solid #5a8a9a; display: flex; align-items: center; gap: 6px; }
  .sb-section h3::before { content: ''; width: 8px; height: 8px; background: #5a8a9a; border-radius: 50%; flex-shrink: 0; }

  .sb-contact { font-size: 9pt; line-height: 1.7; color: #3a4a5a; }
  .sb-contact div { display: flex; gap: 7px; margin-bottom: 3px; word-break: break-word; align-items: flex-start; }
  .sb-contact .ico { color: #5a8a9a; flex-shrink: 0; font-weight: 700; min-width: 14px; }

  .sb-skills li { font-size: 9.5pt; color: #1f2d3d; list-style: none; padding: 4px 0; border-bottom: 1px dashed #d0dde2; }
  .sb-skills li:last-child { border: none; }

  .sb-edu { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #d0dde2; }
  .sb-edu:last-child { border: none; }
  .sb-edu-inst { font-weight: 600; font-size: 9.5pt; color: #2a4a55; }
  .sb-edu-degree { font-size: 9pt; color: #3a4a5a; }
  .sb-edu-year { font-size: 8.5pt; color: #5a8a9a; }

  .main h2 { font-size: 11pt; color: #2a4a55; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid #5a8a9a; }
  .main h2:not(:first-child) { margin-top: 22px; }
  .summary { font-size: 10pt; color: #333; line-height: 1.7; margin-bottom: 8px; padding: 12px 14px; background: #f1f5f7; border-left: 3px solid #5a8a9a; border-radius: 0 4px 4px 0; }
  .item { padding: 8px 0 12px; margin-bottom: 6px; border-bottom: 1px dashed #d0dde2; page-break-inside: avoid; }
  .item:last-child { border-bottom: none; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .item-title { font-weight: 700; font-size: 10.5pt; color: #2a4a55; }
  .item-date { font-size: 9pt; color: #5a8a9a; font-weight: 600; white-space: nowrap; }
  .item-meta { font-size: 9.5pt; color: #5a8a9a; margin-bottom: 4px; font-style: italic; font-weight: 600; }
  .item-desc { font-size: 9.5pt; color: #333; line-height: 1.65; }
  .item-desc ul { padding-left: 16px; }
  .item-desc li { margin-bottom: 2px; }
</style>
</head><body>
<div class="layout">
  <div class="sidebar">
    <div class="avatar-wrap"><div class="avatar">${avatar}</div></div>
    <div class="sb-name">${esc(cv.name || '')}</div>
    ${emp.current_title ? `<div class="sb-title">${esc(emp.current_title)}</div>` : ''}

    <div class="sb-section">
      <h3>Liên hệ</h3>
      <div class="sb-contact">
        ${c.phone ? `<div><span class="ico">☎</span>${esc(c.phone)}</div>` : ''}
        ${c.email ? `<div><span class="ico">✉</span>${esc(c.email)}</div>` : ''}
        ${c.linkedin ? `<div><span class="ico">in</span>${esc(c.linkedin)}</div>` : ''}
        ${c.github ? `<div><span class="ico">gh</span>${esc(c.github)}</div>` : ''}
        ${c.portfolio ? `<div><span class="ico">⚲</span>${esc(c.portfolio)}</div>` : ''}
        ${addr ? `<div><span class="ico">⌖</span>${esc(addr)}</div>` : ''}
        ${p.date_of_birth ? `<div><span class="ico">◷</span>${esc(p.date_of_birth)}</div>` : ''}
      </div>
    </div>

    ${cv.skills?.length ? `
      <div class="sb-section">
        <h3>Kỹ năng</h3>
        <ul class="sb-skills">
          ${cv.skills.map(s => `<li>${esc(s)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${cv.education?.length ? `
      <div class="sb-section">
        <h3>Học vấn</h3>
        ${cv.education.map(e => `
          <div class="sb-edu">
            <div class="sb-edu-inst">${esc(e.institution || '')}</div>
            <div class="sb-edu-degree">${esc(e.degree || '')}</div>
            <div class="sb-edu-year">${esc(e.year || '')}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${cv.languages?.length ? `
      <div class="sb-section">
        <h3>Ngoại ngữ</h3>
        <ul class="sb-skills">
          ${cv.languages.map(l => `<li>${esc(l.language)}${l.level ? ` — ${esc(l.level)}` : ''}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${cv.certifications?.length ? `
      <div class="sb-section">
        <h3>Chứng chỉ</h3>
        ${cv.certifications.map(ct => `
          <div class="sb-edu">
            <div class="sb-edu-inst">${esc(ct.name || '')}</div>
            ${ct.issuer ? `<div class="sb-edu-degree">${esc(ct.issuer)}</div>` : ''}
            ${ct.year ? `<div class="sb-edu-year">${esc(ct.year)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  </div>

  <div class="main">
    ${cv.summary ? `<h2>Mục tiêu nghề nghiệp</h2><div class="summary">${esc(cv.summary)}</div>` : ''}

    ${cv.experience?.length ? `
      <h2>Kinh nghiệm làm việc</h2>
      ${cv.experience.map(e => `
        <div class="item">
          <div class="item-top">
            <div class="item-title">${esc(e.title)}</div>
            <div class="item-date">${esc(dateRangeLabel(e))}</div>
          </div>
          <div class="item-meta">${esc(e.company)}</div>
          <div class="item-desc">${descToBullets(e.description)}</div>
        </div>
      `).join('')}
    ` : ''}

    ${cv.projects?.length ? `
      <h2>Dự án</h2>
      ${cv.projects.map(pj => `
        <div class="item">
          <div class="item-title">${esc(pj.name)}</div>
          <div class="item-desc">${descToBullets(pj.description)}</div>
        </div>
      `).join('')}
    ` : ''}

    ${cv.awards?.length ? `
      <h2>Giải thưởng</h2>
      ${cv.awards.map(a => `
        <div class="item">
          <div class="item-top">
            <div class="item-title">${esc(a.title)}</div>
            ${a.year ? `<div class="item-date">${esc(a.year)}</div>` : ''}
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
  </div>
</div>
</body></html>`;
}
