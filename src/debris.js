// Debris system: InstancedMesh rocks, GPU dust, Saturn-like ring disc, Kepler-propagated ejecta, volumetric plume.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_VERT } from './glsl.js';
import { RE, RM, GM, SUN_DIR, SITE, T, rng, sstep, clamp, lerp, easeOut, surfacePoint, surfaceNormal } from './sim.js';

const INCL = THREE.MathUtils.degToRad(5.1);
const OMEGA0 = Math.sqrt(GM / 1000);                   // angular speed at r = 10 units
const omegaAt = (r) => OMEGA0 * Math.pow(10 / r, 1.5);
const SHADOW_GLSL = /* glsl */`
float earthShadow(vec3 p, vec3 L, float R){
  float pl = dot(p, L);
  if(pl >= 0.0) return 1.0;
  return smoothstep(R * 0.985, R * 1.04, length(p - L * pl));
}`;
const SUN_COL = new THREE.Vector3(3.3, 3.15, 2.95);

// ---------------------------------------------------------------- rocks
function makeRockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const r = rng(seed), p = g.attributes.position;
  const sx = 0.75 + r() * 0.5, sy = 0.6 + r() * 0.5, sz = 0.7 + r() * 0.5;
  const off = [r() * 10, r() * 10, r() * 10];
  const f = (x, y, z) => Math.sin(x * 4.1 + off[0]) * Math.cos(y * 3.7 + off[1]) * 0.28 + Math.sin(z * 7.9 + off[2] + x * 3) * 0.14 + Math.sin((x + y + z) * 13) * 0.06;
  const vmap = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!vmap.has(k)) vmap.set(k, 1 + f(x, y, z));
    const s = vmap.get(k);
    p.setXYZ(i, x * s * sx, y * s * sy, z * s * sz);
  }
  g.computeVertexNormals();
  const nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {                      // soften: blend face normal with the radial normal
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const f = new THREE.Vector3(nn.getX(i), nn.getY(i), nn.getZ(i));
    f.multiplyScalar(0.35).addScaledVector(v, 0.65).normalize(); nn.setXYZ(i, f.x, f.y, f.z);
  }
  return g;
}
const rockVS = /* glsl */`
attribute vec4 aSeed; attribute float aHeat;
varying vec3 vN, vW, vObj; varying vec4 vSeed; varying float vHeat;
void main(){
  vObj = position; vSeed = aSeed; vHeat = aHeat;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const rockFS = /* glsl */`
