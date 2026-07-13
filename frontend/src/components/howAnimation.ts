// @ts-nocheck
/* Ported from "copo-section (4).html" — self-contained animated "how it works".
   Rendered into a shadow root (full CSS isolation) by HowItWorks.tsx; the orange
   accent is remapped to the Copo seal palette. initHow(root) starts the animation
   and returns a cleanup function (stops rAF, removes listeners, disconnects IOs). */

export const HOW_CSS = `
:host{display:block;background:#0a0a0c;color:var(--fg);font-family:var(--f);-webkit-font-smoothing:antialiased}
:host{
  --bg:#0A0C10; --bg2:#12151B;
  --line:rgba(255,255,255,.07);
  --dim:#5A6070; --mid:#8F96A3; --fg:#E6E9ED;
  --accent:#e8604f; --soft:rgba(232, 96, 79,.13);
  --good:#34d399;
  --f:'Be Vietnam Pro',system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}

.stage{
  position:relative;aspect-ratio:16/10;background:var(--bg);
  border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;
}
.stage::after{
  content:'';position:absolute;inset:0;z-index:7;pointer-events:none;
  background:radial-gradient(ellipse 60% 62% at 50% 46%,transparent 52%,rgba(6,7,10,.8) 100%);
}

/* =====================================================================
   ONE coordinate space. .scene is WORLD_W x WORLD_H CSS px, scaled to
   fit the stage by a single 'scale()'. Camera then translates it.
   The SVG inside is the SAME size with a 1:1 viewBox — so an svg unit
   IS a scene px. No second scale factor anywhere.
   ===================================================================== */
.viewport{position:absolute;inset:0;overflow:hidden}
.scene{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}

.para{
  position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;
  background-image:radial-gradient(circle,rgba(255,255,255,.13) .65px,transparent .65px);
  background-size:78px 78px;opacity:.4;
}
.svgw{position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none}
.svgw svg{width:100%;height:100%;display:block;overflow:visible}
.objs{position:absolute;top:0;left:0;width:100%;height:100%;z-index:3}
.st{position:absolute;transform:translate(-50%,-50%)}

/* ---------- path ---------- */
.trail{fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(232, 96, 79,.6))}
.spark{fill:var(--accent);filter:drop-shadow(0 0 12px rgba(232, 96, 79,1))}
.ray{fill:none;stroke:var(--accent);stroke-width:1.1;stroke-linecap:round}
.nd{fill:var(--dim)}
.nd.hot{fill:var(--accent)}

/* ---------- dropzone ---------- */
.dz{
  position:relative;width:250px;height:180px;border-radius:12px;
  border:1.5px dashed rgba(255,255,255,.16);background:rgba(255,255,255,.015);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  transition:border-color .25s,background .25s,transform .25s;
}
.dz.over{
  border-color:var(--accent);background:rgba(232, 96, 79,.07);
  transform:scale(1.02);
}
.dz.filled{border-style:solid;border-color:rgba(255,255,255,.1);background:transparent}

.dz-icon{color:var(--dim);margin-bottom:12px;transition:color .25s,transform .25s,opacity .3s}
.dz.over .dz-icon{color:var(--accent);transform:translateY(-3px)}
.dz-txt{font-size:12px;font-weight:400;color:var(--mid);transition:color .25s,opacity .3s}
.dz.over .dz-txt{color:var(--fg)}
.dz-sub{font-size:9.5px;font-weight:300;color:var(--dim);margin-top:5px;transition:opacity .3s}

/* upload progress, sits at the bottom of the zone */
.up{
  position:absolute;left:14px;right:14px;bottom:14px;opacity:0;
  transform:translateY(6px);transition:opacity .3s,transform .3s;
}
.up-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.up-ico{color:var(--dim);display:flex;flex-shrink:0}
.up-meta{flex:1;min-width:0;line-height:1.25}
.up-meta b{display:block;font-size:9.5px;font-weight:400;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.up-meta s{display:block;text-decoration:none;font-size:8px;font-weight:300;color:var(--dim);margin-top:1px}
.up-pct{font-size:9px;font-weight:400;color:var(--accent);font-variant-numeric:tabular-nums;flex-shrink:0}
.up-pct.done{color:var(--good)}
.up-bar{height:2px;background:rgba(255,255,255,.09);border-radius:2px;overflow:hidden}
.up-bar i{display:block;height:100%;width:0;background:var(--accent);border-radius:2px;transition:background .3s}
.up-bar i.done{background:var(--good)}

/* ---------- the file: dragged in, then becomes the CV being read ---------- */
.ghost{
  position:absolute;z-index:20;width:100px;aspect-ratio:1/1.3;
  background:var(--bg2);border:1px solid rgba(255,255,255,.19);border-radius:6px;
  padding:12px 10px;box-shadow:0 24px 56px -26px rgba(0,0,0,.95);
  opacity:0;pointer-events:none;
}
.ghost i{display:block;height:2px;background:rgba(255,255,255,.14);border-radius:1px;margin-bottom:4.5px}
.ghost i:first-child{width:58%;background:rgba(255,255,255,.44);margin-bottom:8px}
.ghost .fold{position:absolute;top:-1px;right:-1px;width:15px;height:15px;background:var(--bg);border-left:1px solid rgba(255,255,255,.19);border-bottom:1px solid rgba(255,255,255,.19);border-radius:0 5px 0 0}
.ghost .scan{position:absolute;left:5px;right:5px;height:1.6px;background:var(--accent);opacity:0;box-shadow:0 0 14px 1px rgba(232, 96, 79,.85)}
.ghost .fill{position:absolute;inset:auto 1px 1px;height:0;background:var(--soft);border-top:1px solid rgba(232, 96, 79,.55);border-radius:0 0 5px 5px}

/* ---------- core: a machine that is visibly computing ---------- */
.core{position:relative;width:170px;aspect-ratio:1;display:grid;place-items:center}
.core .arcs{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.core .orbit{fill:none;stroke:rgba(232, 96, 79,.2);stroke-width:.5}
/* Rotation is applied via the SVG 'transform' attribute (user units),
   never CSS — a CSS transform-origin in px does not match the viewBox. */
.core .arc{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-linecap:round}
.core .sweepBlade{fill:url(#sweepGrad)}
.core .tick{fill:none;stroke:rgba(232, 96, 79,.5);stroke-width:.8;stroke-linecap:round}
.core .heart{
  width:15%;aspect-ratio:1;background:var(--accent);border-radius:50%;
  position:relative;z-index:2;
}
.core .halo{position:absolute;inset:0;border:1px solid var(--accent);border-radius:50%;opacity:0}

.chip{
  position:absolute;font-size:10px;white-space:nowrap;padding:4px 10px;border-radius:20px;
  background:rgba(232, 96, 79,.12);border:1px solid rgba(232, 96, 79,.32);color:#f6a991;
}

/* ---------- job cards ---------- */
.job{
  position:absolute;background:var(--bg2);border:1px solid rgba(255,255,255,.13);border-radius:10px;
  padding:12px 15px;width:190px;box-shadow:0 20px 50px -28px rgba(0,0,0,.95);
}
.job.best{border-color:rgba(232, 96, 79,.75);background:rgba(232, 96, 79,.08)}
.job b{display:block;font-weight:500;font-size:12.5px;letter-spacing:-.01em}
.job s{display:block;text-decoration:none;color:var(--dim);font-size:10px;font-weight:300;margin-top:3px}
.job .num{position:absolute;top:12px;right:14px;font-size:10.5px;color:var(--dim);font-weight:500}
.job.best .num{color:var(--accent)}
.job .pc{margin-top:9px;height:2px;background:rgba(255,255,255,.09);border-radius:1px;overflow:hidden;position:relative}
.job .pc i{position:absolute;inset:0 auto 0 0;background:var(--dim);width:0}
.job.best .pc i{background:var(--accent)}

/* ---------- rewrite ---------- */
.panel{
  position:relative;width:560px;background:var(--bg2);
  border:1px solid rgba(255,255,255,.13);border-radius:12px;overflow:hidden;
  box-shadow:0 34px 78px -36px rgba(0,0,0,.98);
}
.panel .hd{padding:12px 17px;border-bottom:1px solid var(--line);font-size:10.5px;color:var(--dim);font-weight:300;display:flex;justify-content:space-between}
.panel .hd b{color:var(--fg);font-weight:500}
.rw{padding:13px 17px;font-size:12.5px;line-height:1.65;font-weight:300;display:flex;gap:11px;border-bottom:1px solid var(--line)}
.rw .ic{flex-shrink:0;width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:9px;margin-top:2px}
.rw.old .ic{background:rgba(255,255,255,.07);color:var(--dim)}
.rw.old span{color:var(--dim)}
.rw.new .ic{background:rgba(52, 211, 153,.17);color:var(--good)}
.rw mark{background:transparent;color:var(--good);font-weight:500}
.panel .ft{padding:11px 17px;background:rgba(52, 211, 153,.06);font-size:10.5px;color:var(--good);font-weight:300}

/* ---------- sent: a real browser window submitting a form ---------- */
.win{
  position:absolute;width:262px;background:#0F1218;
  border:1px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden;
  box-shadow:0 26px 60px -26px rgba(0,0,0,1);
  transition:border-color .45s;opacity:0;
}
.win.done{border-color:rgba(52, 211, 153,.55)}
.win.held{border-color:rgba(232, 96, 79,.5)}

.win .bar{
  display:flex;align-items:center;gap:8px;padding:6px 9px;
  background:#171B22;border-bottom:1px solid rgba(255,255,255,.07);
}
.win .dots{display:flex;gap:4px;flex-shrink:0}
.win .dots i{width:5.5px;height:5.5px;border-radius:50%;background:rgba(255,255,255,.16)}
.win .url{
  flex:1;background:#0B0E13;border-radius:3px;padding:2.5px 7px;
  font-size:8px;color:var(--dim);font-weight:300;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  display:flex;align-items:center;gap:5px;
}
.win .url em{font-style:normal;color:#4A8A6B;font-size:6px}
.win .url b{color:var(--mid);font-weight:400}

.win .body{padding:9px 11px 10px}
.win .ttl{font-size:9.5px;font-weight:500;margin-bottom:8px;letter-spacing:-.01em;color:var(--fg)}

.fld{margin-bottom:5px}
.fld label{display:block;font-size:7px;color:var(--dim);font-weight:300;margin-bottom:2px;letter-spacing:.02em}
.fld .inp{
  height:17px;background:#0B0E13;border:1px solid rgba(255,255,255,.09);border-radius:3px;
  display:flex;align-items:center;padding:0 6px;font-size:8px;color:var(--fg);font-weight:300;
  overflow:hidden;white-space:nowrap;transition:border-color .3s;
}
.fld .inp .txt{overflow:hidden;white-space:nowrap}
.fld .inp .car{width:1px;height:9px;background:var(--accent);margin-left:1px;flex-shrink:0;opacity:0}
.fld .inp.filed{border-color:rgba(52, 211, 153,.34)}
.fld .inp.file{gap:5px}
.fld .inp.file svg{flex-shrink:0;opacity:.55}

.win .btn{
  position:relative;margin-top:8px;height:22px;border-radius:3px;
  display:flex;align-items:center;justify-content:center;gap:5px;
  font-size:8px;font-weight:500;letter-spacing:.01em;overflow:hidden;
  background:rgba(255,255,255,.06);color:var(--dim);
  transition:background .28s,color .28s;
}
.win .btn svg{flex-shrink:0}
.win .btn .lbl{position:relative;z-index:2}
.win .btn .ico{position:relative;z-index:2;display:flex}

/* hover: the cursor is over it, not yet pressed */
.win .btn.hover{background:rgba(232, 96, 79,.22);color:#f4a78c}
/* armed: form complete, waiting for the click */
.win .btn.ready{background:var(--accent);color:#0A0C10}
.win .btn.sent{background:rgba(52, 211, 153,.18);color:var(--good)}
.win .btn.locked{background:rgba(232, 96, 79,.13);color:var(--accent)}

/* click ripple — scale driven from JS */
.win .btn .rip{
  position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;
  background:rgba(255,255,255,.5);transform:translate(-50%,-50%) scale(0);
  opacity:0;pointer-events:none;z-index:1;
}

/* ---------- the cursor ---------- */
.cur-arrow{
  position:absolute;z-index:40;width:15px;height:19px;
  opacity:0;pointer-events:none;transform-origin:2px 2px;
  filter:drop-shadow(0 2px 5px rgba(0,0,0,.75));
}
.cur-arrow .ring{
  position:absolute;left:2px;top:2px;width:24px;height:24px;
  border:1.5px solid var(--accent);border-radius:50%;
  transform:translate(-50%,-50%) scale(0);opacity:0;
}

.cap-box{
  margin-top:6px;padding:5px 7px;border-radius:3px;opacity:0;
  background:rgba(232, 96, 79,.09);border:1px solid rgba(232, 96, 79,.28);
  display:flex;align-items:center;gap:6px;font-size:7px;color:#ef9079;font-weight:300;
}
.cap-box .sq{width:10px;height:10px;border:1px solid rgba(232, 96, 79,.6);border-radius:2px;flex-shrink:0}

/* ---------- outro ---------- */
.outro{position:absolute;text-align:center;width:440px}
.outro .n{font-size:78px;font-weight:600;letter-spacing:-.05em;line-height:1;color:#fff}
.outro .n em{font-style:normal;color:var(--accent)}
.outro .l{margin-top:12px;font-size:12px;color:var(--dim);font-weight:300}
.cta{
  display:inline-flex;align-items:center;gap:10px;margin-top:28px;
  background:var(--accent);color:#0A0C10;text-decoration:none;border-radius:100px;
  padding:14px 28px;font-weight:600;font-size:13.5px;letter-spacing:-.01em;
  transition:transform .18s,box-shadow .18s;pointer-events:auto;
}
.cta:hover{transform:translateY(-2px);box-shadow:0 12px 34px -12px rgba(232, 96, 79,.85)}
.cta:focus-visible{outline:2px solid #fff;outline-offset:3px}

/* ---------- fixed chrome ---------- */
.hud{position:absolute;top:0;left:0;right:0;z-index:8;display:flex;justify-content:space-between;align-items:center;padding:20px 24px}
.brand{font-weight:600;font-size:16px;letter-spacing:-.02em}
.brand em{font-style:normal;color:var(--accent)}
.rail{width:120px;height:2px;background:rgba(255,255,255,.13);border-radius:2px;position:relative;overflow:hidden}
.rail i{position:absolute;inset:0 auto 0 0;width:0;background:var(--accent);border-radius:2px}

.caption{position:absolute;left:0;right:0;bottom:0;z-index:8;padding:0 clamp(24px,5vw,64px) clamp(28px,4vw,48px);text-align:center;pointer-events:none}
.capwrap{position:relative;min-height:88px}
.cap{position:absolute;left:0;right:0;bottom:0;opacity:0}
.cap h2{font-weight:500;font-size:clamp(17px,2.3vw,27px);letter-spacing:-.025em;line-height:1.25}
.cap h2 span{color:var(--accent)}
.cap p{margin-top:9px;color:var(--mid);font-weight:300;font-size:clamp(11px,1.2vw,13.5px);line-height:1.6;max-width:44ch;margin-inline:auto}

/* ---------- controls ---------- */
.ctrl{margin-top:14px;display:flex;align-items:center;gap:15px}
button.pp{
  width:34px;height:34px;border:1px solid rgba(255,255,255,.16);background:transparent;
  border-radius:50%;display:grid;place-items:center;cursor:pointer;flex-shrink:0;color:var(--fg);
  transition:border-color .2s,background .2s;
}
button.pp:hover{border-color:var(--accent);background:rgba(232, 96, 79,.1)}
button.pp:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.scrub{flex:1;height:34px;display:flex;align-items:center;cursor:pointer;position:relative}
.scrub .bg{width:100%;height:2.5px;background:rgba(255,255,255,.12);border-radius:2px;position:relative}
.scrub .fg{position:absolute;inset:0 auto 0 0;width:0;background:var(--accent);border-radius:2px}
.scrub .knob{position:absolute;top:50%;left:0;width:9px;height:9px;border-radius:50%;background:var(--accent);transform:translate(-50%,-50%);opacity:0;transition:opacity .2s}
.scrub:hover .knob{opacity:1}
.marks{position:absolute;inset:0;pointer-events:none}
.marks u{position:absolute;top:50%;width:1px;height:7px;background:rgba(255,255,255,.22);transform:translate(-50%,-50%)}
.tm{font-size:11px;color:var(--dim);min-width:78px;text-align:right;font-variant-numeric:tabular-nums;font-weight:300}

@media (max-width:700px){
  .stage{aspect-ratio:4/5;border-radius:11px}
  .capwrap{min-height:100px}
}

/* ============================================================
   SECTION SHELL — "How it works", built to sit inside a page
   ============================================================ */
.how{
  position:relative;
  padding:clamp(80px,12vh,160px) 20px clamp(90px,14vh,180px);
  display:flex;flex-direction:column;align-items:center;
  isolation:isolate;
}
/* ambient wash behind the whole section — gives the frame something to float over */
.how::before{
  content:'';position:absolute;inset:0;z-index:-2;pointer-events:none;
  background:
    radial-gradient(60% 50% at 50% 38%, rgba(232, 96, 79,.10), transparent 70%),
    radial-gradient(40% 40% at 78% 72%, rgba(232, 96, 79,.05), transparent 70%);
}
/* faint moving grain layer */
.how::after{
  content:'';position:absolute;inset:0;z-index:-2;pointer-events:none;opacity:.5;
  background-image:radial-gradient(circle, rgba(255,255,255,.05) .6px, transparent .6px);
  background-size:64px 64px;
  -webkit-mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 80%);
          mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 80%);
}

/* ---- heading ---- */
.how-head{
  text-align:center;max-width:640px;margin-bottom:clamp(44px,7vh,84px);
  opacity:0;transform:translateY(22px);
  transition:opacity .9s cubic-bezier(.16,.84,.24,1), transform .9s cubic-bezier(.16,.84,.24,1);
}
.how-head.in{opacity:1;transform:none}
.how-eyebrow{
  display:inline-flex;align-items:center;gap:9px;
  font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent);margin-bottom:20px;
}
.how-eyebrow::before,.how-eyebrow::after{content:'';width:26px;height:1px;background:rgba(232, 96, 79,.4)}
.how-title{
  font-size:clamp(30px,5vw,54px);font-weight:600;letter-spacing:-.035em;line-height:1.06;
  color:#fff;
}
.how-title span{
  color:transparent;background:linear-gradient(120deg,var(--accent),#f4a78c);
  -webkit-background-clip:text;background-clip:text;
}
.how-sub{
  margin-top:20px;font-size:clamp(14px,1.6vw,17px);font-weight:300;line-height:1.6;
  color:var(--mid);max-width:52ch;margin-inline:auto;
}

/* ---- the floating stage ---- */
.float{
  position:relative;width:100%;max-width:1000px;
  perspective:1800px;
  opacity:0;transform:translateY(40px);
  transition:opacity 1s cubic-bezier(.16,.84,.24,1), transform 1s cubic-bezier(.16,.84,.24,1);
}
.float.in{opacity:1;transform:none}

/* tilt target — JS writes --rx / --ry; CSS eases toward them */
.tilt{
  transform-style:preserve-3d;
  transform:
    rotateX(var(--rx,0deg))
    rotateY(var(--ry,0deg));
  transition:transform .5s cubic-bezier(.22,.61,.36,1);
  will-change:transform;
}

/* the glow bed the stage sits on */
.float .bed{
  position:absolute;inset:-2px;border-radius:18px;z-index:-1;
  background:linear-gradient(135deg, rgba(232, 96, 79,.55), rgba(232, 96, 79,0) 45%, rgba(232, 96, 79,.28));
  filter:blur(22px);opacity:.5;
  transform:translateZ(-40px) scale(.97);
  transition:opacity .5s;
}
.float:hover .bed{opacity:.8}

/* deep drop shadow, separate so it doesn't blur the frame */
.float .shadow{
  position:absolute;left:6%;right:6%;bottom:-6%;height:22%;z-index:-2;
  background:radial-gradient(ellipse at center, rgba(0,0,0,.7), transparent 72%);
  filter:blur(30px);
  transform:translateZ(-80px);
}

/* the stage gets a bright top edge + coloured lift when floating */
.how .stage{
  box-shadow:
    0 2px 0 rgba(255,255,255,.06) inset,
    0 50px 90px -40px rgba(0,0,0,.85),
    0 20px 50px -30px rgba(232, 96, 79,.4);
  border-color:rgba(255,255,255,.14);
}

/* controls live below the frame, centered */
.how .ctrl{max-width:1000px;margin:20px auto 0;padding:0 4px}

/* a soft spotlight that follows the cursor across the glass */
.float .sheen{
  position:absolute;inset:0;border-radius:14px;z-index:5;pointer-events:none;
  background:radial-gradient(220px 220px at var(--mx,50%) var(--my,0%), rgba(255,255,255,.06), transparent 60%);
  opacity:0;transition:opacity .4s;
  mix-blend-mode:screen;
}
.float:hover .sheen{opacity:1}

@media (max-width:700px){
  .how{padding:64px 16px 80px}
  .float{perspective:none}
  .tilt{transform:none!important}          /* no tilt without a real pointer */
  .float .sheen{display:none}
}
@media (prefers-reduced-motion:reduce){
  .tilt{transform:none!important;transition:none}
  .how-head,.float{transition:none}
}
`;

