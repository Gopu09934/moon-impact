// sim.js — the scripted physics of the hypothetical scenario.
// Everything is a pure function of time t (seconds), so any frame can be rendered
// independently and frame-exact renders can be split across many GitHub runners.
import * as THREE from 'three';

export const FPS = 30;
export const DURATION = 480;               // exactly 8:00

// World units: 1 unit = 1,000 km
export const RE = 6.371;                    // Earth radius
export const RM = 1.7374;                   // Moon radius
export const D0 = 384.4;                    // present Earth–Moon distance (centre to centre)
export const D_CONTACT = RE + RM;           // 8.108
export const GM = 32.4;                     // cinematic gravitational parameter (time is compressed)
export const ROCHE_RIGID = 9.5;             // ≈ 9,500 km
export const ROCHE_FLUID = 18.4;            // ≈ 18,400 km

// Key times
export const T = {
  HOOK_END: 14,
  APPROACH_START: 58,
  CRACK_START: 176,
  SPLIT_START: 200,
  RING_FORM_A: 215,
  RING_FORM_B: 282,
  IMPACT: 330,
  MOLTEN_END: 428,
};

export const SUN_DIR = new THREE.Vector3(0.45, 0.12, 0.88).normalize();
export const EARTH_TILT = THREE.MathUtils.degToRad(23.44);
export const EARTH_SPIN = 0.026;            // rad/s (time-lapse: one turn ≈ 4 min)
export const SITE = { lat: 0, lon: 80 };    // impact site: open Indian Ocean (hypothetical)
export const THETA_IMPACT = -THREE.MathUtils.degToRad(SITE.lon);

// ---------- utilities ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const sstepN = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => clamp(t) ** 3;

export function rng(seed) {                 // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// monotone cubic (Fritsch–Carlson) interpolation
function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---------- Moon–Earth distance (centre to centre) ----------
const KF = [
  [58, 384.4], [66, 310], [80, 200], [92, 130], [104, 92], [120, 64], [150, 44], [180, 32],
  [200, 27], [215, 23.8], [235, 19.6], [260, 16.2], [300, 11.6], [330, D_CONTACT],
];
const logD = pchip(KF.map((k) => k[0]), KF.map((k) => Math.log(k[1])));
export function moonDistance(t) {
  if (t <= KF[0][0]) return D0;
  if (t >= T.IMPACT) return D_CONTACT;
  return Math.exp(logD(t));
}
export const moonAlive = (t) => t < T.IMPACT;

// ---------- orbital phase (art-directed, monotone: the Moon spirals in and the path straightens into a near-radial plunge) ----------
const INCL = THREE.MathUtils.degToRad(5.1);
const PHI_KEYS = [[0, -2.98], [14, -2.95], [58, -2.55], [100, -2.15], [150, -1.75], [200, -1.35], [250, -0.95], [290, -0.55], [315, -0.24], [330, 0.0]];
const phiCurve = pchip(PHI_KEYS.map((k) => k[0]), PHI_KEYS.map((k) => k[1]));
export function moonPhase(t) { return phiCurve(clamp(t, 0, T.IMPACT)); }

export function moonDirAt(phi, out = new THREE.Vector3()) {
  return out.set(Math.cos(phi), Math.sin(INCL) * Math.sin(phi), Math.cos(INCL) * Math.sin(phi));
}

// ---------- Earth orientation ----------
export const earthTheta = (t) => THETA_IMPACT + EARTH_SPIN * (t - T.IMPACT);
export function earthMatrix(t, out = new THREE.Matrix4()) {
  const spin = new THREE.Matrix4().makeRotationY(earthTheta(t));
  const tilt = new THREE.Matrix4().makeRotationX(EARTH_TILT);
  return out.multiplyMatrices(tilt, spin);
}
/** Earth-fixed lat/lon (deg) → world position at radius r (unit sphere × r). Texture convention: lon = atan2(-z, x). */
export function surfacePoint(latDeg, lonDeg, t, r = RE, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(r);
  return out.applyMatrix4(earthMatrix(t));
}
export function surfaceNormal(latDeg, lonDeg, t, out = new THREE.Vector3()) {
  return surfacePoint(latDeg, lonDeg, t, 1, out);
}

// ---------- full scenario state ----------
const _m = new THREE.Matrix4();
export function state(t) {
  const d = moonDistance(t);
  const phi = moonPhase(t);
  const dir = moonDirAt(phi);
  const pos = dir.clone().multiplyScalar(d);
  const tang = new THREE.Vector3(-Math.sin(phi), Math.sin(INCL) * Math.cos(phi), Math.cos(INCL) * Math.cos(phi));
  const north = new THREE.Vector3().crossVectors(dir, tang).negate().normalize();
  const X = dir.clone().negate();                       // near side faces Earth (tidal lock)
  const Z = new THREE.Vector3().crossVectors(X, north).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  const moonBasis = _m.clone().makeBasis(X, Y, Z);
  const surfDist = d - RE;                               // distance from Earth's surface (sub-lunar point)
  const angDiam = THREE.MathUtils.radToDeg(2 * Math.atan(RM / Math.max(surfDist, RM * 1.0001)));
  const sunPhaseCos = dir.dot(SUN_DIR);
  // flood level (0..1) driven by tidal strength ∝ 1/d³
  const tideRatio = Math.pow(D0 / d, 3);
  return {
    t, d, phi, dir, pos, tang, north, moonBasis, surfDist, angDiam, tideRatio, sunPhaseCos,
    alive: t < T.IMPACT,
    theta: earthTheta(t),
    flood: Math.pow(sstep(112, 280, t), 0.72) * 0.95 + 0.05 * sstep(30, 112, t),
    tide: Math.min(1, 0.04 + 0.96 * Math.pow(clamp(Math.log(tideRatio) / Math.log(900)), 1.1)),
    crack: sstep(T.CRACK_START, T.SPLIT_START + 22, t),
    stretch: sstep(T.CRACK_START + 8, T.SPLIT_START + 45, t),
    split: sstep(T.SPLIT_START, T.SPLIT_START + 55, t),
    ring: sstep(T.RING_FORM_A + 8, T.RING_FORM_B + 25, t),
    impactT: t - T.IMPACT,
    molten: sstep(T.IMPACT + 2, T.MOLTEN_END, t),
    shock: Math.max(0, t - T.IMPACT),
  };
}

/** Narrative values for the HUD */
export const KM = (u) => u * 1000;
export function fmtKm(u) { return Math.round(KM(u)).toLocaleString('en-US'); }
