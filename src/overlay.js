// DOM overlays: title, chapters, captions, telemetry HUD, tidal arrows, disclaimers, final question.
import * as THREE from 'three';
import { RE, RM, D0, T, ROCHE_RIGID, ROCHE_FLUID, sstep, clamp, fmtKm } from './sim.js';

const fade = (t, a, d, fi = 0.8, fo = 0.8) => clamp(Math.min((t - a) / fi, (a + d - t) / fo));
const $ = (id) => document.getElementById(id);

export class Overlay {
  constructor(script) {
    this.script = script;
    this.cap = $('caption'); this.title = $('title'); this.chap = $('chapter'); this.hud = $('hud'); this.q = $('question');
    this.disc = $('disclaimer'); this.tag = $('brand'); this.roche = $('roche'); this.arrows = $('arrows'); this.tc = $('timecode');
    this.lastCap = -1;
  }
  update(t, s, cam, shot, opts = {}) {
    const S = this.script;
    // caption
    let line = null; for (let i = 0; i < S.lines.length; i++) { const l = S.lines[i]; if (t >= l.t && t < l.t + l.d + 0.4) { line = l; break; } }
    if (line) { if (this.cap.dataset.t !== String(line.t)) { this.cap.textContent = line.text; this.cap.dataset.t = String(line.t); } this.cap.style.opacity = fade(t, line.t, line.d + 0.4, 0.6, 0.6); } else this.cap.style.opacity = 0;
    // title
    const ot = S.overlays[0];
    const ta = fade(t, ot.t + 2.0, ot.d - 2.6, 1.4, 1.4);
    this.title.style.opacity = ta; this.title.style.letterSpacing = (0.34 + 0.03 * (t / 14)) + 'em';
    // chapters
    let ch = null; for (const c of S.chapters) if (t >= c.t + 0.4 && t < c.t + 6.4) ch = c;
    if (ch) { this.chap.innerHTML = `<b>${ch.label}</b><span>${ch.name}</span>`; this.chap.style.opacity = fade(t, ch.t + 0.4, 6, 0.8, 1.2); } else this.chap.style.opacity = 0;
    // HUD telemetry (58 → 330)
    const hv = sstep(60, 62, t) * (1 - sstep(329.5, 330.2, t));
    this.hud.style.opacity = hv;
    if (hv > 0.01) {
      const km = fmtKm(s.d), surf = fmtKm(Math.max(s.d - RE, 0));
      const tide = s.tideRatio < 1.5 ? '1.0×' : s.tideRatio > 9999 ? Math.round(s.tideRatio).toLocaleString('en-US') + '×' : s.tideRatio.toFixed(s.tideRatio < 10 ? 1 : 0) + '×';
      const ang = Math.min(s.angDiam, 179);
      this.hud.innerHTML =
        `<div><i>MOON DISTANCE</i><b>${km}<u> km</u></b></div>` +
        `<div><i>ALTITUDE ABOVE SURFACE</i><b>${surf}<u> km</u></b></div>` +
        `<div><i>TIDAL FORCE vs TODAY</i><b>${tide}</b></div>` +
        `<div><i>APPARENT SIZE</i><b>${ang.toFixed(ang < 10 ? 2 : 1)}°<u> (${(ang / 0.52).toFixed(1)}× today)</u></b></div>`;
    }
    // Roche zone label
    const ra = fade(t, 205, 36, 1.2, 1.2);
    this.roche.style.opacity = ra;
    if (ra > 0.01) {
      const inside = s.d < ROCHE_FLUID;
      this.roche.innerHTML = `<i>ROCHE ZONE (ESTIMATE)</i><b>${Math.round(ROCHE_RIGID * 1000).toLocaleString('en-US')} – ${Math.round(ROCHE_FLUID * 1000).toLocaleString('en-US')} km</b><u>${inside ? 'MOON INSIDE THE ZONE' : 'MOON APPROACHING THE ZONE'} · ${fmtKm(s.d)} km</u>`;
    }
    // disclaimer (persistent small tag after the opening)
    this.disc.style.opacity = sstep(14, 16, t) * 0.78 * (1 - sstep(462, 466, t));
    const dd = S.overlays[1]; const big = fade(t, dd.t, dd.d, 1, 1);
    this.disc.classList.toggle('big', big > 0.01);
    this.tag.style.opacity = sstep(3, 5, t) * 0.85 * (1 - sstep(462, 466, t));
    // final question
    const q = S.overlays[2]; const qa = fade(t, q.t, q.d + 0.01, 3.2, 0.01);
    this.q.style.opacity = qa; this.q.style.transform = `translateY(${(1 - qa) * 10}px)`;
    // arrows (tidal force diagram)
    this.drawArrows(t, s, cam);
    if (opts.timecode) { const m = Math.floor(t / 60), sec = Math.floor(t % 60); this.tc.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} · ${shot}`; this.tc.style.display = 'block'; }
  }
  drawArrows(t, s, cam) {
    const el = this.arrows, a = fade(t, 160, 20, 3, 2.0) * 0.9;
    el.style.opacity = a;
    if (a < 0.01) { el.innerHTML = ''; return; }
    const W = 1920, H = 1080, v = new THREE.Vector3();
    const proj = (p) => { v.copy(p).project(cam); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; };
    const col = '#ffcf70';
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><marker id="ah" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto"><path d="M1,1 L11,6 L1,11 Z" fill="${col}"/></marker></defs>`;
    const dirs = [s.dir.clone(), s.dir.clone().negate()];
    dirs.forEach((d, i) => {
      for (const off of [-0.55, 0, 0.55]) {
        const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(d, up).normalize();
        const base = d.clone().multiplyScalar(RE * 1.02).addScaledVector(up, off * RE * 0.55).addScaledVector(side, 0);
        const len = (off === 0 ? 3.6 : 2.4) * (0.75 + 0.5 * s.tide);
        const tip = base.clone().addScaledVector(d, len);
        const A = proj(base), B = proj(tip);
        if (A[2] > 1 || B[2] > 1) continue;
        svg += `<line x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="${col}" stroke-width="3.2" stroke-linecap="round" marker-end="url(#ah)" opacity="0.92"/>`;
      }
      const lab = proj(d.clone().multiplyScalar(RE + 5.2));
      if (lab[2] < 1) svg += `<text x="${(lab[0] + 18).toFixed(1)}" y="${(lab[1] - 14).toFixed(1)}" fill="${col}" font-size="20" letter-spacing="3" font-family="Share Tech Mono, monospace">${i ? 'FAR-SIDE BULGE' : 'NEAR-SIDE BULGE'}</text>`;
    });
    svg += '</svg>';
    el.innerHTML = svg + `<div class="note">TIDES EXAGGERATED FOR CLARITY · FORCE ∝ 1/d³</div>`;
  }
}
