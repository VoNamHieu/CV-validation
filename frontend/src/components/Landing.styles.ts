export const LP_CSS = `
.lp-root { min-height: 100vh; position: relative; overflow-x: hidden; color: var(--text-primary); padding-top: 74px; }
/* Copo signature ground — warm, muted, low-saturation gradient (not the generic purple/blue AI wash) */
.lp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
  background:
    radial-gradient(72% 52% at 84% -8%, rgba(238,110,88,.15), transparent 56%),
    radial-gradient(66% 52% at 4% 104%, rgba(235,58,43,.09), transparent 60%),
    radial-gradient(58% 44% at 52% 110%, rgba(242,160,130,.07), transparent 62%),
    linear-gradient(158deg, #fdf4f1 0%, #fbf4f1 46%, #f9f4f1 100%); }
[data-theme="dark"] .lp-bg {
  background:
    radial-gradient(72% 52% at 84% -8%, rgba(238,110,88,.10), transparent 58%),
    radial-gradient(66% 52% at 4% 104%, rgba(235,58,43,.09), transparent 60%),
    linear-gradient(158deg, #161010 0%, #14100e 55%, #120f0e 100%); }
.lp-grid-overlay { position: absolute; inset: 0; background:
  linear-gradient(var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px,
  linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px;
  mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 35%, transparent 70%); opacity: 0.1; }
@keyframes lp-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,30px) scale(1.08); } }

.lp-nav, .lp-hero, .lp-stats, .lp-logos, .lp-featured, .lp-section, .lp-cta-band, .lp-footer { position: relative; z-index: 1; }
.lp-nav { position: fixed; top: 14px; left: 0; right: 0; z-index: 50; max-width: 1180px; margin: 0 auto; padding: 11px 14px 11px 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.28) 100%); -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  border: 1px solid rgba(255,255,255,0.55); border-radius: 20px; box-shadow: 0 6px 22px rgba(30,18,22,0.06), inset 0 1px 0 rgba(255,255,255,0.85);
  transition: max-width .45s var(--ease-out-expo), padding .35s ease, background .3s ease, box-shadow .3s ease, border-radius .3s ease, border-color .3s ease, backdrop-filter .3s ease, -webkit-backdrop-filter .3s ease; }
.lp-nav.is-scrolled { max-width: 1080px; padding: 9px 12px 9px 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.52) 100%); -webkit-backdrop-filter: blur(30px) saturate(2); backdrop-filter: blur(30px) saturate(2);
  border-color: rgba(255,255,255,0.66); border-radius: 16px; box-shadow: 0 16px 44px rgba(30,18,22,0.14), inset 0 1px 0 rgba(255,255,255,0.92); }
[data-theme="dark"] .lp-nav { background: rgba(22,20,26,0.34); border-color: rgba(255,255,255,0.08); }
[data-theme="dark"] .lp-nav.is-scrolled { background: rgba(22,20,26,0.62); border-color: rgba(255,255,255,0.12); box-shadow: 0 16px 44px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08); }
.lp-nav-links { display: flex; align-items: center; gap: 4px; position: relative; }
.lp-nav-links a { position: relative; z-index: 1; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-decoration: none; padding: 8px 15px; border-radius: 10px; transition: color .25s ease; }
.lp-nav-links a:hover { color: #c43b2e; }
.lp-nav-links a.is-active { color: #c43b2e; }
/* liquid-glass scroll-spy indicator — a single capsule that morphs between
   links as the active section changes (geometry from JS, spring transition).
   Material = refractive blur + white specular top edge + red sheen + glow. */
.lp-nav-pill { position: absolute; z-index: 0; border-radius: 999px; pointer-events: none; overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 40%, rgba(235,58,43,0.16) 100%),
    rgba(235,58,43,0.08);
  border: 1px solid rgba(255,255,255,0.55);
  box-shadow:
    inset 0 1px 0.5px rgba(255,255,255,0.95),        /* top specular highlight */
    inset 0 -7px 11px -7px rgba(196,59,46,0.45),      /* bottom inner depth */
    inset 0 0 0 1px rgba(235,58,43,0.16),             /* colored rim */
    0 5px 16px rgba(235,58,43,0.26),                  /* outer colored glow */
    0 1px 2px rgba(20,24,29,0.10);
  -webkit-backdrop-filter: blur(11px) saturate(1.9); backdrop-filter: blur(11px) saturate(1.9);
  transition: left .5s var(--ease-spring), width .5s var(--ease-spring), top .5s var(--ease-spring), height .5s var(--ease-spring), opacity .3s ease; }
/* diagonal glass glare sweeping across the top-left — the "wet" liquid sheen */
.lp-nav-pill::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(120deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.12) 22%, transparent 46%); }
.lp-brand { display: flex; align-items: center; gap: 10px; }
.lp-logo { width: 34px; height: 34px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 3px; overflow: hidden; box-shadow: 0 4px 14px rgba(20,20,45,0.14); }
.lp-logo-mark { width: 100%; height: 100%; object-fit: contain; display: block; }
.lp-logo-sm { width: 24px; height: 24px; border-radius: 7px; }
.lp-brand-name { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.02em; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

/* Primary = the brand seal itself (the one action colour), with a tactile
   top-light + layered seal shadow so it reads crafted, not a flat black chip. */
.lp-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none; cursor: pointer; font-weight: 700; color: #fff; background: linear-gradient(180deg, #cf4331 0%, #b5301f 100%); border-radius: 11px; padding: 11px 19px; font-size: 0.86rem; box-shadow: inset 0 1px 0 rgba(255,255,255,0.26), 0 1px 2px rgba(120,30,22,0.45), 0 8px 20px rgba(196,59,46,0.26); transition: transform .2s var(--ease-spring), box-shadow .2s ease, filter .2s ease; }
[data-theme="dark"] .lp-btn-primary { background: linear-gradient(180deg, #e8604f 0%, #c43b2e 100%); }
.lp-btn-primary:hover { transform: translateY(-2px); filter: saturate(1.05) brightness(1.04); box-shadow: inset 0 1px 0 rgba(255,255,255,0.26), 0 2px 4px rgba(120,30,22,0.4), 0 14px 30px rgba(196,59,46,0.42); }
.lp-btn-primary:active { transform: translateY(0); }
/* Secondary = crisp editorial outline that reacts in the brand seal on hover. */
.lp-btn-ghost { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 0.86rem; color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 11px; padding: 10px 16px; transition: border-color .2s, color .2s, background .2s, transform .2s; }
.lp-btn-ghost:hover { border-color: #c43b2e; color: #c43b2e; background: rgba(196,59,46,0.05); transform: translateY(-1px); }
.lp-btn-lg { padding: 14px 26px; font-size: 0.95rem; border-radius: 12px; }
.lp-pulse { position: relative; }
.lp-pulse::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 0 rgba(230,60,45,0.5); animation: lp-pulse 2.6s ease-out infinite; }
@keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 rgba(230,60,45,0.45); } 70%,100% { box-shadow: 0 0 0 18px rgba(230,60,45,0); } }

.lp-hero { max-width: 1460px; margin: 0 auto; padding: 40px 52px 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 46px; align-items: center; }
.lp-hero-copy { padding-left: 40px; animation: lp-rise .7s var(--ease-out-expo) both; }
.lp-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 0.76rem; font-weight: 600; color: #c43b2e; background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); border: 1px solid var(--border-subtle); padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
.lp-h1 { font-size: clamp(2.1rem, 4.8vw, 3.5rem); font-weight: 800; line-height: 1.16; letter-spacing: -0.03em; margin: 0 0 18px; }
.lp-grad-text { background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-sub { font-size: 1.02rem; color: var(--text-secondary); line-height: 1.6; max-width: 520px; margin: 0 0 28px; }
.lp-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.lp-trust { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
.lp-trust svg { color: var(--accent-green); }
.lp-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); margin: 0 4px; }

/* Product mockup — CV↔job analysis dashboard (glass frame + 3 cols, all CSS/SVG) */
.lp-mock-wrap { position: relative; display: flex; justify-content: flex-end; overflow: visible; perspective: 2400px; animation: lp-rise .7s var(--ease-out-expo) .12s both; }
/* mesh glow behind — irregular multi-hue blobs, heavy blur → melt unevenly */
.lp-mock-glow { position: absolute; inset: -16% -8% -18% -8%; z-index: -1; border-radius: 90px; filter: blur(66px); background:
  radial-gradient(34% 40% at 24% 32%, rgba(230,60,45,.30), transparent 60%),
  radial-gradient(30% 36% at 66% 18%, rgba(220,55,42,.26), transparent 62%),
  radial-gradient(40% 46% at 86% 60%, rgba(245,150,125,.28), transparent 60%),
  radial-gradient(32% 40% at 42% 84%, rgba(235,80,60,.24), transparent 62%),
  radial-gradient(26% 30% at 58% 48%, rgba(240,120,100,.22), transparent 58%),
  radial-gradient(24% 28% at 12% 70%, rgba(230,90,70,.16), transparent 60%); transition: transform .6s var(--ease-out-expo), filter .6s ease, opacity .6s ease; }
.lp-mock-wrap:hover .lp-mock-glow { transform: scale(1.05); filter: blur(72px) saturate(1.05); }
/* frosted-glass frame */
.lp-frame { padding: 16px; border-radius: 32px; border: 1px solid rgba(255,255,255,.7);
  transform: rotateY(-5deg) rotateX(1.5deg); transform-origin: center; transition: transform .55s var(--ease-out-expo), box-shadow .55s var(--ease-out-expo);
  background: linear-gradient(180deg, rgba(255,255,255,.55), rgba(255,255,255,.30));
  box-shadow: 0 50px 110px rgba(220,55,42,.22), 0 12px 34px rgba(80,60,150,.12), inset 0 1px 0 rgba(255,255,255,.85);
  backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%); }
.lp-mock-wrap:hover .lp-frame { transform: rotateY(-1.5deg) rotateX(.5deg) translateY(-8px) scale(1.012); box-shadow: 0 66px 140px rgba(220,55,42,.30), 0 18px 44px rgba(80,60,150,.17), inset 0 1px 0 rgba(255,255,255,.92); }
/* dashboard card — stacked radial surface, light (product screenshot) */
.lp-dash { position: relative; width: 700px; overflow: hidden; border-radius: 22px; border: 1px solid rgba(24,20,26,.09); padding: 24px 26px; color: #211d22;
  background:
    radial-gradient(120% 90% at 100% -6%, rgba(235,58,43,.07), transparent 55%),
    linear-gradient(180deg, #fdf7f5, #fbf2f0);
  box-shadow: 0 30px 66px rgba(30,18,22,.16), 0 6px 16px rgba(30,18,22,.07), inset 0 1px 0 rgba(255,255,255,.85); }
.lp-hd { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
.lp-hd-logo { width: 24px; height: 24px; border-radius: 7px; background: #20222e; color: #fff; display: grid; place-items: center; font-size: .56rem; font-weight: 800; overflow: hidden; }
.lp-hd-co { font-size: .8rem; font-weight: 700; }
.lp-hd-sep { color: #a3a4bb; }
.lp-hd-role { font-size: .76rem; font-weight: 600; color: #c43b2e; background: #fdeeea; padding: 5px 11px; border-radius: 8px; }
.lp-hd-sp { flex: 1; }
.lp-hd-bk { width: 26px; height: 26px; border-radius: 8px; background: #fdefeb; display: grid; place-items: center; color: #f6a58f; font-size: .8rem; }
/* two parallel feature panels inside the modal — slightly separated */
.lp-split { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; align-items: stretch; }
.lp-panel { position: relative; border: 1px solid rgba(24,20,26,.08); border-radius: 15px; padding: 15px 16px;
  background: #ffffff; box-shadow: 0 6px 18px rgba(30,18,22,.06), inset 0 1px 0 #fff; }
.lp-panel-apply { background: #ffffff; }
.lp-panel-hd { display: flex; align-items: center; gap: 7px; font-size: .69rem; font-weight: 800; color: #26283a; letter-spacing: .2px; margin-bottom: 15px; }
.lp-panel-hd .lp-apc-count { margin-left: auto; }
.lp-panel-tag { margin-left: auto; font-size: .57rem; font-weight: 800; color: #12a678; background: rgba(18,166,120,.12); padding: 2px 8px; border-radius: 999px; text-transform: none; }
.lp-live { width: 6px; height: 6px; border-radius: 50%; background: #12a678; box-shadow: 0 0 0 3px rgba(18,166,120,.16); animation: lp-apply-pulse 1.4s infinite; flex-shrink: 0; }
.lp-grid2 { display: grid; grid-template-columns: 0.82fr 1fr; gap: 18px; align-items: start; }
.lp-grid3 { display: grid; grid-template-columns: 0.82fr 1fr 0.86fr; gap: 24px; align-items: start; }
.lp-lbl { font-size: .7rem; font-weight: 700; color: #6f7188; letter-spacing: .3px; margin-bottom: 12px; }
.lp-donut { position: relative; width: 138px; height: 138px; border-radius: 50%; display: grid; place-items: center; filter: drop-shadow(0 10px 24px rgba(235,58,43,.28)); transition: transform .3s var(--ease-out-expo), filter .3s ease;
  background: conic-gradient(from 188deg, #c43b2e 0%, #f2694e 20%, #f79b7f 38%, #f27a5e 52%, #f4996f 66%, #c43b2e 78%, #f6e3dd 78% 100%); }
.lp-donut::before { content: ''; position: absolute; width: 106px; height: 106px; border-radius: 50%; box-shadow: inset 0 1px 3px rgba(235,58,43,.10);
  background: radial-gradient(80% 80% at 32% 24%, #fff, transparent 60%), radial-gradient(90% 90% at 70% 82%, rgba(242,130,105,.12), transparent 62%), #fffbf9; }
.lp-donut-num { position: relative; font-size: 2.1rem; font-weight: 800; letter-spacing: -.03em; }
.lp-donut-num small { font-size: .9rem; color: #a3a4bb; font-weight: 700; }
.lp-dash:hover .lp-donut { transform: scale(1.03); filter: drop-shadow(0 16px 32px rgba(235,58,43,.36)); }
.lp-delta { font-size: .72rem; font-weight: 700; color: #12a678; margin: 12px 0 9px; }
.lp-chips2 { display: flex; gap: 6px; flex-wrap: wrap; }
.lp-chip { display: inline-flex; align-items: center; gap: 4px; font-size: .66rem; font-weight: 600; padding: 5px 10px; border-radius: 999px; }
.lp-chip-purple { color: #c43b2e; background: #fdece8; }
.lp-chip-soft { color: #6b6d84; background: #fdefeb; }
.lp-ats2 { margin-top: 26px; }
.lp-ats-row2 { display: flex; align-items: baseline; gap: 10px; }
.lp-ats-num2 { font-size: 2rem; font-weight: 800; letter-spacing: -.02em; }
.lp-ats-num2 small { font-size: .9rem; color: #a3a4bb; font-weight: 700; }
.lp-ats-good { margin-left: auto; font-size: .73rem; font-weight: 700; color: #12a678; display: flex; align-items: center; gap: 5px; }
.lp-gdot { width: 7px; height: 7px; border-radius: 50%; background: #12a678; }
.lp-improve { margin-top: 8px; font-size: .72rem; font-weight: 600; color: #c43b2e; }
.lp-sk-row { display: flex; align-items: center; gap: 11px; margin-bottom: 13px; transition: transform .2s ease; }
.lp-sk-row:hover { transform: translateX(3px); }
.lp-sk-row:hover .lp-sk-track span { filter: brightness(1.06) saturate(1.1); }
.lp-sk-ic2 { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center; font-size: .54rem; font-weight: 800; color: #c43b2e; letter-spacing: .3px;
  background: radial-gradient(90% 90% at 28% 18%, #fff, transparent 62%), radial-gradient(120% 120% at 90% 100%, rgba(242,130,105,.22), transparent 60%), #fdece8; box-shadow: inset 0 0 0 1px rgba(235,58,43,.06); }
.lp-sk-b { flex: 1; min-width: 0; }
.lp-sk-top { display: flex; justify-content: space-between; margin-bottom: 6px; }
.lp-sk-name { font-size: .77rem; font-weight: 600; }
.lp-sk-pct { font-size: .73rem; font-weight: 700; color: #6b6d84; }
.lp-sk-track { height: 6px; border-radius: 999px; background: #f6e3dd; overflow: hidden; }
.lp-sk-track span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ec5540, #f2694e); }
.lp-cv { align-self: stretch; border: 1px solid rgba(235,58,43,.10); border-radius: 14px; padding: 15px;
  background: radial-gradient(120% 70% at 100% 0%, rgba(242,130,105,.14), transparent 55%), radial-gradient(90% 60% at 0% 100%, rgba(245,155,130,.10), transparent 60%), linear-gradient(180deg,#fff,#fff9f7);
  box-shadow: 0 14px 34px rgba(220,55,42,.14), inset 0 1px 0 rgba(255,255,255,.9); }
.lp-cv-hd { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; }
.lp-cv-av { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg,#f2694e,#c43b2e); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: .72rem; }
.lp-cv-name { font-size: .82rem; font-weight: 800; }
.lp-cv-role { font-size: .62rem; color: #a3a4bb; margin-top: 1px; }
.lp-cv-sec { font-size: .58rem; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #f6a58f; margin: 11px 0 7px; }
.lp-ln { height: 6px; border-radius: 999px; background: #f6e3dd; margin-bottom: 6px; }
.lp-exp { display: flex; gap: 7px; margin-bottom: 10px; }
.lp-exp-d { width: 7px; height: 7px; border-radius: 50%; background: #f6a58f; margin-top: 2px; flex-shrink: 0; }
.lp-exp-l { flex: 1; }
/* auto-apply column inside the hero dashboard */
.lp-apc-head { display: flex; align-items: center; justify-content: space-between; font-size: .7rem; font-weight: 800; color: #26283a; margin-bottom: 11px; }
.lp-apc-count { font-size: .64rem; font-weight: 700; color: #c43b2e; background: #fdece8; padding: 2px 8px; border-radius: 999px; }
.lp-apc-row { display: flex; align-items: center; gap: 9px; padding: 9px 8px; margin: 0 -8px; border-radius: 8px; border-top: 1px solid #f0eef7; transition: background .2s ease, transform .2s ease; }
.lp-apc-row:hover { background: #f5f2fe; transform: translateX(3px); }
.lp-apc-row:hover .lp-apc-logo { transform: scale(1.06); }
.lp-apc-row:first-of-type { border-top: none; padding-top: 2px; }
.lp-apc-logo { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; transition: transform .2s ease; display: grid; place-items: center; font-size: .52rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #f2694e, #c43b2e); overflow: hidden; }
.lp-apc-co { flex: 1; min-width: 0; font-size: .74rem; font-weight: 600; color: #26283a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-apc-st { display: inline-flex; align-items: center; gap: 4px; font-size: .62rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.lp-apc-done { color: #12a678; background: rgba(18,166,120,.12); }
.lp-apc-doing { color: #d97706; background: rgba(217,119,6,.13); }
.lp-apc-queue { color: #a3a4bb; background: #f3f2f8; }
.lp-apc-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: lp-apply-pulse 1s infinite; }
.lp-apc-opt { color: #c43b2e; background: rgba(220,55,42,.12); }
.lp-apc-spin { width: 11px; height: 11px; border-radius: 50%; box-sizing: border-box; border: 2px solid rgba(217,119,6,.28); border-top-color: #d97706; animation: lp-sweep .7s linear infinite; }
.lp-apc-spin-p { border-color: rgba(220,55,42,.26); border-top-color: #c43b2e; }
/* shared by the animated walkthrough demo (lp-demo-frame) further down the page */
.lp-mock-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-mock-dot { width: 10px; height: 10px; border-radius: 50%; }
.lp-mock-url { margin-left: 10px; font-size: 0.72rem; color: var(--text-muted); }
.lp-mock-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.lp-mock-score { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px dashed var(--border-subtle); }
.lp-ring { position: relative; width: 76px; height: 76px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: conic-gradient(#c43b2e 0% 92%, var(--border-subtle) 92% 100%); }
.lp-ring::before { content: ''; position: absolute; width: 60px; height: 60px; border-radius: 50%; background: var(--bg-card); }
.lp-ring-num { position: relative; font-weight: 800; font-size: 1.25rem; color: var(--text-primary); }
.lp-ring-num small { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); }
.lp-mock-role { font-weight: 700; font-size: 0.95rem; }
.lp-mock-co { display: flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text-muted); margin: 3px 0 7px; }
.lp-chip-green { color: var(--accent-green); background: color-mix(in srgb, var(--accent-green) 14%, transparent); }
.lp-job { display: flex; align-items: center; gap: 12px; }
.lp-job-info { flex: 1; min-width: 0; }
.lp-job-title { display: block; font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-job-meta { font-size: 0.7rem; color: var(--text-muted); }
.lp-bar { width: 84px; height: 6px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; flex-shrink: 0; }
.lp-bar span { display: block; height: 100%; border-radius: 999px; }
.lp-job-score { font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); width: 34px; text-align: right; }

/* Stats */
.lp-stats { max-width: 800px; margin: 26px auto; padding: 22px 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-glass); backdrop-filter: blur(10px); }
.lp-stat { text-align: center; }
.lp-stat-val { font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-stat-label { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }

/* Featured logos marquee */
.lp-logos { max-width: 1460px; margin: 26px auto 0; padding: 8px 52px 52px 92px; text-align: left; }
.lp-logos-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-muted); margin: 0 0 16px; }
.lp-logos-carousel { position: relative; }
.lp-logos-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border-default); background: var(--bg-card); color: var(--text-secondary); font-size: 1.15rem; line-height: 1; cursor: pointer; display: grid; place-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.08); transition: border-color .2s, color .2s, transform .2s; }
.lp-logos-arrow-l { left: -6px; }
.lp-logos-arrow-r { right: -6px; }
.lp-logos-arrow:hover { border-color: #c43b2e; color: #c43b2e; transform: translateY(-50%) scale(1.08); }
.lp-logo-row { display: flex; align-items: center; gap: 76px; min-width: 0; overflow-x: auto; scroll-behavior: smooth; padding: 6px 0; scrollbar-width: none; -ms-overflow-style: none;
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent);
  mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent); }
.lp-logo-row[data-scrolled="true"] {
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 93%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 5%, #000 93%, transparent); }
.lp-logo-row::-webkit-scrollbar { display: none; }
.lp-marquee { position: relative; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
.lp-marquee-track { display: flex; align-items: center; width: max-content; animation: lp-scroll 45s linear infinite; }
.lp-marquee:hover .lp-marquee-track { animation-play-state: paused; }
.lp-logo-cell { flex: 0 0 auto; height: 42px; display: flex; align-items: center; justify-content: center; }
.lp-logo-img { height: 30px; width: auto; max-width: 192px; object-fit: contain; filter: grayscale(1); opacity: 0.62; transition: transform .2s ease, filter .25s ease, opacity .25s ease; }
.lp-logo-cell:hover .lp-logo-img { transform: scale(1.06); filter: none; opacity: 1; }
.lp-logo-text { font-weight: 800; font-size: 1.32rem; letter-spacing: -0.01em; color: var(--text-secondary); white-space: nowrap; opacity: 0.75; }
.lp-logo-cell:hover .lp-logo-text { color: var(--text-primary); opacity: 1; }
.lp-logos-disclaim { font-size: 0.6rem; color: var(--text-muted); opacity: 0.5; margin: 20px 0 0; text-align: center; padding-right: 40px; line-height: 1.5; }
/* Featured opportunities */
.lp-featured { max-width: 1460px; margin: 10px auto 0; padding: 44px 52px 8px 92px; }
.lp-featured-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.lp-featured-title { margin: 0 0 5px; text-align: left; font-size: clamp(1.4rem, 2.6vw, 1.9rem); font-weight: 800; color: #1b1720; }
.lp-featured-sub { font-size: 0.9rem; color: var(--text-muted); margin: 0; }
.lp-featured-all { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; font-weight: 700; color: #c43b2e; background: none; border: none; cursor: pointer; padding: 6px 2px; transition: gap .2s ease; text-decoration: none; }
.lp-featured-all:hover { gap: 10px; }
.lp-jobs-carousel { position: relative; }
.lp-jobs-row { display: flex; gap: 20px; overflow-x: auto; scroll-behavior: smooth; padding: 6px 2px 20px; scrollbar-width: none; -ms-overflow-style: none; }
.lp-jobs-row::-webkit-scrollbar { display: none; }
.lp-job-card { flex: 0 0 300px; width: 300px; border-radius: 18px; overflow: hidden; background: #fff; text-decoration: none; color: inherit; border: 1px solid rgba(24,20,26,.08); box-shadow: 0 10px 30px rgba(30,18,22,.07); transition: transform .25s var(--ease-out-expo), box-shadow .25s ease; cursor: pointer; }
.lp-job-card:hover { transform: translateY(-4px); box-shadow: 0 22px 46px rgba(30,18,22,.14); }
.lp-job-banner { position: relative; height: 110px; display: flex; align-items: center; justify-content: center; padding: 16px 18px; overflow: hidden; }
.lp-job-badge { position: absolute; top: 12px; left: 12px; z-index: 1; font-size: 0.64rem; font-weight: 700; color: #211d22; background: rgba(255,255,255,.85); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); padding: 4px 10px; border-radius: 999px; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
/* company logo as the banner hero image */
.lp-job-logo-img { max-width: 66%; max-height: 56px; object-fit: contain; filter: drop-shadow(0 6px 16px rgba(30,18,22,.16)); transition: transform .25s var(--ease-out-expo); }
.lp-job-card:hover .lp-job-logo-img { transform: scale(1.05); }
.lp-job-mono { font-size: 2.4rem; font-weight: 800; color: #c43b2e; opacity: .9; }
.lp-job-body { padding: 15px 16px 16px; }
.lp-job-title { font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 5px; line-height: 1.28; color: #1b1720; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.56em; }
.lp-job-meta { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 13px; }
.lp-job-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.lp-job-tags span { font-size: 0.68rem; font-weight: 600; color: #6b6d84; background: #f4f0ef; padding: 4px 9px; border-radius: 7px; }
.lp-job-foot { display: flex; align-items: center; gap: 7px; font-size: 0.74rem; font-weight: 700; color: #12a678; }
.lp-job-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
@keyframes lp-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* Sections */
.lp-section { max-width: 1000px; margin: 0 auto; padding: 56px 24px; text-align: center; }
.lp-h2 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.025em; margin: 0 0 10px; }
.lp-section-sub { font-size: 0.92rem; color: var(--text-muted); max-width: 460px; margin: 0 auto 36px; }
/* Auto-apply-while-optimizing section */
.lp-apply-viz { max-width: 880px; margin: 0 auto; display: grid; grid-template-columns: 0.82fr 1.18fr; gap: 20px; align-items: stretch; text-align: left; }
.lp-apply-cv, .lp-apply-jobs { background: var(--bg-card); border: 1px solid var(--border-default); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow-card); }
.lp-ac-head, .lp-aj-head { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; margin-bottom: 14px; }
.lp-ac-head { color: #c43b2e; }
.lp-ac-head svg { flex-shrink: 0; }
.lp-ac-line { height: 8px; border-radius: 999px; background: var(--border-subtle); margin-bottom: 9px; }
.lp-ac-line.is-hl { background: color-mix(in srgb, #c43b2e 30%, var(--border-subtle)); }
.lp-ac-prog { margin-top: 18px; }
.lp-ac-prog-label { display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 7px; }
.lp-ac-prog-label span:last-child { color: var(--accent-green); font-weight: 700; }
.lp-ac-bar { height: 7px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; }
.lp-ac-bar span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); animation: lp-ac-grow 2.6s var(--ease-out-expo) infinite alternate; }
@keyframes lp-ac-grow { from { width: 54%; } to { width: 88%; } }
.lp-aj-head { justify-content: space-between; }
.lp-aj-count { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }
.lp-aj-row { display: flex; align-items: center; gap: 11px; padding: 9px 0; border-top: 1px solid var(--border-subtle); }
.lp-aj-row:first-of-type { border-top: none; padding-top: 0; }
.lp-aj-logo { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center; font-size: 0.6rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); }
.lp-aj-info { flex: 1; min-width: 0; }
.lp-aj-title { font-size: 0.8rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-aj-co { font-size: 0.68rem; color: var(--text-muted); }
.lp-aj-status { display: inline-flex; align-items: center; gap: 5px; font-size: 0.7rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.lp-aj-done { color: var(--accent-green); background: color-mix(in srgb, var(--accent-green) 13%, transparent); }
.lp-aj-doing { color: var(--accent-amber); background: color-mix(in srgb, var(--accent-amber) 14%, transparent); }
.lp-aj-queue { color: var(--text-muted); background: var(--bg-elevated); }
.lp-aj-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.lp-aj-doing .lp-aj-dot { animation: lp-apply-pulse 1s infinite; }
@keyframes lp-apply-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.lp-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.lp-step { position: relative; text-align: left; padding: 24px 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--bg-card); transition: transform .25s, border-color .25s; }
.lp-step:hover { transform: translateY(-4px); border-color: var(--border-accent); }
.lp-step-num { position: absolute; top: 16px; right: 18px; font-size: 1.6rem; font-weight: 800; color: var(--border-default); }
.lp-step-icon, .lp-feature-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; margin-bottom: 14px; color: #fff; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); box-shadow: 0 6px 18px rgba(235,80,60,0.32); }
.lp-step-title { font-weight: 700; font-size: 1rem; margin-bottom: 6px; }
.lp-step-desc, .lp-feature-desc { font-size: 0.83rem; color: var(--text-muted); line-height: 1.55; }

/* How it works — connected step flow */
.lp-how-flow { display: flex; gap: 8px; margin-top: 12px; }
.lp-how-step { position: relative; flex: 1; padding: 0 12px; text-align: center; }
.lp-how-step:not(:last-child)::after { content: ''; position: absolute; top: 28px; left: calc(50% + 36px); right: calc(-50% + 36px); height: 2px; background: linear-gradient(90deg, var(--border-accent), var(--border-subtle)); }
.lp-how-badge { position: relative; width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); box-shadow: 0 8px 22px rgba(235,80,60,0.35); }
.lp-how-num { position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-default); color: var(--text-primary); font-size: 0.72rem; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.lp-how-title { font-weight: 700; font-size: 0.98rem; margin-bottom: 6px; }
.lp-how-desc { font-size: 0.83rem; color: var(--text-muted); line-height: 1.55; max-width: 220px; margin: 0 auto; }
@media (max-width: 880px) {
  .lp-how-flow { flex-direction: column; gap: 26px; max-width: 360px; margin: 12px auto 0; }
  .lp-how-step { padding: 0; }
  .lp-how-step:not(:last-child)::after { display: none; }
  .lp-how-desc { max-width: none; }
}

.lp-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: left; }
.lp-feature { padding: 22px 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--gradient-card), var(--bg-card); transition: transform .25s var(--ease-spring), border-color .25s, box-shadow .25s; }
.lp-feature:hover { transform: translateY(-5px); border-color: var(--border-accent); box-shadow: var(--shadow-card-hover); }
.lp-feature-icon { width: 40px; height: 40px; border-radius: 11px; }
.lp-feature-title { font-weight: 700; font-size: 0.95rem; margin-bottom: 6px; }

/* CTA band */
.lp-cta-band { max-width: 1000px; margin: 20px auto 0; padding: 0 24px; }
.lp-cta-inner { border-radius: 24px; padding: 52px 32px; text-align: center; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); position: relative; overflow: hidden; box-shadow: 0 24px 60px rgba(235,80,60,0.4); }
.lp-cta-inner::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 0%, rgba(255,255,255,0.25), transparent 55%); }
.lp-cta-title { position: relative; font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-weight: 800; color: #fff; margin: 0 0 8px; letter-spacing: -0.02em; }
.lp-cta-desc { position: relative; color: rgba(255,255,255,0.9); font-size: 0.95rem; margin: 0 0 24px; }
.lp-cta-band .lp-btn-primary { position: relative; background: #fff; color: #9a2a20; box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
.lp-cta-band .lp-btn-primary:hover { box-shadow: 0 14px 40px rgba(0,0,0,0.28); }

.lp-footer { max-width: 1000px; margin: 0 auto; padding: 40px 24px 48px; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 0.78rem; color: var(--text-muted); }
.lp-footer-links { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.lp-footer-links a { color: var(--text-secondary); text-decoration: none; font-weight: 500; }
.lp-footer-links a:hover { color: var(--text-primary); }

@keyframes lp-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

/* ── Demo player ───────────────────────────────────────────── */
.lp-demo-wrap { max-width: 720px; margin: 48px auto 0; }
.lp-demo-frame { border-radius: 18px; border: 1px solid var(--border-default); background: var(--bg-card); box-shadow: var(--shadow-card-hover), 0 30px 80px rgba(0,0,0,0.16); overflow: hidden; text-align: left; }
.lp-demo-frame .lp-mock-bar { position: relative; }
.lp-demo-play { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--border-default); background: var(--bg-glass); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color .2s, border-color .2s; }
.lp-demo-play:hover { color: var(--text-primary); border-color: var(--border-accent); }
.lp-demo-stage { position: relative; height: 300px; padding: 22px; }
.lp-scene { position: absolute; inset: 22px; opacity: 0; transform: translateY(10px) scale(.99); pointer-events: none; transition: opacity .45s ease, transform .45s var(--ease-out-expo); display: flex; flex-direction: column; justify-content: center; }
.lp-scene.is-on { opacity: 1; transform: none; pointer-events: auto; }

/* Scene 1 — upload */
.lp-drop { display: flex; flex-direction: column; gap: 14px; align-items: center; }
.lp-drop-card { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; max-width: 380px; padding: 14px 16px; border-radius: 13px; border: 1px dashed var(--border-accent); background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); color: #c43b2e; overflow: hidden; }
.lp-drop-name { font-weight: 700; font-size: 0.86rem; color: var(--text-primary); }
.lp-drop-meta { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }
.lp-scan-line { position: absolute; left: 0; top: 0; width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #c43b2e, transparent); animation: lp-scanline 1.8s ease-in-out infinite; }
@keyframes lp-scanline { 0% { transform: translateY(0); } 50% { transform: translateY(54px); } 100% { transform: translateY(0); } }
.lp-chips { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; max-width: 420px; }
.lp-chip2 { display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-subtle); padding: 4px 10px; border-radius: 999px; opacity: 0; animation: lp-pop .4s var(--ease-spring) forwards; }
.lp-chip2 svg { color: var(--accent-green); }
@keyframes lp-pop { from { opacity: 0; transform: scale(.8) translateY(6px); } to { opacity: 1; transform: none; } }
.lp-role-out { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.lp-role-out b { color: var(--text-primary); }
.lp-role-out svg { color: #c43b2e; }

/* Scene 2 — search everywhere */
.lp-search { display: flex; align-items: center; gap: 26px; }
.lp-radar { position: relative; width: 110px; height: 110px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #c43b2e; background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); border: 1px solid var(--border-subtle); }
.lp-ping { position: absolute; inset: 0; border-radius: 50%; border: 2px solid #c43b2e; opacity: 0; animation: lp-ping 2.4s ease-out infinite; }
.lp-ping-2 { animation-delay: 1.2s; }
@keyframes lp-ping { 0% { transform: scale(.55); opacity: .6; } 100% { transform: scale(1.25); opacity: 0; } }
.lp-radar-sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, #c43b2e 35%, transparent) 50deg, transparent 80deg); animation: lp-sweep 2.2s linear infinite; }
@keyframes lp-sweep { to { transform: rotate(360deg); } }
.lp-search-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.lp-search-head { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 3px; }
.lp-search-head svg { color: #c43b2e; }
.lp-src { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--text-secondary); padding: 6px 10px; border-radius: 9px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); opacity: 0; animation: lp-slidein .45s var(--ease-out-expo) forwards; }
.lp-src svg:first-child { color: var(--text-muted); flex-shrink: 0; }
.lp-src-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-src-ok { color: var(--accent-green); flex-shrink: 0; }
@keyframes lp-slidein { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.lp-search-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
.lp-search-count b { color: #c43b2e; font-weight: 800; }

/* Scene 3 — scoring (reuses hero mock classes) */
.lp-score-scene { display: flex; flex-direction: column; gap: 12px; }
.lp-job-anim { opacity: 0; animation: lp-slidein .5s var(--ease-out-expo) forwards; }
.lp-score-scene .lp-bar span { transition: width 1s var(--ease-out-expo) .3s; }

/* Scene 4 — optimize CV */
.lp-cv-scene { display: flex; gap: 22px; align-items: center; }
.lp-cv-doc { width: 200px; flex-shrink: 0; padding: 16px; border-radius: 10px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 9px; box-shadow: var(--shadow-card-hover); }
.lp-cv-h { height: 12px; width: 60%; border-radius: 4px; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); }
.lp-cv-line { height: 8px; width: 100%; border-radius: 4px; background: var(--border-default); }
.lp-cv-hl { background: color-mix(in srgb, #c43b2e 30%, var(--border-default)); animation: lp-hl 2.6s ease-in-out infinite; }
@keyframes lp-hl { 0%,100% { background: var(--border-default); } 50% { background: color-mix(in srgb, #c43b2e 45%, transparent); } }
.lp-cv-side { flex: 1; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.lp-cv-note { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--text-secondary); }
.lp-cv-note svg { color: var(--accent-green); flex-shrink: 0; }
.lp-cv-export { display: inline-flex; align-items: center; gap: 7px; margin-top: 4px; padding: 9px 16px; border: none; cursor: pointer; font-weight: 700; font-size: 0.82rem; color: #fff; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); border-radius: 11px; box-shadow: 0 6px 18px rgba(235,80,60,0.3); }

/* Timeline */
.lp-timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 10px; border-top: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-tl-tab { display: flex; flex-direction: column; gap: 7px; padding: 7px 8px; border: none; background: transparent; cursor: pointer; border-radius: 9px; transition: background .2s; }
.lp-tl-tab:hover { background: var(--bg-glass); }
.lp-tl-label { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .2s; }
.lp-tl-tab.is-active .lp-tl-label { color: var(--text-primary); }
.lp-tl-track { height: 3px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; }
.lp-tl-fill { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(135deg, #c43b2e 0%, #e27263 100%); }
@keyframes lp-tl-grow { from { width: 0; } to { width: 100%; } }
@media (max-width: 880px) {
  .lp-demo-stage { height: auto; min-height: 340px; }
  .lp-search { flex-direction: column; gap: 18px; text-align: center; }
  .lp-cv-scene { flex-direction: column; }
  .lp-cv-doc { width: 100%; }
  .lp-tl-label { font-size: 0; gap: 0; }
  .lp-tl-label svg { font-size: initial; }
}

@media (max-width: 1380px) {
  .lp-hero { grid-template-columns: 1fr; gap: 34px; justify-items: center; text-align: center; }
  .lp-hero-copy { display: flex; flex-direction: column; align-items: center; padding-left: 0; }
  .lp-sub { text-align: center; }
  .lp-cta-row, .lp-trust { justify-content: center; }
  .lp-mock-wrap { justify-content: center; }
  .lp-dash { width: min(700px, 100%); }
}

@media (max-width: 880px) {
  .lp-hero { grid-template-columns: 1fr; gap: 32px; padding-top: 24px; text-align: center; }
  .lp-hero-copy { display: flex; flex-direction: column; align-items: center; padding-left: 0; }
  .lp-cta-row, .lp-trust { justify-content: center; }
  .lp-mock-wrap { justify-content: center; margin-right: 0; }
  .lp-frame { padding: 10px; transform: none; }
  .lp-dash { width: 100%; }
  .lp-grid3 { grid-template-columns: 1fr; gap: 16px; }
  .lp-steps, .lp-features, .lp-apply-viz { grid-template-columns: 1fr; }
  .lp-stats { grid-template-columns: repeat(2, 1fr); gap: 20px 12px; }
  .lp-nav-cta { display: none; }
  .lp-nav-links { display: none; }
  .lp-featured { padding-left: 24px; padding-right: 24px; }
  .lp-featured-head { flex-direction: column; align-items: flex-start; gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-orb, .lp-pulse::after { animation: none; }
  .lp-hero-copy, .lp-mock-wrap { animation: none; }
  .lp-mock { transform: none; }
  .lp-marquee-track { animation: none; }
  .lp-scan-line, .lp-ping, .lp-radar-sweep, .lp-cv-hl { animation: none; }
  .lp-scene { transition: opacity .2s ease; transform: none; }
  .lp-chip2, .lp-src, .lp-job-anim { opacity: 1; animation: none; }
}
`;