export const HOW_MARKUP = `
<section class="how">
  <div class="how-head" id="howHead">
    <div class="how-eyebrow">Cách hoạt động</div>
    <h1 class="how-title">Từ CV đến ứng tuyển,<br><span>tự động hoàn toàn</span></h1>
    <p class="how-sub">Bạn chỉ cần tải lên CV, Copo đọc, tìm việc phù hợp với bạn, tối ưu CV cho từng job, rồi nộp đơn thay bạn. Bên dưới là toàn bộ quy trình, đúng thứ tự hệ thống xử lý.</p>
  </div>

  <div class="float" id="float">
    <div class="shadow"></div>
    <div class="tilt" id="tilt">
      <div class="bed"></div>
      <div class="sheen" id="sheen"></div>
      <div class="stage" id="stage">

    <div class="hud">
      <div class="brand">Cop<em>o</em></div>
      <div class="rail"><i id="rail"></i></div>
    </div>

    <div class="viewport">
      <div class="scene" id="scene">
        <div class="para" id="para"></div>

        <div class="svgw">
          <svg id="svg" preserveAspectRatio="xMinYMin meet" aria-hidden="true"><g id="paths"></g></svg>
        </div>

        <div class="objs" id="objs">
          <div class="st" id="stCv">
            <div class="dz" id="dz">
              <div class="dz-icon" id="dzIcon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 16V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M3.5 15v3.5a1.5 1.5 0 001.5 1.5h14a1.5 1.5 0 001.5-1.5V15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </div>
              <div class="dz-txt" id="dzTxt">Kéo CV của bạn vào đây</div>
              <div class="dz-sub" id="dzSub">PDF, DOCX · tối đa 10MB</div>

              <div class="up" id="up">
                <div class="up-row">
                  <span class="up-ico">
                    <svg width="13" height="16" viewBox="0 0 13 16" fill="none" aria-hidden="true">
                      <path d="M1 1h7l4 4v10H1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
                      <path d="M8 1v4h4" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <span class="up-meta">
                    <b>CV_MinhAnh.pdf</b>
                    <s>248 KB</s>
                  </span>
                  <span class="up-pct" id="upPct">0%</span>
                </div>
                <div class="up-bar"><i id="upBar"></i></div>
              </div>
            </div>
          </div>

          <!-- the file: dragged in from off-zone, then read by the AI -->
          <div class="ghost" id="ghost">
            <span class="fold"></span>
            <i></i><i style="width:84%"></i><i style="width:66%"></i>
            <i style="width:78%"></i><i style="width:54%"></i><i style="width:70%"></i>
            <span class="scan" id="scan"></span><span class="fill" id="cvfill"></span>
          </div>

          <div class="st" id="stCore">
            <div class="core">
              <span class="halo" id="halo"></span>
              <svg class="arcs" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <linearGradient id="sweepGrad" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stop-color="#e8604f" stop-opacity="0"/>
                    <stop offset="100%" stop-color="#e8604f" stop-opacity=".55"/>
                  </linearGradient>
                </defs>
                <circle class="orbit" cx="50" cy="50" r="40"/>
                <circle class="orbit" cx="50" cy="50" r="33" opacity=".65"/>
                <circle class="orbit" cx="50" cy="50" r="26" opacity=".45"/>
                <path id="arcA" class="arc" d="M50 10 A40 40 0 0 1 77.79 21.23"/>
                <path id="arcB" class="arc" d="M50 17 A33 33 0 0 1 70.32 24"/>
                <path id="arcC" class="arc" d="M50 24 A26 26 0 0 1 69.92 33.29"/>
                <g id="sweep"><path class="sweepBlade" d="M50 50 L50 10 A40 40 0 0 1 67.53 14.05 Z"/></g>
                <g id="ticks"></g>
              </svg>
              <span class="heart" id="heart"></span>
            </div>
          </div>

          <div id="chips"></div>
          <div id="jobs"></div>

          <div class="st" id="stPanel">
            <div class="panel" id="panel">
              <div class="hd"><span>Bản gửi cho <b>MoMo</b></span><span>Copo viết lại</span></div>
              <div class="rw old" id="rwOld"><span class="ic">−</span><span>Quản lý sản phẩm, làm việc với đội dev để ra tính năng mới.</span></div>
              <div class="rw new" id="rwNew"><span class="ic">✓</span><span>Dẫn dắt <mark>roadmap thanh toán</mark> cho 2 triệu người dùng. Tăng <mark>32% tỉ lệ chuyển đổi</mark>.</span></div>
              <div class="ft" id="rwFt">Giữ nguyên mọi điều bạn đã làm — chỉ kể lại theo cách nhà tuyển dụng đang tìm.</div>
            </div>
          </div>

          <div id="sents"></div>

          <div class="outro" id="outro">
            <div class="n"><em>12</em> đơn</div>
            <div class="l">đã gửi trong lúc bạn ngủ</div>
            <a class="cta" href="#">Tải CV lên, thử miễn phí
              <svg width="14" height="11" viewBox="0 0 15 12" fill="none" aria-hidden="true"><path d="M1 6h12M9 2l4 4-4 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="caption"><div class="capwrap" id="capwrap"></div></div>
      </div><!-- /.stage -->
    </div><!-- /.tilt -->

    <div class="ctrl">
      <button class="pp" id="pp" aria-label="Tạm dừng">
        <svg id="ic" width="10" height="11" viewBox="0 0 11 12" fill="currentColor"><rect x="0" width="3.2" height="12" rx="1"/><rect x="7" width="3.2" height="12" rx="1"/></svg>
      </button>
      <div class="scrub" id="scrub">
        <div class="bg"><div class="fg" id="fg"></div><div class="marks" id="marks"></div></div>
        <div class="knob" id="knob"></div>
      </div>
      <div class="tm" id="tm">0:00</div>
    </div>
  </div><!-- /.float -->
</section>
`;