precision highp float;
uniform highp sampler3D uNoise; uniform vec3 uSunDir, uSunCol;
varying vec3 vN, vW, vObj; varying vec4 vSeed; varying float vHeat;
${GLSL_COMMON}
${SHADOW_GLSL}
void main(){
  vec3 N = normalize(vN);
  vec3 q = vObj * 2.3 + vSeed.xyz * 9.0;
  float n = texture(uNoise, q).r * 0.6 + texture(uNoise, q * 3.7).g * 0.4;
  vec3 alb = mix(vec3(0.035, 0.031, 0.028), vec3(0.115, 0.1, 0.088), n) * (0.7 + 0.6 * vSeed.w);
  float sh = earthShadow(vW, normalize(uSunDir), ${RE.toFixed(3)});
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  vec3 toE = -normalize(vW);
  float es = max(dot(N, toE), 0.0) * 0.05 * pow(${RE.toFixed(3)} / max(length(vW), ${RE.toFixed(3)}), 2.0);
  vec3 col = alb * (ndl * sh * uSunCol * 1.1 + es * vec3(0.5, 0.7, 1.0) * 3.0 + 0.01);
  vec3 emis = fireRamp(vHeat * (0.5 + n)) * step(0.001, vHeat) * 2.4;
  gl_FragColor = vec4(col + emis, 1.0);
}`;

export class Rocks {
  constructor(noise, count = 2400) {
    this.n = count;
    const per = Math.floor(count / 3);
    this.meshes = [];
    this.data = [];
    const r = rng(2026);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uNoise: { value: noise }, uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: SUN_COL.clone() } }, vertexShader: rockVS, fragmentShader: rockFS });
    for (let v = 0; v < 3; v++) {
      const geo = makeRockGeometry(500 + v * 31);
      const seeds = new Float32Array(per * 4), heats = new Float32Array(per);
      for (let i = 0; i < per * 4; i++) seeds[i] = r();
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      const heat = new THREE.InstancedBufferAttribute(heats, 1); heat.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aHeat', heat);
      const mesh = new THREE.InstancedMesh(geo, this.mat, per);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.meshes.push({ mesh, heat });
    }
    for (let i = 0; i < per * 3; i++) {
      const u = r(), kindR = r();
      const rr = 9.4 + Math.pow(r(), 1.25) * 10.5;
      this.data.push({
        size: RM * (0.010 + 0.11 * Math.pow(u, 3.2) + (r() < 0.03 ? 0.07 : 0)),
        loc: (() => { const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(Math.cbrt(r()) * 1.1); return v; })(),
        kind: kindR < 0.58 ? 0 : (kindR < 0.88 ? 1 : 2),
        tForm: 205 + r() * 55,
        ringR: rr, phi0: r() * Math.PI * 2, yOff: (r() - 0.5) * 0.9 * Math.sqrt(rr / 10), omega: omegaAt(rr),
        scatter: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).multiplyScalar(5.5),
        out: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize(), outV: 0.05 + r() * 0.12,
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin: (r() - 0.5) * 1.6,
        a0: r() * 6.28,
      });
    }
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  addTo(scene) { this.meshes.forEach((m) => scene.add(m.mesh)); }
  update(s) {
    const t = s.t, p = this._p, per = this.meshes[0].mesh.count;
    const show = t > T.SPLIT_START + 6;
    const basis = new THREE.Matrix4().copy(s.moonBasis);
    const ringTilt = new THREE.Matrix4().makeRotationX(INCL);
    for (let i = 0; i < this.data.length; i++) {
      const d = this.data[i];
      const m = this.meshes[Math.floor(i / per)], idx = i % per;
      let scale = 0, heat = 0;
      if (show) {
        const dt = Math.max(0, t - T.SPLIT_START);
        // cluster-following position (local frame, stretched, drifting) — mirrors the chunk shader
        const loc = this._v.copy(d.loc);
        const sx = 1 + 0.42 * s.stretch;
        loc.x = loc.x * sx + loc.x * 1.9 * Math.pow(dt / 40, 1.35) * 0.9;
        loc.y *= 1 / Math.sqrt(sx); loc.z *= 1 / Math.sqrt(sx);
        loc.multiplyScalar(RM).applyMatrix4(basis.setPosition(0, 0, 0));
        const cp = loc.add(s.pos);
        if (d.kind === 0) {
          const a = d.phi0 + d.omega * (t - d.tForm);
          p.set(d.ringR * Math.cos(a), d.yOff, d.ringR * Math.sin(a)).applyMatrix4(ringTilt);
          const w = sstep(d.tForm, d.tForm + 32, t);
          p.lerp(cp, 1 - w);
          scale = d.size;
        } else if (d.kind === 1) {
          const w = sstep(d.tForm, T.IMPACT, t);
          p.copy(cp).addScaledVector(d.scatter, w * 0.9).multiplyScalar(1);
          scale = t < T.IMPACT ? d.size : 0;
          // heat as it enters the atmosphere
          const alt = p.length() - RE;
          heat = clamp(1 - alt / 0.9) * 1.1;
          if (alt < 0) scale = 0;
        } else {
          const w = Math.max(0, t - d.tForm);
          p.copy(cp).addScaledVector(d.out, d.outV * Math.pow(w, 1.35));
          scale = d.size * 0.9;
        }
        if (t > T.IMPACT) heat = Math.max(heat, 0.8 * Math.exp(-(t - T.IMPACT) / 28) * (d.kind === 0 ? 0.6 : 0.3));
        scale *= sstep(T.SPLIT_START + 6, T.SPLIT_START + 16, t);
        if (p.length() < RE * 1.0) scale = 0;
      }
      this._q.setFromAxisAngle(d.axis, d.a0 + d.spin * t);
      this._s.setScalar(Math.max(scale, 1e-6));
      this._m.compose(p, this._q, this._s);
      m.mesh.setMatrixAt(idx, this._m);
      m.heat.array[idx] = heat;
    }
    for (const m of this.meshes) { m.mesh.instanceMatrix.needsUpdate = true; m.heat.needsUpdate = true; }
  }
}

// ---------------------------------------------------------------- dust (points)
const dustVS = /* glsl */`
attribute vec4 aA; attribute vec4 aB; attribute vec3 aLoc;
uniform float uTime, uScale, uSplit, uStretch, uPix;
uniform vec3 uMoonPos, uSunDir;
uniform mat3 uMoonBasis, uRingBasis;
uniform float uGlow, uAlive;
varying float vA; varying vec3 vC;
${SHADOW_GLSL}
void main(){
  float r = aA.x, phi0 = aA.y, yOff = aA.z, om = aA.w;
  float size = aB.x, rnd = aB.y, tForm = aB.z, kind = aB.w;
  float a = phi0 + om * (uTime - tForm);
  vec3 ringP = uRingBasis * vec3(r * cos(a), yOff, r * sin(a));
  float dt = max(0.0, uTime - ${T.SPLIT_START.toFixed(1)});
  vec3 loc = aLoc;
  float sx = 1.0 + 0.42 * uStretch;
  loc.x = loc.x * sx + loc.x * 1.9 * pow(dt / 40.0, 1.35) * 0.9;
  loc.yz *= 1.0 / sqrt(sx);
  vec3 cp = uMoonPos + uMoonBasis * (loc * ${RM.toFixed(4)});
  float w = smoothstep(tForm, tForm + 35.0, uTime);
  vec3 p = mix(cp, ringP, w);
  float vis = smoothstep(${(T.SPLIT_START + 4).toFixed(1)}, ${(T.SPLIT_START + 18).toFixed(1)}, uTime);
  if(kind > 0.5){                    // plunging dust: scatters, then is gone at impact
    p = cp + (vec3(rnd, fract(rnd * 7.3) - 0.5, fract(rnd * 3.1) - 0.5) * 6.0) * smoothstep(tForm, ${T.IMPACT.toFixed(1)}, uTime);
    vis *= 1.0 - step(${T.IMPACT.toFixed(1)}, uTime);
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float sh = earthShadow(p, normalize(uSunDir), ${RE.toFixed(3)});
  vA = vis * (0.35 + 0.65 * sh) ;
  float lum = (0.08 + 0.2 * rnd) * (0.25 + 0.75 * sh);
  vC = vec3(0.85, 0.74, 0.62) * lum * (1.0 + uGlow * vec3(3.0, 1.2, 0.3));
  gl_PointSize = clamp(size * uScale / max(-mv.z, 0.01), 1.0 * uPix, 11.0 * uPix);
  if(length(p) < ${RE.toFixed(3)}) gl_PointSize = 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const dustFS = /* glsl */`
precision highp float;
varying float vA; varying vec3 vC;
void main(){
  vec2 q = gl_PointCoord - 0.5; float d = length(q);
  float a = smoothstep(0.5, 0.0, d);
  if(a * vA < 0.003) discard;
  gl_FragColor = vec4(vC * a * vA, a * vA);
}`;
export class Dust {
  constructor(count = 110000) {
    const r = rng(4242);
    const A = new Float32Array(count * 4), B = new Float32Array(count * 4), L = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const rr = 9.2 + Math.pow(r(), 1.2) * 11.5;
      const kind = r() < 0.72 ? 0 : 1;
      A.set([rr, r() * Math.PI * 2, (r() - 0.5) * 0.8 * Math.sqrt(rr / 10) * (0.2 + r()), omegaAt(rr)], i * 4);
      B.set([0.6 + r() * 1.8, r(), 205 + r() * 55, kind], i * 4);
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(Math.cbrt(r()) * 1.15);
      L.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aA', new THREE.BufferAttribute(A, 4)); g.setAttribute('aB', new THREE.BufferAttribute(B, 4)); g.setAttribute('aLoc', new THREE.BufferAttribute(L, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uni = {
      uTime: { value: 0 }, uScale: { value: 1000 }, uPix: { value: 1 }, uSplit: { value: 0 }, uStretch: { value: 0 }, uGlow: { value: 0 }, uAlive: { value: 1 },
      uMoonPos: { value: new THREE.Vector3() }, uSunDir: { value: SUN_DIR.clone() },
      uMoonBasis: { value: new THREE.Matrix3() }, uRingBasis: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(INCL)) },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: dustVS, fragmentShader: dustFS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.points.frustumCulled = false;
  }
  addTo(scene) { scene.add(this.points); }
  update(s, camera, h, pix) {
    const u = this.uni;
    u.uTime.value = s.t; u.uStretch.value = s.stretch; u.uMoonPos.value.copy(s.pos);
    u.uMoonBasis.value.setFromMatrix4(s.moonBasis);
    u.uScale.value = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * pix * 0.012;
    u.uPix.value = pix;
    u.uGlow.value = Math.exp(-Math.max(0, s.t - T.IMPACT) / 30) * (s.t > T.IMPACT ? 1 : 0);
  }
}

