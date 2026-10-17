// Camera director: eight timed shots (00:00 → 08:00). Every shot is a pure function of t.
import * as THREE from 'three';
import { RE, RM, SUN_DIR, T, SITE, state, earthMatrix, surfacePoint, clamp, lerp, sstep, easeInOut, easeOut } from './sim.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const INCL = THREE.MathUtils.degToRad(5.1);
const mix = (a, b, u) => a.clone().lerp(b, u);
const ease = (a, b, t) => easeInOut(clamp((t - a) / (b - a)));

/** Cold-open: Moon looms enormous over Earth's limb (replaces the true Moon path for t < HOOK_END). */
const hookN = V(0.62, 0.52, 0.55).normalize();
const hookF = new THREE.Vector3().crossVectors(hookN, SUN_DIR).normalize();
const hookSide = new THREE.Vector3().crossVectors(hookF, hookN).normalize();
const HOOK_R = RE + 0.26;
const hookPos = (t) => {
  const th = 0.012 * t;
  const n = hookN.clone().multiplyScalar(Math.cos(th)).addScaledVector(hookF, Math.sin(th));
  const f = hookF.clone().multiplyScalar(Math.cos(th)).addScaledVector(hookN, -Math.sin(th));
  return { n, f, pos: n.clone().multiplyScalar(HOOK_R).addScaledVector(f, 0.05 * t) };
};
const HOOK_MOON = (() => { const h = hookPos(0); return h.pos.clone().addScaledVector(h.f, 14).addScaledVector(h.n, 0.6).addScaledVector(hookSide, -1.2); })();