export function initHow(root) {
  'use strict';
  var cleanups = [], __alive = true;
  function reg(tgt, ty, fn, op){ tgt.addEventListener(ty, fn, op); cleanups.push(function(){ tgt.removeEventListener(ty, fn, op); }); }
var NS='http://www.w3.org/2000/svg';
var $=function(id){return root.getElementById(id);};

/* =====================================================================
   GEOMETRY — ONE space. Scene is WORLD_W x WORLD_H px.
   VIEW_W/VIEW_H is one screenful. Scene scales so VIEW_H fills the stage.
   SVG viewBox === scene size, 1:1, so svg units are scene px.
   ===================================================================== */
var VIEW_W=1000, VIEW_H=625;
var GAP=1140;                        // distance between stations
var MID = VIEW_H/2 - 78;             // vertical centre, lifted well clear of captions

var CV    = {x: 520,          y: MID};
var CORE  = {x: CV.x+GAP,     y: MID};
var FIELD = {x: CORE.x+GAP,   y: MID};
var SHORT = {x: FIELD.x+GAP,  y: MID};
var PANEL = {x: SHORT.x+GAP,  y: MID};
var SENT  = {x: PANEL.x+GAP,  y: MID};
var OUT   = {x: SENT.x+GAP,   y: MID};

var WORLD_W = OUT.x + 520;
var WORLD_H = VIEW_H;

var DUR = 40300;

/* camera keyframes: [ms, center-x]. Short holds → never a dead stop. */
var CAM=[
  [0,CV.x],[4400,CV.x],              // hold through drag → drop → upload
  [7400,CORE.x],[11000,CORE.x],
  [13800,FIELD.x],[18800,FIELD.x],   // hold through probe → score → cull
  [21600,SHORT.x],[24200,SHORT.x],
  [27200,PANEL.x],[30000,PANEL.x],
  [31000,SENT.x],[38300,SENT.x],     // arrive before win 0, hold through all three
  [39800,OUT.x],[40300,OUT.x]
];

/* [in, out]. FADE is the ramp length; windows are spaced so exactly one
   caption is at full opacity at any time, with a short clean crossfade. */
var FADE=380;
var CAPS=[
  [200,  6000, '<h2>Bạn chỉ cần <span>kéo CV vào</span>.</h2><p>File bạn đang có, không cần sửa gì. Copo lo phần còn lại.</p>'],
  [6200, 11800,'<h2>Copo <span>đọc và hiểu</span> bạn.</h2><p>Bạn làm được gì, đã làm bao lâu, mạnh nhất ở đâu.</p>'],
  [12000,16400,'<h2>Rồi <span>toả đi tìm việc</span> khắp nơi.</h2><p>Quét hàng nghìn tin tuyển dụng, chấm điểm từng cái với hồ sơ của bạn.</p>'],
  [16600,18200,'<h2>Loại đi cái <span>không hợp</span>.</h2><p>Điểm thấp bị gạt. Chỉ ba tin còn lại.</p>'],
  [18400,24400,'<h2>Giữ lại việc <span>thật sự hợp</span>.</h2><p>Những vị trí khớp nhất, không phải hàng trăm tin. Xếp theo mức độ hợp với bạn.</p>'],
  [24600,30400,'<h2>Viết lại CV cho <span>từng nơi</span>.</h2><p>Cùng một con người, kể bằng ngôn ngữ mà nơi đó đang tìm.</p>'],
  [30600,38100,'<h2>Rồi <span>tự điền và gửi</span> thay bạn.</h2><p>Copo mở trang tuyển dụng, điền form, đính CV, bấm gửi.</p>'],
  [38300,40200,'<h2>Việc đi tìm bạn.</h2><p>Ba đơn đầu tiên miễn phí · Không cần thẻ</p>']
];

/* --- math --- */
function ease(k){return k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;}
function outC(k){return 1-Math.pow(1-k,3);}
function cl(v,a,b){return v<a?a:v>b?b:v;}
function seg(t,a,b){return cl((t-a)/(b-a),0,1);}
function fade(t,a,b,c,d){return Math.min(seg(t,a,b),1-seg(t,c,d));}
function camAt(t){
  for(var i=0;i<CAM.length-1;i++){
    if(t>=CAM[i][0]&&t<=CAM[i+1][0]){
      var k=(t-CAM[i][0])/(CAM[i+1][0]-CAM[i][0]);
      return CAM[i][1]+(CAM[i+1][1]-CAM[i][1])*ease(k);
    }
  }
  return CAM[CAM.length-1][1];
}

/* =====================================================================
   BUILD
   ===================================================================== */
var scene=$('scene'), svg=$('svg'), paths=$('paths');
scene.style.width  = WORLD_W+'px';
scene.style.height = WORLD_H+'px';
svg.setAttribute('viewBox','0 0 '+WORLD_W+' '+WORLD_H);   // 1:1 with scene px

function mk(tag,a,c){var e=document.createElementNS(NS,tag);for(var k in a)e.setAttribute(k,a[k]);if(c)e.setAttribute('class',c);return e;}

/* Consistent bow: every spine arcs the SAME way (upward), magnitude scales
   with horizontal distance. No mixed signs → no snake. */
function bez(a,b,bow){
  var dx=(b.x-a.x)*0.42;
  var lift=(bow===undefined?70:bow);
  return 'M'+a.x+' '+a.y+' C'+(a.x+dx)+' '+(a.y-lift)+' '+(b.x-dx)+' '+(b.y-lift)+' '+b.x+' '+b.y;
}
function mkPath(d,cls){
  var p=mk('path',{d:d},cls);
  paths.appendChild(p);
  var L=p.getTotalLength();
  p.setAttribute('stroke-dasharray',L);
  p.setAttribute('stroke-dashoffset',L);
  return {p:p,L:L};
}
function mkSpark(at){
  var s=mk('circle',{r:3.6,cx:at.x,cy:at.y},'spark');
  s.style.opacity=0;paths.appendChild(s);return s;
}

/* spines — all bow +70, all left-to-right.
   sp1 leaves the dropzone's right edge (zone is 250 wide).
   There is no FIELD→SHORT spine: the three convergence lines are the
   only things that should reach the shortlist, one per card. */
var DZ_HALF=125;
var sp1=mkPath(bez({x:CV.x+DZ_HALF,y:CV.y},CORE,70),'trail');
sp1.s=mkSpark({x:CV.x+DZ_HALF,y:CV.y});
var sp2=mkPath(bez(CORE,FIELD,70),'trail');
/* shortlist → panel: from the SELECTED card (top) to the panel's left edge.
   The run goes down-right, so a slight negative bow gives one clean arc
   instead of an S. Panel is 560 wide (±280); cards 190 (±95). */
var PANEL_HALF=280, CARD_HALF2=95, TOP_CARD_Y=-108;
var sp4=mkPath(bez({x:SHORT.x+CARD_HALF2, y:SHORT.y+TOP_CARD_Y},
                   {x:PANEL.x-PANEL_HALF,  y:PANEL.y}, -46),'trail');
sp4.s=mkSpark({x:SHORT.x+CARD_HALF2, y:SHORT.y+TOP_CARD_Y});

/* field scatter — keep everything inside one screenful of FIELD */
var NOISE=[],PICK=[];
(function(){
  var pts=[[-300,-128],[-165,-170],[-15,-150],[145,-172],[300,-125],[368,-48],[342,60],[250,134],[100,167],[-52,145],[-208,158],[-330,75],[-370,-26],[196,-95],[-118,95],[70,-60],[-234,-40],[244,40]];
  pts.forEach(function(p){NOISE.push({x:FIELD.x+p[0],y:FIELD.y+p[1]});});
  PICK=[{x:FIELD.x+145,y:FIELD.y-172},{x:FIELD.x+368,y:FIELD.y-48},{x:FIELD.x+250,y:FIELD.y+134}];
})();

/* rays: bow scaled to distance so short rays don't loop */
function rayBow(a,b){ return Math.min(Math.abs(b.x-a.x),Math.abs(b.y-a.y))*0.18; }

/* Every posting gets a match score. Low ones get culled — visibly. */
var LOW=[31,44,12,58,26,49,19,37,53,22,41,15,34,47,28,55,23,39];
var HIGH=[94,81,67];

function scoreLabel(n,val,hot){
  var right = n.x >= FIELD.x;
  var tx = mk('text',{
    x: n.x + (right? 11 : -11),
    y: n.y + 4,
    'text-anchor': right? 'start':'end',
    'font-size': 11,
    'font-family': "'Be Vietnam Pro',sans-serif",
    'font-weight': hot? 500 : 300,
    fill: hot? '#e8604f' : '#5A6070'
  });
  tx.textContent = val+'%';
  tx.style.opacity=0;
  paths.appendChild(tx);
  return tx;
}

var rays=[];
NOISE.forEach(function(n,i){
  var r=mkPath(bez(CORE,n,rayBow(CORE,n)),'ray');
  r.p.style.opacity=0;
  var c=mk('circle',{cx:n.x,cy:n.y,r:2.4},'nd');c.style.opacity=0;paths.appendChild(c);
  rays.push({p:r.p,L:r.L,c:c,keep:0,lab:scoreLabel(n,LOW[i%LOW.length],false)});
});
PICK.forEach(function(n,i){
  var r=mkPath(bez(CORE,n,rayBow(CORE,n)),'ray');
  r.p.style.opacity=0;
  var c=mk('circle',{cx:n.x,cy:n.y,r:2.8},'nd hot');c.style.opacity=0;paths.appendChild(c);
  rays.push({p:r.p,L:r.L,c:c,keep:1,lab:scoreLabel(n,HIGH[i],true)});
});

/* convergence — exactly three lines, one per card, landing on its left edge.
   Bow scales with horizontal run and splays by card index, so the middle
   line is never a flat ruler next to two curves. */
var JOBY=[-108,0,108];
var CARD_HALF=95;
var SPLAY=[0.45, 0.35, -0.55];         // gentler top bow (was arcing into the hud)
var conv=PICK.map(function(n,i){
  var target={x:SHORT.x-CARD_HALF, y:SHORT.y+JOBY[i]};
  var bow=(target.x-n.x)*0.075*SPLAY[i];
  var r=mkPath(bez(n,target,bow),'ray');
  r.p.style.opacity=0;return r;
});

/* ---- three browser windows, cascaded like stacked desktop windows.
   Each is offset +88x/+96y from the last, so every title bar stays visible. ---- */
var WIN_W=262;
var WINS=[
  {host:'momo.vn',   path:'/tuyen-dung', role:'Product Manager, Fintech', state:'ok'},
  {host:'base.vn',   path:'/jobs/apply', role:'Product Owner, SaaS',      state:'ok'},
  {host:'vng.com.vn',path:'/careers',    role:'Business Analyst',         state:'held'}
];

/* Three lines, each drawn while its window is entering. They land on the
   window's left edge at the centre position (where the window will be).
   Bowed apart by index so they never merge into one stroke. */
var out=WINS.map(function(w,i){
  var a={x:PANEL.x+300, y:PANEL.y};
  var b={x:SENT.x - WIN_W/2 - 6, y:SENT.y - 40};
  var r=mkPath(bez(a,b,rayBow(a,b)+16+i*34),'trail');
  r.s=mkSpark(a);return r;
});

/* DOM stations */
$('stCv').style.cssText   +='left:'+CV.x+'px;top:'+CV.y+'px';
$('stCore').style.cssText +='left:'+CORE.x+'px;top:'+CORE.y+'px';
$('stPanel').style.cssText+='left:'+PANEL.x+'px;top:'+PANEL.y+'px';
$('outro').style.cssText  +='left:'+OUT.x+'px;top:'+OUT.y+'px';

/* tick ring: 36 marks. They light up as postings get scored. */
var tickEls=[];
(function(){
  var g=$('ticks');
  for(var i=0;i<36;i++){
    var ang=(i/36)*Math.PI*2 - Math.PI/2;
    var r1=42, r2=45.5;
    var l=mk('line',{
      x1:(50+Math.cos(ang)*r1).toFixed(2), y1:(50+Math.sin(ang)*r1).toFixed(2),
      x2:(50+Math.cos(ang)*r2).toFixed(2), y2:(50+Math.sin(ang)*r2).toFixed(2)
    },'tick');
    l.style.opacity=0.15;
    g.appendChild(l);tickEls.push(l);
  }
})();

var CHIPS=[{t:'Product',x:-96,y:-64},{t:'Fintech',x:98,y:-58},{t:'4 năm',x:-108,y:58},{t:'Thanh toán',x:0,y:-116},{t:'Roadmap',x:96,y:62}];
var chipEls=CHIPS.map(function(c){
  var e=document.createElement('div');
  e.className='chip';e.textContent=c.t;
  e.style.left=(CORE.x+c.x)+'px';e.style.top=(CORE.y+c.y)+'px';
  $('chips').appendChild(e);return e;
});

var JOBD=[{t:'Product Manager',s:'MoMo · Hà Nội',p:94,b:1},{t:'Product Owner',s:'Base.vn · Remote',p:81},{t:'Business Analyst',s:'VNG · TP.HCM',p:67}];
var jobEls=JOBD.map(function(j,i){
  var e=document.createElement('div');
  e.className='job'+(j.b?' best':'');
  e.style.left=SHORT.x+'px';e.style.top=(SHORT.y+JOBY[i])+'px';
  e.innerHTML='<span class="num">'+j.p+'%</span><b>'+j.t+'</b><s>'+j.s+'</s><span class="pc"><i></i></span>';
  $('jobs').appendChild(e);return e;
});

/* ---- build the window DOM ---- */
var FIELDS=[
  {l:'Họ và tên', v:'Nguyễn Minh Anh'},
  {l:'CV đính kèm', v:'', file:1}
];

var winEls=WINS.map(function(w,i){
  var e=document.createElement('div');
  e.className='win';
  /* anchored at the station centre; render() slides it between slots */
  e.style.left = SENT.x+'px';
  e.style.top  = SENT.y+'px';
  e.style.transform='translate(-50%,-50%)';

  var fldHTML=FIELDS.map(function(f,j){
    var v = f.file ? ('CV_'+w.host.split('.')[0]+'.pdf') : f.v;
    var icon = f.file
      ? '<svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true"><path d="M1 1h4l2 2v6H1z" stroke="currentColor" stroke-width=".8"/></svg>'
      : '';
    return '<div class="fld"><label>'+f.l+'</label>'+
           '<div class="inp'+(f.file?' file':'')+'">'+icon+
           '<span class="txt" data-full="'+v+'"></span><span class="car"></span></div></div>';
  }).join('');

  var UP='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">'+
         '<path d="M5 7V2M5 2L2.6 4.4M5 2l2.4 2.4M1.5 8.5h7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var OK='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">'+
         '<path d="M1.8 5.2L4 7.4l4.2-4.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var LOCK='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">'+
         '<rect x="2" y="4.4" width="6" height="4.2" rx="1" stroke="currentColor" stroke-width="1"/>'+
         '<path d="M3.6 4.4V3.2a1.4 1.4 0 012.8 0v1.2" stroke="currentColor" stroke-width="1"/></svg>';

  e.innerHTML =
    '<div class="bar">'+
      '<div class="dots"><i></i><i></i><i></i></div>'+
      '<div class="url"><em>●</em><b>'+w.host+'</b>'+w.path+'</div>'+
    '</div>'+
    '<div class="body">'+
      '<div class="ttl">'+w.role+'</div>'+
      fldHTML+
      '<div class="btn"><span class="rip"></span>'+
        '<span class="ico">'+UP+'</span><span class="lbl">Gửi hồ sơ</span>'+
      '</div>'+
      (w.state==='held' ? '<div class="cap-box"><span class="sq"></span>Xác nhận bạn không phải robot</div>' : '')+
    '</div>';

  $('sents').appendChild(e);
  return {
    el:e, win:w,
    ICO:{UP:UP,OK:OK,LOCK:LOCK},
    txts:[].slice.call(e.querySelectorAll('.txt')),
    cars:[].slice.call(e.querySelectorAll('.car')),
    inps:[].slice.call(e.querySelectorAll('.inp')),
    btn: e.querySelector('.btn'),
    lbl: e.querySelector('.btn .lbl'),
    ico: e.querySelector('.btn .ico'),
    rip: e.querySelector('.btn .rip'),
    cap: e.querySelector('.cap-box')
  };
});

/* ---- the cursor: one arrow, reused for all three windows ---- */
var cursor=document.createElement('div');
cursor.className='cur-arrow';
cursor.innerHTML =
  '<span class="ring"></span>'+
  '<svg width="15" height="19" viewBox="0 0 15 19" fill="none" aria-hidden="true">'+
    '<path d="M1.2 1.1l11.4 8.6-5.1.5-2.7 5.2z" fill="#fff" stroke="#0A0C10" stroke-width="1.1" stroke-linejoin="round"/>'+
  '</svg>';
$('sents').appendChild(cursor);
var cursorRing=cursor.querySelector('.ring');

/* The button moves and scales every frame, so we cannot cache a screen
   position. What IS constant is the button's offset from its window's centre
   at scale 1. Measure that once; compose with the live slot each frame. */
var btnOff=[];
function measureButtons(){
  btnOff = winEls.map(function(w){
    var prev = w.el.style.transform;
    w.el.style.transform = 'translate(-50%,-50%)';   // neutral, scale 1
    var wr = w.el.getBoundingClientRect();
    var br = w.btn.getBoundingClientRect();
    w.el.style.transform = prev;
    return {
      dx: ((br.left+br.width/2) - (wr.left+wr.width/2))/K,
      dy: ((br.top+br.height/2) - (wr.top+wr.height/2))/K,
      w:  br.width/K,
      h:  br.height/K
    };
  });
}

var capEls=CAPS.map(function(c){
  var e=document.createElement('div');e.className='cap';e.innerHTML=c[2];
  $('capwrap').appendChild(e);return e;
});
CAPS.forEach(function(c){
  var u=document.createElement('u');u.style.left=(c[0]/DUR*100)+'%';$('marks').appendChild(u);
});

/* --- responsive scale: recomputed on resize, applied inside render --- */
var K=1;
function measure(){
  var r=$('stage').getBoundingClientRect();
  K = r.height / VIEW_H;             // one screenful of height fills the stage
}
measure();
reg(window, 'resize',function(){ measure(); measureButtons(); });

/* helper: draw a path progressively + move its spark along it */
function runLine(o,k){
  o.p.setAttribute('stroke-dashoffset', o.L*(1-k));
  if(!o.s) return;
  if(k>0.001 && k<0.999){
    var pt=o.p.getPointAtLength(k*o.L);
    o.s.setAttribute('cx',pt.x); o.s.setAttribute('cy',pt.y);
    o.s.style.opacity = Math.min(k/0.05,(1-k)/0.08,1).toFixed(3);
  } else o.s.style.opacity=0;
}

/* =====================================================================
   RENDER(t)
   ===================================================================== */
function render(t){
  /* camera: scale first, then translate in scaled px */
  var cx=camAt(t);
  var stageW=$('stage').clientWidth;
  var px = stageW/2 - cx*K;
  /* translate is in screen px; scale is about origin 0,0 so it does not
     re-scale the translate. Order matters: translate THEN scale. */
  scene.style.transform='translate3d('+px.toFixed(2)+'px,0,0) scale('+K.toFixed(4)+')';
  $('para').style.transform='translate3d('+((cx*K)*0.22).toFixed(2)+'px,0,0)';

  /* ---- core: idle → reading → searching → idle ----
     `load` is how hard it is working. It drives arc speed, sweep opacity,
     heart rate and glow. The machine visibly spins up and winds down. */
  var reading  = fade(t, 4100, 5100, 7400, 8400);
  var searching= fade(t,12000,12800,18200,19200);
  var load = Math.max(reading*0.6, searching);

  var sp = t/1000;
  var boost = 1 + load*2.4;
  /* rotate() as an SVG attribute — user units, explicit centre. A CSS
     transform-origin in px would not match this 100x100 viewBox.
     Phase offsets keep the three arcs from ever merging into one stroke. */
  $('arcA').setAttribute('transform','rotate('+(  sp*44*boost +   0).toFixed(2)+' 50 50)');
  $('arcB').setAttribute('transform','rotate('+( -sp*63*boost + 140).toFixed(2)+' 50 50)');
  $('arcC').setAttribute('transform','rotate('+(  sp*30*boost + 250).toFixed(2)+' 50 50)');
  $('arcA').style.opacity=(0.30+0.55*load).toFixed(3);
  $('arcB').style.opacity=(0.24+0.55*load).toFixed(3);
  $('arcC').style.opacity=(0.18+0.55*load).toFixed(3);

  /* radar sweep: only visible while it is actually searching */
  $('sweep').setAttribute('transform','rotate('+(sp*140).toFixed(2)+' 50 50)');
  $('sweep').style.opacity=(searching*0.8).toFixed(3);

  /* tick ring lights up progressively as postings get scored */
  var scored = seg(t, 13000, 17200);
  tickEls.forEach(function(tk,i){
    var on = (i/tickEls.length) < scored ? 1 : 0;
    tk.style.opacity = (0.15 + on*0.75*searching).toFixed(3);
  });

  /* heart: period shortens under load */
  var period = 900 - load*560;
  var beat = 1 + (0.10 + 0.10*load) * Math.sin(t/period*Math.PI*2);
  $('heart').style.transform='scale('+beat.toFixed(3)+')';
  $('heart').style.boxShadow='0 0 '+(16+load*22)+'px '+(4+load*5)+'px rgba(232, 96, 79,'+(0.38+load*0.3)+')';

  var hp=(t/1600)%1;
  $('halo').style.transform='scale('+(1+hp*1.8)+')';
  $('halo').style.opacity=(0.5*(1-hp)*searching).toFixed(3);

  /* ================= 1 · drag → drop → upload → read =================
     Timings (ms):
       600–1900  cursor drags the file toward the zone
       1500      zone starts reacting (cursor is over it)
       1900      drop
       2000–3300 upload bar fills
       3300      done, file settles into the frame
       4200–5600 line flies to the core, scan runs across the page      */
  var DRAG_A=600, DRAG_B=1900;
  var UP_A=2000,  UP_B=3300;
  var SETTLE=3300, SETTLE_B=3900;
  var LINE_A=4200, LINE_B=5600;

  var dzC = {x:CV.x, y:CV.y-20};              // rest spot: clearly above the upload row
  var dragFrom = {x:CV.x-186, y:CV.y-150};    // file starts up-left, outside

  /* --- the ghost file --- */
  var dragK  = outC(seg(t, DRAG_A, DRAG_B));
  var settleK= outC(seg(t, SETTLE, SETTLE_B));

  var gx = dragFrom.x + (dzC.x - dragFrom.x)*dragK;
  var gy = dragFrom.y + (dzC.y - dragFrom.y)*dragK;

  /* small while carried → fits the zone once dropped (0.94 clears the bar) */
  var gs = 0.56 + 0.34*settleK;
  /* tilted while carried, level once dropped */
  var tilt = -7 * (1 - Math.max(seg(t,DRAG_B-260,DRAG_B+140), settleK));

  var ghostVis = fade(t, DRAG_A-120, DRAG_A+240, 6100, 6600);
  $('ghost').style.opacity = ghostVis.toFixed(3);
  $('ghost').style.transform =
    'translate('+(gx-50)+'px,'+(gy-65)+'px) scale('+gs.toFixed(3)+') rotate('+tilt.toFixed(2)+'deg)';
  /* while uploading the page is dim; it brightens as the bar completes */
  $('ghost').style.filter = 'brightness('+(0.62+0.38*seg(t,UP_A,UP_B)).toFixed(3)+')';

  /* --- dropzone reaction --- */
  var over   = t>=1500 && t<DRAG_B;
  var filled = t>=DRAG_B;
  $('dz').classList.toggle('over', over);
  $('dz').classList.toggle('filled', filled);

  /* prompt text fades out as the file lands */
  var promptOut = 1 - seg(t, DRAG_B-140, DRAG_B+260);
  $('dzIcon').style.opacity = promptOut.toFixed(3);
  $('dzTxt').style.opacity  = promptOut.toFixed(3);
  $('dzSub').style.opacity  = promptOut.toFixed(3);

  /* --- upload bar --- */
  var upK = seg(t, UP_A, UP_B);
  var upVis = fade(t, DRAG_B, DRAG_B+220, 5900, 6400);
  $('up').style.opacity = upVis.toFixed(3);
  $('up').style.transform = 'translateY('+(6*(1-seg(t,DRAG_B,DRAG_B+220)))+'px)';
  $('upBar').style.width = (upK*100).toFixed(1)+'%';
  var pct = Math.round(upK*100);
  if($('upPct').textContent !== pct+'%') $('upPct').textContent = pct+'%';
  $('upPct').classList.toggle('done', upK>=1);
  $('upBar').classList.toggle('done', upK>=1);

  /* --- line to the core; scan sweeps the page as it goes --- */
  runLine(sp1, outC(seg(t, LINE_A, LINE_B)));
  var sc = seg(t, LINE_A-200, LINE_B-300);
  $('scan').style.top = (8+sc*84)+'%';
  $('scan').style.opacity = (sc>0.02 && sc<0.98) ? 1 : 0;
  $('cvfill').style.height = (sc*99)+'%';

  /* 2 · chips bloom, then get absorbed back before the camera leaves */
  chipEls.forEach(function(e,i){
    var a=7200+i*150;
    var o=fade(t,a,a+500, 12200+i*60, 13000+i*60);
    var s0=0.6+0.4*outC(seg(t,a,a+500));
    var s1=1-0.25*seg(t,12200+i*60,13000+i*60);   // shrink inward as absorbed
    e.style.opacity=o.toFixed(3);
    e.style.transform='translate(-50%,-50%) scale('+(s0*s1).toFixed(3)+')';
  });

  /* connective spines, quiet */
  /* connective spine to the field, quiet. Nothing draws into the shortlist
     except the three convergence lines below — one per card. */
  sp2.p.style.opacity=0.3; runLine(sp2, outC(seg(t,11400,13000)));

  /* 3 · probe, score, cull.
     Each ray reaches a posting, a score appears, then low scores are
     culled — the line retracts and the dot fades. Only 3 survive. */
  var REACH=780, SCORE_AT=520, CULL=17400, CULL_SPAN=900;
  rays.forEach(function(r,i){
    var a = 12600 + i*36;

    /* line grows out to the posting */
    var grow = outC(seg(t, a, a+REACH));

    /* culled rays RETRACT: dashoffset climbs back toward L */
    var retract = r.keep ? 0 : outC(seg(t, CULL+i*22, CULL+i*22+CULL_SPAN));
    var draw = grow * (1 - retract);
    r.p.setAttribute('stroke-dashoffset', r.L*(1-draw));

    var appear = seg(t, a, a+200);
    var peak   = r.keep ? 0.95 : 0.5;
    var dimAfterScore = r.keep ? 1 : (1 - 0.45*seg(t, a+SCORE_AT+200, a+1100));
    r.p.style.opacity = (appear * peak * dimAfterScore * (1-retract)).toFixed(3);

    /* dot: lands, then survivors swell, losers shrink away */
    var landed = seg(t, a+SCORE_AT, a+SCORE_AT+280);
    var death  = r.keep ? 0 : seg(t, CULL+i*22, CULL+i*22+CULL_SPAN*0.7);
    r.c.style.opacity = (landed * (r.keep?1:0.72) * (1-death)).toFixed(3);
    r.c.setAttribute('r', r.keep
      ? (2.4 + 1.4*seg(t, a+SCORE_AT, a+1400))
      : (2.4 * (1-0.6*death)));

    /* score label next to each posting */
    if(r.lab){
      var lv = landed * (1 - (r.keep ? 0 : seg(t, CULL+i*22-200, CULL+i*22+400)));
      r.lab.style.opacity = (lv * (r.keep?1:0.6)).toFixed(3);
    }
  });

  /* survivors pulse once at the moment of selection */
  rays.forEach(function(r){
    if(!r.keep) return;
    var pk = seg(t, CULL+200, CULL+700) * (1-seg(t, CULL+700, CULL+1300));
    r.c.setAttribute('r', (2.4+1.4) + pk*2.6);
  });

  /* 4 · converge → shortlist (starts only AFTER the cull settles) */
  conv.forEach(function(c,i){
    var a=18900+i*190;
    c.p.setAttribute('stroke-dashoffset', c.L*(1-outC(seg(t,a,a+950))));
    c.p.style.opacity = fade(t,a,a+220, 25600,26400).toFixed(3);
  });
  jobEls.forEach(function(e,i){
    var a=19800+i*230;
    var o=fade(t,a,a+520,25400+i*90,26200+i*90);
    e.style.opacity=o.toFixed(3);
    e.style.transform='translate(-50%,-50%) scale('+(0.86+0.14*outC(seg(t,a,a+520))).toFixed(3)+')';
    e.querySelector('.pc i').style.width=(outC(seg(t,a+250,a+1100))*JOBD[i].p)+'%';
  });

  /* 5 · shortlist → panel */
  runLine(sp4, outC(seg(t,25000,26200)));

  /* 6 · panel */
  $('panel').style.opacity=fade(t,25800,26500,30200,31000).toFixed(3);
  $('panel').style.transform='scale('+(0.94+0.06*outC(seg(t,25800,26600))).toFixed(3)+')';
  var ok=seg(t,26400,27000), nk=seg(t,27400,28100);
  $('rwOld').style.opacity=ok; $('rwOld').style.transform='translateX('+(-7*(1-ok))+'px)';
  $('rwNew').style.opacity=nk; $('rwNew').style.transform='translateX('+(-7*(1-nk))+'px)';
  $('rwFt').style.opacity=seg(t,28400,29200);

  /* ---- 7 · submit ------------------------------------------------------
     A focus stack. Each window enters at the waiting slot, slides forward to
     the active slot to be filled and clicked, then recedes to the done slot.
     Only one window is on screen at a time, so nothing overlaps and every
     button is unobstructed. VNG (blocked) is last and stays.              */
  var SEND_T0=30800, STAGGER=2425;
  var LINE=620;         // line flight time
  var TYPE=300;         // per-field typing time
  var GAP_F=75;         // pause between fields
  var FLY=330;          // cursor travel to the button
  var HOLD=130;         // hover before pressing
  var PRESS=210;        // mouse-down to mouse-up
  var ENTER=400;        // slide in from the right
  var EXIT=400;         // slide out to the left
  var REST=300;         // dwell after click before leaving

  out.forEach(function(o,i){
    var t0=SEND_T0+i*STAGGER;
    o.p.style.opacity = fade(t, t0, t0+120, t0+LINE+220, t0+LINE+560).toFixed(3);
    runLine(o, outC(seg(t, t0, t0+LINE)));
  });

  function sched(i,nFields){
    var t0    = SEND_T0 + i*STAGGER;
    var land  = t0 + LINE;                 // spark lands
    var inA   = land - 120;                // window starts sliding in
    var inB   = inA + ENTER;               // arrived at centre
    var typeA = inB + 60;
    var typeB = typeA + (nFields-1)*(TYPE+GAP_F) + TYPE;
    var flyA  = typeB + 80;
    var flyB  = flyA + FLY;
    var down  = flyB + HOLD;
    var up    = down + PRESS;
    var outA  = up + REST;                 // window starts sliding out
    var outB  = outA + EXIT;
    /* the blocked window is last and never leaves */
    if(i===2){ outA = 1e9; outB = 1e9; }
    return {t0:t0,land:land,inA:inA,inB:inB,typeA:typeA,typeB:typeB,
            flyA:flyA,flyB:flyB,down:down,up:up,outA:outA,outB:outB};
  }

  var activeCursor=null;

  winEls.forEach(function(w,i){
    var s = sched(i, w.txts.length);
    var isHeld = w.win.state==='held';

    /* horizontal glide: off-right → centre → off-left. Only one window is
       ever near centre, so nothing overlaps and no button is covered. */
    var inK  = outC(seg(t, s.inA,  s.inB));
    var outK = outC(seg(t, s.outA, s.outB));
    var x = 320*(1-inK) - 320*outK;
    var scale = 0.92 + 0.08*inK - 0.05*outK;

    /* visible from just before entering until it leaves — and everything
       clears as the outro arrives (covers the blocked window too). */
    var vis = Math.min(
      fade(t, s.inA, s.inA+200, s.outA, s.outB),
      1 - seg(t, 38400, 39000)
    );

    w.el.style.zIndex = 20 + i;
    w.el.style.opacity = vis.toFixed(3);
    w.el.style.transform =
      'translate(calc(-50% + '+x.toFixed(1)+'px), -50%) scale('+scale.toFixed(3)+')';

    /* fields type themselves */
    w.txts.forEach(function(tx,j){
      var a = s.typeA + j*(TYPE+GAP_F), b = a + TYPE;
      var full = tx.dataset.full || '';
      var n = Math.floor(seg(t,a,b) * full.length);
      if(tx.textContent.length !== n) tx.textContent = full.slice(0,n);
      var typing = (t>=a-90 && t<=b+140);
      w.cars[j].style.opacity = typing ? (Math.floor(t/380)%2 ? 1 : 0.15) : 0;
      w.inps[j].classList.toggle('filed', t>=b);
    });

    var armed = t >= s.typeB + 50;
    var hover = t >= s.flyB && t < s.down;
    var down  = t >= s.down && t < s.up;
    var doneT = t >= s.up;

    if(isHeld){
      var blocked = armed;
      w.btn.className = 'btn' + (blocked ? ' locked' : '');
      var hl = blocked ? 'Chờ bạn xác nhận' : 'Gửi hồ sơ';
      if(w.lbl.textContent !== hl) w.lbl.textContent = hl;
      var hk = blocked ? 'lock' : 'up';
      if(w.ico.dataset.k !== hk){
        w.ico.innerHTML = blocked ? w.ICO.LOCK : w.ICO.UP;
        w.ico.dataset.k = hk;
      }
      w.el.classList.toggle('held', blocked);
      if(w.cap) w.cap.style.opacity = seg(t, s.typeB-100, s.typeB+380).toFixed(3);
      w.btn.style.transform='scale(1)';
      w.rip.style.opacity=0;
    } else {
      var cls='btn';
      if(doneT)      cls+=' sent';
      else if(down)  cls+=' ready';
      else if(hover) cls+=' hover';
      else if(armed) cls+=' ready';
      w.btn.className=cls;

      var wl = doneT ? 'Đã gửi' : 'Gửi hồ sơ';
      if(w.lbl.textContent !== wl) w.lbl.textContent = wl;
      var wk = doneT ? 'ok' : 'up';
      if(w.ico.dataset.k !== wk){
        w.ico.innerHTML = doneT ? w.ICO.OK : w.ICO.UP;
        w.ico.dataset.k = wk;
      }
      w.el.classList.toggle('done', doneT);

      var pk = down ? Math.sin(seg(t,s.down,s.up)*Math.PI) : 0;
      w.btn.style.transform = 'scale('+(1-0.045*pk).toFixed(3)+')';

      var rk = seg(t, s.down, s.up+240);
      w.rip.style.opacity = (rk>0 && rk<1) ? (0.55*(1-rk)).toFixed(3) : 0;
      w.rip.style.transform = 'translate(-50%,-50%) scale('+(rk*11).toFixed(2)+')';
    }

    if(t >= s.flyA - 60 && t < s.up + 200) activeCursor = {w:w,s:s,i:i,held:isHeld,wx:x,wsc:scale};
  });

  /* ---- the cursor: drags at the start, clicks at the end ---- */
  if(t >= DRAG_A-160 && t < DRAG_B+420){
    /* DRAG: cursor holds the file's top-left corner */
    var cxD = gx - 30*gs;
    var cyD = gy - 42*gs;
    /* release: it lifts away up-right after the drop */
    var rel = seg(t, DRAG_B+60, DRAG_B+420);
    cxD += 26*rel; cyD -= 18*rel;

    cursor.style.left = (cxD-2)+'px';
    cursor.style.top  = (cyD-2)+'px';
    cursor.style.opacity = fade(t, DRAG_A-160, DRAG_A+60, DRAG_B+180, DRAG_B+420).toFixed(3);
    /* squeeze while gripping, release on drop */
    var grip = 1 - 0.1*(1 - seg(t, DRAG_B, DRAG_B+180));
    cursor.style.transform = 'scale('+grip.toFixed(3)+')';

    /* a ring pings at the moment of release */
    var dr = seg(t, DRAG_B, DRAG_B+520);
    cursorRing.style.opacity = (dr>0 && dr<1) ? (0.7*(1-dr)).toFixed(3) : 0;
    cursorRing.style.transform = 'translate(-50%,-50%) scale('+(0.2+dr*1.7).toFixed(2)+')';
  }
  else if(activeCursor && btnOff.length===3){
    /* CLICK: the button's live centre = station + slot offset + button offset,
       Window sits at SENT centre plus a horizontal offset (wx), scaled by
       wsc. Button centre = that + button's own offset, all scaled. */
    var a=activeCursor, o=btnOff[a.i], wx=a.wx, wsc=a.wsc, s=a.s;
    var bx = SENT.x + wx + o.dx*wsc;
    var by = SENT.y + o.dy*wsc;
    var bw = o.w*wsc;

    var target = {x: bx - bw*0.18, y: by - 1};
    var from   = {x: SENT.x + wx - WIN_W*wsc/2 - 30, y: by + 30};
    var k = outC(seg(t, s.flyA, s.flyB));
    var cxp = from.x + (target.x - from.x)*k;
    var cyp = from.y + (target.y - from.y)*k;

    if(!a.held && t>=s.down && t<s.up) cyp += 1.4*Math.sin(seg(t,s.down,s.up)*Math.PI);

    if(a.held && t>=s.down-80 && t<s.up+120){
      var shake = seg(t, s.down-80, s.up+120);
      cxp += 2.2*Math.sin(shake*Math.PI*5) * (1-shake);
    }

    cursor.style.left = (cxp-2)+'px';
    cursor.style.top  = (cyp-2)+'px';
    cursor.style.opacity = fade(t, s.flyA-60, s.flyA+160, s.up+40, s.up+200).toFixed(3);

    var pressK = (!a.held && t>=s.down && t<s.up) ? Math.sin(seg(t,s.down,s.up)*Math.PI) : 0;
    cursor.style.transform = 'scale('+(1-0.12*pressK).toFixed(3)+')';

    if(a.held){
      cursorRing.style.opacity = 0;
    } else {
      var rk2 = seg(t, s.down, s.up+220);
      cursorRing.style.opacity = (rk2>0 && rk2<1) ? (0.75*(1-rk2)).toFixed(3) : 0;
      cursorRing.style.transform = 'translate(-50%,-50%) scale('+(0.2+rk2*1.5).toFixed(2)+')';
    }
  }
  else {
    cursor.style.opacity = 0;
    cursorRing.style.opacity = 0;
  }

  /* 8 · outro */
  var oK=seg(t,38700,39700);
  $('outro').style.opacity=oK.toFixed(3);
  $('outro').style.transform='translate(-50%,-50%) translateY('+(14*(1-outC(oK)))+'px)';

  /* captions — one at a time, short clean crossfade */
  capEls.forEach(function(e,i){
    var c=CAPS[i];
    e.style.opacity=fade(t,c[0],c[0]+FADE,c[1]-FADE,c[1]).toFixed(3);
    e.style.transform='translateY('+(9*(1-outC(seg(t,c[0],c[0]+FADE)))-9*seg(t,c[1]-FADE,c[1]))+'px)';
  });

  var prog=t/DUR;
  $('rail').style.width=(prog*100)+'%';
  $('fg').style.width=(prog*100)+'%';
  $('knob').style.left=(prog*100)+'%';
  $('tm').textContent=fmt(t)+' / '+fmt(DUR);
}
function fmt(ms){var s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

/* ---------------- clock (state; the loop lives at the bottom) ---------------- */
var t=0,last=null,paused=false;

var pp=$('pp'),ic=$('ic'),scrub=$('scrub');
var PLAY='<path d="M1 .6v10.8L10.5 6z"/>',PAUSE='<rect x="0" width="3.2" height="12" rx="1"/><rect x="7" width="3.2" height="12" rx="1"/>';
function scrubTo(e){
  var r=scrub.getBoundingClientRect();
  var x=((e.touches?e.touches[0].clientX:e.clientX)-r.left)/r.width;
  t=cl(x,0,1)*DUR; render(t);
}
var drag=false;
scrub.addEventListener('mousedown',function(e){drag=true;scrubTo(e);});
reg(window, 'mousemove',function(e){if(drag)scrubTo(e);});
reg(window, 'mouseup',function(){drag=false;});
scrub.addEventListener('touchstart',function(e){drag=true;scrubTo(e);},{passive:true});
reg(window, 'touchmove',function(e){if(drag)scrubTo(e);},{passive:true});
reg(window, 'touchend',function(){drag=false;});

/* Buttons must be measured after fonts land, or their box shifts. */
measureButtons();
if(document.fonts && document.fonts.ready){
  document.fonts.ready.then(function(){ measure(); measureButtons(); });
}

/* ============================================================
   FLOAT: tilt toward the cursor, spotlight sheen, scroll reveal
   ============================================================ */
var floatEl=$('float'), tiltEl=$('tilt'), sheenEl=$('sheen'), headEl=$('howHead');
var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var fine   = window.matchMedia('(pointer: fine)').matches;

/* pointer-driven tilt, eased. Kept gentle (±4°) so the buttons stay clickable. */
var trx=0, try_=0, crx=0, cry=0, tiltRAF=null;
function onMove(e){
  if(!fine || reduce) return;
  var r=floatEl.getBoundingClientRect();
  var mx=(e.clientX-r.left)/r.width;         // 0..1
  var my=(e.clientY-r.top)/r.height;
  trx = (0.5-my)*8;                          // rotateX: max ±4°
  try_= (mx-0.5)*8;                          // rotateY: max ±4°
  sheenEl.style.setProperty('--mx',(mx*100)+'%');
  sheenEl.style.setProperty('--my',(my*100)+'%');
  if(!tiltRAF) tiltRAF=requestAnimationFrame(tiltLoop);
}
function tiltLoop(){ if(!__alive)return;
  crx += (trx-crx)*0.12;
  cry += (try_-cry)*0.12;
  tiltEl.style.setProperty('--rx',crx.toFixed(2)+'deg');
  tiltEl.style.setProperty('--ry',cry.toFixed(2)+'deg');
  if(Math.abs(trx-crx)>0.02 || Math.abs(try_-cry)>0.02){
    tiltRAF=requestAnimationFrame(tiltLoop);
  } else { tiltRAF=null; }
}
function onLeave(){ trx=0; try_=0; if(!tiltRAF) tiltRAF=requestAnimationFrame(tiltLoop); }
if(fine && !reduce){
  floatEl.addEventListener('mousemove',onMove);
  floatEl.addEventListener('mouseleave',onLeave);
}

/* reveal heading + frame when the section scrolls in */
var revealed=false;
var revObs=new IntersectionObserver(function(es){
  es.forEach(function(e){
    if(e.isIntersecting){
      headEl.classList.add('in');
      floatEl.classList.add('in');
      revealed=true;
      revObs.disconnect();
    }
  });
},{threshold:0.2});
revObs.observe(floatEl);

/* ---- the clock: only runs while the section is on screen, and only
   after it has first been revealed. Restarts from 0 on first entry so the
   viewer always catches the opening beat. ---- */
var onScreen=false, started=false;
var playObs=new IntersectionObserver(function(es){
  es.forEach(function(e){
    onScreen = e.isIntersecting && e.intersectionRatio>0.35;
    if(onScreen && !started){ t=0; last=null; started=true; }
  });
},{threshold:[0,0.35,0.6]});
playObs.observe(floatEl);

/* gate the loop on visibility (and honour the play/pause button) */
var userPaused=false;
function setPlayIcon(){ ic.innerHTML = (userPaused? PLAY:PAUSE); pp.setAttribute('aria-label', userPaused?'Phát':'Tạm dừng'); }
pp.onclick=function(){ userPaused=!userPaused; setPlayIcon(); if(!userPaused){ last=null; } };

if(reduce){
  paused=true; ic.innerHTML=PLAY; render(20000);
} else {
  paused=false;
  requestAnimationFrame(function loop2(now){ if(!__alive)return;
    if(last===null) last=now;
    var dt=Math.min(now-last,50); last=now;
    var run = onScreen && !userPaused;
    if(run){ t+=dt; if(t>=DUR) t-=DUR; }
    render(t);
    requestAnimationFrame(loop2);
  });
}
  cleanups.push(function(){ try { revObs.disconnect(); } catch (e) {} try { playObs.disconnect(); } catch (e) {} });
  return function(){ __alive = false; cleanups.forEach(function(f){ try { f(); } catch (e) {} }); };
}