// ---------------------------------------------------------------- ring disc
const ringVS = /* glsl */`
varying vec2 vLoc; varying vec3 vW;
void main(){ vLoc = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const ringFS = /* glsl */`
precision highp float;
uniform highp sampler3D uNoise; uniform vec3 uSunDir, uSunCol, uNormalW; uniform float uTime, uRing, uGlow;
varying vec2 vLoc; varying vec3 vW;
${GLSL_COMMON}
${SHADOW_GLSL}
void main(){
  float r = length(vLoc);
  float ang = atan(vLoc.y, vLoc.x);
  float om = ${OMEGA0.toFixed(5)} * pow(10.0 / r, 1.5);
  float a2 = ang - om * uTime * 0.5;
  float edge = smoothstep(9.0, 11.5, r) * (1.0 - smoothstep(17.0, 21.5, r));
  float bands = 0.55 + 0.75 * texture(uNoise, vec3(r * 0.11, 0.31, 0.17)).r + 0.22 * texture(uNoise, vec3(r * 0.37, 0.5, 0.9)).g;
  vec3 cq = vec3(cos(a2), sin(a2), 0.37) * (0.35 + r * 0.045);
  float clump = texture(uNoise, cq).r * 0.65 + texture(uNoise, cq * 3.1 + 0.2).b * 0.35;
  float dens = edge * bands * smoothstep(0.28, 0.85, clump) * 0.62 * uRing;
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uSunDir);
  float sh = earthShadow(vW, L, ${RE.toFixed(3)});
  float fwd = pow(max(dot(-V, L), 0.0), 3.0);
  float lit = 0.25 + 0.75 * abs(dot(L, normalize(uNormalW)));
  vec3 col = mix(vec3(0.32, 0.27, 0.22), vec3(0.62, 0.55, 0.48), clump) * (lit * sh * uSunCol * 0.34 + fwd * sh * 1.2 + 0.006);
  col += vec3(1.0, 0.38, 0.1) * uGlow * dens * 0.9;
  gl_FragColor = vec4(col, clamp(dens, 0.0, 0.8));
}`;
export class RingDisc {
  constructor(noise) {
    this.uni = { uNoise: { value: noise }, uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: SUN_COL.clone() }, uNormalW: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uRing: { value: 0 }, uGlow: { value: 0 } };
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(8.6, 22, 256, 1), new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: ringVS, fragmentShader: ringFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.rotation.x = -Math.PI / 2 + INCL;
    this.mesh.frustumCulled = false;
    this.uni.uNormalW.value.set(0, 1, 0).applyEuler(this.mesh.rotation);
  }
  addTo(scene) { scene.add(this.mesh); }
  update(s) {
    const u = this.uni;
    u.uTime.value = s.t;
    const pre = sstep(T.RING_FORM_A + 20, T.RING_FORM_B + 40, s.t);
    const post = 1 + 0.8 * sstep(T.IMPACT + 2, T.IMPACT + 50, s.t);
    u.uRing.value = pre * post;
    u.uGlow.value = Math.exp(-Math.max(0, s.t - T.IMPACT) / 40) * (s.t > T.IMPACT ? 1 : 0);
    this.mesh.visible = u.uRing.value > 0.001;
  }
}

// ---------------------------------------------------------------- Kepler-propagated ejecta
const ejVS = /* glsl */`
attribute vec3 aP; attribute vec3 aQ; attribute vec4 aEl; attribute vec4 aMisc;
uniform float uTime, uScale, uPix;
uniform vec3 uSunDir;
varying float vA; varying vec3 vC;
${GLSL_VERT}
${SHADOW_GLSL}
void main(){
  float a = aEl.x, e = aEl.y, n = aEl.z, M0 = aEl.w;
  float size = aMisc.x, rnd = aMisc.y, tland = aMisc.z, t0 = aMisc.w;
  float dt = uTime - t0;
  vec3 pos = vec3(0.0);
  float vis = (dt > 0.0 && dt < tland) ? 1.0 : 0.0;
  if(vis > 0.5){
    float M = M0 + n * dt;
    if(e < 1.0){
      M = mod(M + PI, 2.0 * PI) - PI;
      float E = e > 0.8 ? sign(M) * PI : M + 0.85 * e * sin(M);
      for(int i = 0; i < 14; i++){ E -= (E - e * sin(E) - M) / (1.0 - e * cos(E)); }
      float x = a * (cos(E) - e), y = a * sqrt(max(1.0 - e*e, 0.0)) * sin(E);
      pos = aP * x + aQ * y;
    } else {
      float H = asinh(M / e);
      for(int i = 0; i < 8; i++){ H -= (e * sinh(H) - H - M) / (e * cosh(H) - 1.0); }
      float x = a * (cosh(H) - e), y = -a * sqrt(e*e - 1.0) * sinh(H);
      pos = aP * x + aQ * y;
    }
  }
  float age = max(dt, 0.0);
  float heat = exp(-age / (10.0 + 45.0 * rnd));
  float fadeLand = 1.0 - smoothstep(tland - 4.0, tland, dt);
  float sh = earthShadow(pos, normalize(uSunDir), ${RE.toFixed(3)});
  vec3 hot = fireRamp(heat * 2.6 + 0.12);
  vec3 cold = vec3(0.16, 0.13, 0.11) * (0.3 + 0.7 * sh);
  vC = (hot * heat + cold * (1.0 - heat)) * (0.6 + rnd * 0.8);
  vA = vis * fadeLand * smoothstep(0.0, 0.25, dt);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_PointSize = clamp(size * uScale / max(-mv.z, 0.01) * (0.6 + 0.8 * heat), 1.0 * uPix, 9.0 * uPix);
  gl_Position = projectionMatrix * mv;
}`;
const ejFS = /* glsl */`
precision highp float; varying float vA; varying vec3 vC;
void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(q)); if(a * vA < 0.003) discard; gl_FragColor = vec4(vC * a * vA, a * vA); }`;

export class Ejecta {
  constructor(count = 42000) {
    const r = rng(99);
    const P = new Float32Array(count * 3), Q = new Float32Array(count * 3), EL = new Float32Array(count * 4), MS = new Float32Array(count * 4);
    const site = surfaceNormal(SITE.lat, SITE.lon, T.IMPACT, new THREE.Vector3());
    const vesc = Math.sqrt((2 * GM) / RE);
    const tmp = new THREE.Vector3(), r0 = new THREE.Vector3(), v0 = new THREE.Vector3(), up = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    const h = new THREE.Vector3(), ev = new THREE.Vector3(), Pv = new THREE.Vector3(), Qv = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // launch point inside the transient crater
      const angOff = 0.3 * Math.sqrt(r()), az0 = r() * Math.PI * 2;
      t1.crossVectors(site, Math.abs(site.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      t2.crossVectors(site, t1);
      up.copy(site).addScaledVector(t1, Math.sin(angOff) * Math.cos(az0)).addScaledVector(t2, Math.sin(angOff) * Math.sin(az0)).normalize();
      r0.copy(up).multiplyScalar(RE * 1.004);
      // velocity: a wide cone about local vertical
      const th = Math.acos(1 - r() * 0.96), az = r() * Math.PI * 2;
      t1.crossVectors(up, new THREE.Vector3(0.3, 0.9, 0.31)).normalize(); t2.crossVectors(up, t1);
      const f = 0.22 + 1.45 * Math.pow(r(), 1.7);
      v0.copy(up).multiplyScalar(Math.cos(th)).addScaledVector(t1, Math.sin(th) * Math.cos(az)).addScaledVector(t2, Math.sin(th) * Math.sin(az)).multiplyScalar(vesc * f);
      const rm = r0.length(), v2 = v0.lengthSq();
      h.crossVectors(r0, v0);
      ev.crossVectors(v0, h).multiplyScalar(1 / GM).addScaledVector(r0, -1 / rm);
      const e = ev.length(), eps = v2 / 2 - GM / rm, a = -GM / (2 * eps);
      Pv.copy(e > 1e-6 ? ev.clone().multiplyScalar(1 / e) : r0.clone().multiplyScalar(1 / rm));
      Qv.crossVectors(h.clone().normalize(), Pv);
      const nu = Math.atan2(Qv.dot(r0), Pv.dot(r0));
      let M0, n, land = 1e9;
      if (e < 1) {
        const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
        M0 = E0 - e * Math.sin(E0); n = Math.sqrt(GM / (a * a * a));
        land = (2 * Math.PI - 2 * M0) / n;
        if (!(land > 0)) land = 1e9;
        // an orbit with periapsis above the ground never lands within the film
      } else {
        const Hh = 2 * Math.atanh(Math.min(0.999999, Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)));
        M0 = e * Math.sinh(Hh) - Hh; n = Math.sqrt(GM / Math.pow(-a, 3));
      }
      P.set([Pv.x, Pv.y, Pv.z], i * 3); Q.set([Qv.x, Qv.y, Qv.z], i * 3);
      EL.set([a, e, n, M0], i * 4);
      MS.set([0.8 + 2.6 * Math.pow(r(), 2.2), r(), land, T.IMPACT - 0.4 + r() * 1.6], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aP', new THREE.BufferAttribute(P, 3)); g.setAttribute('aQ', new THREE.BufferAttribute(Q, 3));
    g.setAttribute('aEl', new THREE.BufferAttribute(EL, 4)); g.setAttribute('aMisc', new THREE.BufferAttribute(MS, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uni = { uTime: { value: 0 }, uScale: { value: 1000 }, uPix: { value: 1 }, uSunDir: { value: SUN_DIR.clone() } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: ejVS, fragmentShader: ejFS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.points.frustumCulled = false;
  }
  addTo(scene) { scene.add(this.points); }
  update(s, camera, h, pix) {
    this.points.visible = s.t >= T.IMPACT - 1;
    this.uni.uTime.value = s.t;
    this.uni.uScale.value = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * pix * 0.007;
    this.uni.uPix.value = pix;
  }
}

// ---------------------------------------------------------------- volumetric plume (shader-based, one draw call)
const plumeVS = /* glsl */`varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const plumeFS = /* glsl */`
precision highp float;
uniform highp sampler3D uNoise;
uniform vec3 uCenter, uUp, uSunDir, uSunCol;
uniform float uR, uAge, uPR, uInt, uTime;
varying vec3 vWorld;
${GLSL_COMMON}
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd), c = dot(ro, ro) - r*r, h = b*b - c; if(h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h); }
void main(){
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  float Rb = uR * 1.32;
  vec2 tb = raySphere(ro - uCenter, rd, Rb);
  if(tb.y < 0.0) discard;
  float t0 = max(tb.x, 0.0), t1 = tb.y;
  vec2 tp = raySphere(ro, rd, uPR * 0.999);
  if(tp.x > 0.0) t1 = min(t1, tp.x);
  if(t1 <= t0) discard;
  const int N = 40;
  float ds = (t1 - t0) / float(N);
  float jit = hash12(gl_FragCoord.xy + fract(uTime) * 91.0);
  vec3 C = vec3(0.0); float Tr = 1.0;
  vec3 L = normalize(uSunDir);
  for(int i = 0; i < N; i++){
    vec3 p = ro + rd * (t0 + (float(i) + jit) * ds);
    vec3 q = p - uCenter;
    float r = length(q);
    float rn = r / uR;
    if(rn > 1.32) continue;
    vec3 dir = q / max(r, 1e-3);
    float up = dot(dir, uUp);
    float hem = 1.0;
    vec3 nq = q / uR * 1.5;
    float n1 = texture(uNoise, nq * 0.8 + vec3(0.0, uAge * 0.006, 0.0) + dir * 0.0).r;
    float n2 = texture(uNoise, nq * 2.3 + 0.37).g;
    float n3 = texture(uNoise, nq * 5.9 + 0.11).b;
    float turb = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
    float rays = texture(uNoise, dir * 4.0 + 0.5).g;
    float rs = 0.84 + 0.04 * sin(uAge * 0.2);
    float th = 0.14 + 0.16 * turb;
    float shell = exp(-pow((rn - rs) / th, 2.0));
    float core = exp(-pow(rn / (0.50 + 0.1 * turb), 2.0));
    float stem = exp(-pow(length(q - uUp * dot(q, uUp)) / (0.16 * uR), 2.0)) * smoothstep(-0.05, 0.2, up) * (1.0 - smoothstep(0.8, 1.15, rn));
    float tb = smoothstep(0.26, 0.70, turb);
    float dens = hem * (shell * (0.12 + 1.7 * tb) * (0.35 + 1.0 * rays) + core * (0.22 + 0.95 * tb) * 0.9 + stem * 0.8 * tb) * uInt;
    float temp = shell * (1.0 * exp(-uAge / 14.0) + 0.14) + core * (1.5 * exp(-uAge / 9.0) + 0.22) + stem * (1.6 * exp(-uAge / 18.0) + 0.15);
    temp *= (0.55 + 0.9 * turb);
    float sigma = dens * 5.2 / uR;
    float a = 1.0 - exp(-sigma * ds);
    vec3 emis = fireRamp(temp) * 1.5;
    vec3 smoke = vec3(0.055, 0.042, 0.036) * (0.4 + 1.4 * max(dot(normalize(q + vec3(1e-4)), L), 0.0)) * uSunCol * 0.55;
    vec3 Ci = mix(smoke, emis, clamp(temp * 1.1, 0.0, 1.0));
    C += Tr * a * Ci;
    Tr *= 1.0 - a;
    if(Tr < 0.01) break;
  }
  gl_FragColor = vec4(C, 1.0 - Tr);
}`;
export class Plume {
  constructor(noise) {
    this.uni = {
      uNoise: { value: noise }, uCenter: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: SUN_COL.clone() }, uR: { value: 1 }, uAge: { value: 0 }, uPR: { value: RE }, uInt: { value: 1 }, uTime: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: plumeVS, fragmentShader: plumeFS, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 20;
  }
  addTo(scene) { scene.add(this.mesh); }
  update(s) {
    const age = s.t - T.IMPACT;
    this.mesh.visible = age > -0.05 && age < 160;
    if (!this.mesh.visible) return;
    const a = Math.max(age, 0);
    const R = 0.35 + 17 * Math.pow(1 - Math.exp(-a / 7), 0.8) + 0.12 * a;
    const c = surfacePoint(SITE.lat, SITE.lon, s.t, RE * 0.995, this.uni.uCenter.value);
    this.uni.uUp.value.copy(c).normalize();
    this.uni.uR.value = R; this.uni.uAge.value = a; this.uni.uTime.value = s.t;
    this.uni.uInt.value = (1 - 0.94 * sstep(8, 40, a)) * sstep(-0.05, 0.25, age);
    this.mesh.position.copy(c); this.mesh.scale.setScalar(R * 1.32);
  }
}