export function applyHook(s) {
  if (s.t >= T.HOOK_END + 0.5) return s;
  const pos = HOOK_MOON.clone(), dir = pos.clone().normalize();
  s.pos.copy(pos); s.dir.copy(dir); s.d = pos.length();
  const north = V(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  const X = dir.clone().negate(), Y = north, Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  s.moonBasis.makeBasis(X, Y.clone().crossVectors(Z, X).normalize(), Z);
  s.tide = 0.12; s.flood = 0.0; s.surfDist = s.d - RE;
  return s;
}

// Surface observer (night-side North Pacific, under the full Moon)
const OBS = { lat: 53, lon: 165 };

function lookCam(c, shake = 0) { return c; }

export function shotAt(t, s) {
  const M = s.pos, a = s.dir, b = s.north, c = s.tang;
  let cam = { pos: V(), target: V(), fov: 35, roll: 0, up: UP, near: 0.05, shake: 0.0006, exposure: 1, bloom: 0.35, fade: 0, flash: 0, name: '' };

  // ------------------------------------------------ Shot 0 — hook (00:00–00:14)
  if (t < T.HOOK_END) {
    const h = hookPos(t);
    cam.pos = h.pos;
    const look = h.f.clone().multiplyScalar(10).addScaledVector(h.n, 0.15).addScaledVector(hookSide, -0.5);
    cam.target = h.pos.clone().add(look);
    cam.up = h.n; cam.fov = lerp(50, 44, t / T.HOOK_END); cam.near = 0.02; cam.shake = 0.0009; cam.bloom = 0.4; cam.exposure = 1.05;
    cam.fade = 1 - sstep(0.0, 2.6, t) + sstep(12.2, 13.9, t);
    cam.name = 'hook';
    return cam;
  }

  // ------------------------------------------------ Shot 1 — establishing (00:14–01:00)
  if (t < 60) {
    const u = (t - T.HOOK_END) / (60 - T.HOOK_END);
    const sg = Math.sign(new THREE.Vector3().crossVectors(a, UP).dot(SUN_DIR)) || 1;
    const side = new THREE.Vector3().crossVectors(a, UP).normalize().multiplyScalar(sg);
    const L = lerp(62, 27, easeInOut(u)), off = lerp(26, 13, easeInOut(u));
    cam.pos = a.clone().multiplyScalar(-L).addScaledVector(side, off).addScaledVector(UP, lerp(6, 3, u));
    const dE = cam.pos.clone().negate().normalize(), dM = M.clone().sub(cam.pos).normalize();
    const w = easeInOut(sstep(0.46, 0.96, u));
    const q = new THREE.Quaternion().setFromUnitVectors(dE, dM);
    const qi = new THREE.Quaternion().slerp(q, w);
    cam.target = cam.pos.clone().add(dE.clone().applyQuaternion(qi).multiplyScalar(200));
    cam.fov = lerp(36, 24, easeInOut(u));
    cam.near = 0.4; cam.fade = sstep(0, 1, 1 - (t - T.HOOK_END) / 1.4) * 0.999; cam.bloom = 0.32;
    cam.name = 'establishing';
    return cam;
  }

  // ------------------------------------------------ Shot 2 — the Moon grows (01:00–02:00)
  if (t < 97) {
    const u = (t - 60) / 37, e = easeInOut(u);
    const dist = lerp(60, 8.5, Math.pow(e, 1.15));
    const sg = Math.sign(new THREE.Vector3().crossVectors(a, UP).dot(SUN_DIR)) || 1;
    const side = new THREE.Vector3().crossVectors(a, UP).normalize().multiplyScalar(sg);
    cam.pos = M.clone().addScaledVector(a, -dist).addScaledVector(side, dist * 0.22).addScaledVector(UP, dist * 0.06);
    cam.target = M.clone();
    cam.fov = lerp(24, 30, e); cam.near = 0.05; cam.bloom = 0.3;
    cam.fade = sstep(95.2, 96.9, t);
    cam.name = 'dolly';
    return cam;
  }
  if (t < 122) {                                   // cut: view from Earth's surface
    const tt = t;
    const sub = surfacePoint(OBS.lat, OBS.lon, tt, RE + 0.016);
    cam.pos = sub; cam.up = sub.clone().normalize();
    const toM = M.clone().sub(sub).normalize();
    const right = new THREE.Vector3().crossVectors(toM, cam.up).normalize();
    const pitchDown = THREE.MathUtils.degToRad(5.5);
    const dirLook = toM.clone().applyAxisAngle(right, -pitchDown);
    cam.target = sub.clone().addScaledVector(dirLook, 100);
    cam.fov = lerp(36, 27, easeInOut((t - 97) / 25)); cam.near = 0.002; cam.exposure = 1.9; cam.bloom = 0.4; cam.shake = 0.0009;
    cam.fade = 1 - sstep(97, 98.2, t) + sstep(120.6, 122, t);
    cam.name = 'surface';
    return cam;
  }

  // ------------------------------------------------ Shot 3 — gravitational effects (02:00–03:00)
  if (t < 180) {
    const u = (t - 122) / 58;
    // (a) glide over the sunlit ocean, looking towards the sun-glint; Earth turns beneath us
    const g = easeInOut(clamp(u / 0.55));
    const ang = THREE.MathUtils.degToRad(lerp(58, 30, g));
    const sideV = new THREE.Vector3().crossVectors(SUN_DIR, UP).normalize();
    const alt = lerp(3.4, 6.0, g);
    const camDir = SUN_DIR.clone().multiplyScalar(Math.cos(ang)).addScaledVector(sideV, Math.sin(ang)).normalize();
    const wp = camDir.clone().multiplyScalar(RE + alt);
    const tgtSweep = SUN_DIR.clone().multiplyScalar(RE * 0.97).addScaledVector(sideV, -RE * lerp(0.0, 0.25, g));
    // (b) pull out to a broadside diagram view: Earth left, Moon right
    const sg = Math.sign(new THREE.Vector3().crossVectors(a, UP).dot(SUN_DIR)) || 1;
    const side = new THREE.Vector3().crossVectors(a, UP).normalize().multiplyScalar(sg);
    const diag = side.clone().multiplyScalar(46).addScaledVector(a, 6).addScaledVector(UP, 5);
    const w = ease(0.55, 0.96, u);
    cam.pos = mix(wp, diag, w);
    const tgtDiag = a.clone().multiplyScalar(s.d * 0.36);
    cam.target = mix(tgtSweep, tgtDiag, w);
    cam.up = mix(wp.clone().normalize(), UP, w).normalize();
    cam.fov = lerp(50, 44, w); cam.near = lerp(0.01, 0.5, w); cam.exposure = lerp(1.0, 1.0, w); cam.bloom = 0.35;
    cam.fade = sstep(0, 1, 1 - (t - 122) / 1.4) * 0.999;
    cam.name = 'tides';
    return cam;
  }

  // ------------------------------------------------ Shot 4 — lunar breakup (03:00–04:00)
  if (t < 240) {
    const u = (t - 180) / 60;
    const psi = THREE.MathUtils.degToRad(lerp(18, 112, easeInOut(u)));
    const el = THREE.MathUtils.degToRad(lerp(12, 22, u));
    const dist = lerp(10.5, 21, sstep(0.05, 1, u));
    const off = a.clone().multiplyScalar(-Math.cos(psi)).addScaledVector(c, Math.sin(psi)).multiplyScalar(Math.cos(el)).addScaledVector(b, Math.sin(el));
    const centre = M.clone().addScaledVector(a, sstep(0.45, 1, u) * 1.2);
    cam.pos = centre.clone().addScaledVector(off, dist);
    cam.target = centre; cam.fov = lerp(30, 34, u); cam.near = 0.05; cam.shake = 0.0011 + 0.0015 * s.split; cam.bloom = 0.4;
    cam.fade = sstep(0, 1, 1 - (t - 180) / 1.4) * 0.999;
    cam.name = 'breakup';
    return cam;
  }

  // ------------------------------------------------ Shot 5 — debris field (04:00–05:00)
  if (t < 300) {
    const u = (t - 240) / 60;
    const ang = 0.9 + 0.032 * (t - 240) + Math.PI * 0.25;
    const R = lerp(17, 12.5, easeInOut(u));
    const y0 = lerp(0.35, 0.9, sstep(0, 0.5, u)) + 7.5 * sstep(0.72, 1, u) * sstep(0.72, 1, u);
    const tilt = new THREE.Matrix4().makeRotationX(INCL);
    const p = V(R * Math.cos(ang), y0, R * Math.sin(ang)).applyMatrix4(tilt);
    const ahead = V(R * 0.86 * Math.cos(ang + 0.45), y0 * 0.4 - 0.2, R * 0.86 * Math.sin(ang + 0.45)).applyMatrix4(tilt);
    cam.pos = p;
    cam.target = mix(ahead, V(), sstep(0.72, 1, u) * 0.75);
    cam.roll = THREE.MathUtils.degToRad(lerp(0, 13, u) + 4 * Math.sin(t * 0.17));
    cam.fov = lerp(48, 40, u); cam.near = 0.012; cam.shake = 0.0016; cam.bloom = 0.4; cam.exposure = 1.15;
    cam.fade = sstep(0, 1, 1 - (t - 240) / 1.2) * 0.999;
    cam.name = 'debris';
    return cam;
  }

  // ------------------------------------------------ Shot 6 — impact (05:00–06:00)
  if (t < 360) {
    const ti = t - T.IMPACT;
    const tilt = V(0, Math.sin(INCL), Math.cos(INCL));
    if (t < 324.4) {                                   // tracking shot, camera abeam of the plunging Moon
      const u = (t - 300) / 24.4;
      const dist = lerp(15, 21, easeInOut(u));
      cam.pos = M.clone().addScaledVector(c, dist).addScaledVector(b, 2.6).addScaledVector(a, 1.5 + 4 * u);
      cam.target = M.clone().addScaledVector(a, -1.5 * u).addScaledVector(c, 0);
      cam.fov = lerp(34, 38, u); cam.near = 0.05; cam.shake = 0.0014 + 0.0016 * u; cam.bloom = 0.45; cam.exposure = 1.0;
      cam.fade = sstep(0, 1, 1 - (t - 300) / 1.2) * 0.999;
      cam.name = 'impact-track';
      return cam;
    }
    // wide cut just before contact
    const k = (t - 324.4);
    const wide = V(7.2 - 0.04 * k, 2.8, 34 - 0.35 * k).applyMatrix4(new THREE.Matrix4());
    if (t < 345) {
      cam.pos = wide; cam.target = V(7.0, 0.1, 0); cam.fov = 55; cam.near = 0.1;
      cam.shake = 0.0016 + 0.012 * Math.exp(-Math.max(0, ti) / 2.5) * sstep(-0.1, 0.1, ti);
      cam.bloom = lerp(0.45, 0.9, sstep(-4, 0.5, ti)) * (1 - 0.0 * ti);
      cam.exposure = 1.0;
      const f = ti;                                   // white-out flash at contact
      cam.flash = (f > -0.07 && f < 0) ? 0.9 * sstep(-0.07, 0, f) : (f >= 0 ? 0.9 * Math.exp(-f / 0.2) : 0);
      cam.name = 'impact';
      return cam;
    }
    // rise into a high 3/4 view of the expanding plume
    const u = ease(345, 360, t);
    const site = surfacePoint(SITE.lat, SITE.lon, t, 1);
    const hi = site.clone().multiplyScalar(RE + 30).addScaledVector(V(0, 0, 1), 18).addScaledVector(V(0, 1, 0), 10);
    cam.pos = mix(wide.clone().set(7.2 - 0.04 * 20.6, 2.8, 34 - 0.35 * 20.6), hi, u);
    cam.target = mix(V(7.0, 0.1, 0), V(RE * 0.5, 0, 0).add(site.clone().multiplyScalar(0.0)), u);
    cam.fov = lerp(55, 42, u); cam.near = 0.2; cam.bloom = 0.8; cam.shake = 0.0015;
    cam.name = 'plume';
    return cam;
  }

  // ------------------------------------------------ Shot 7 — aftermath (06:00–07:00)
  if (t < 420) {
    const u = (t - 360) / 60;
    const inv = earthMatrix(t).invert();
    const siteLocal = surfacePoint(SITE.lat, SITE.lon, t, 1).applyMatrix4(inv).normalize();
    // anchor ~55° from the crater, then fly towards it, then climb into orbit
    const anchor = V(Math.cos(0.15) * Math.cos(THREE.MathUtils.degToRad(30)), Math.sin(0.15), -Math.cos(0.15) * Math.sin(THREE.MathUtils.degToRad(30))).normalize();
    const fly = ease(0, 0.4, u);
    const dirL = anchor.clone().lerp(siteLocal, fly * 0.55).normalize();
    const climb = easeInOut(sstep(0.3, 1.0, u));
    const alt = lerp(0.05, 26, Math.pow(climb, 1.5)) + 0.0 * u;
    cam.pos = dirL.clone().applyMatrix4(earthMatrix(t)).multiplyScalar(RE + alt);
    cam.up = mix(cam.pos.clone().normalize(), UP, climb).normalize();
    const radial = cam.pos.clone().normalize();
    const fwd = siteLocal.clone().applyMatrix4(earthMatrix(t)).addScaledVector(radial, -siteLocal.clone().applyMatrix4(earthMatrix(t)).dot(radial)).normalize();
    const lookLow = cam.pos.clone().addScaledVector(fwd, 10).addScaledVector(radial, -0.6 + 0.0);
    cam.target = mix(lookLow, V(), climb);
    cam.fov = lerp(52, 34, climb); cam.near = lerp(0.004, 0.6, climb); cam.bloom = 0.65; cam.exposure = 1.1; cam.shake = 0.0014;
    cam.fade = sstep(0, 1, 1 - (t - 360) / 1.5) * 0.0;
    cam.name = 'aftermath';
    return cam;
  }

  // ------------------------------------------------ Shot 8 — final pullback (07:00–08:00)
  {
    const u = (t - 420) / 60;
    const e = easeInOut(clamp(u));
    const dist = lerp(32, 230, Math.pow(e, 0.9));
    const az = 0.9 + 0.45 * u, el = THREE.MathUtils.degToRad(lerp(12, 26, u));
    cam.pos = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(dist);
    cam.target = V(0, 0, 0).addScaledVector(V(0, 1, 0), 0);
    cam.fov = lerp(34, 26, e); cam.near = 0.5; cam.bloom = 0.6; cam.exposure = 1.1; cam.shake = 0.0004;
    cam.fade = sstep(468, 477, t);
    cam.name = 'pullback';
    return cam;
  }
}

export function applyCamera(camera, c, t) {
  camera.position.copy(c.pos);
  camera.up.copy(c.up);
  camera.fov = c.fov; camera.near = c.near; camera.far = 7000;
  camera.lookAt(c.target);
  if (c.roll) camera.rotateZ(c.roll);
  const sh = c.shake;
  if (sh > 0) {
    camera.rotateX(sh * (Math.sin(t * 1.7) * 0.6 + Math.sin(t * 4.3 + 1.0) * 0.3 + Math.sin(t * 9.1 + 2.0) * 0.15));
    camera.rotateY(sh * (Math.sin(t * 1.3 + 0.5) * 0.6 + Math.sin(t * 3.9 + 3.0) * 0.3 + Math.sin(t * 8.3) * 0.15));
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
