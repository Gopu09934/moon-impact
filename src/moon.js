// Moon: tidally-locked, textured, cracks → Voronoi-shattered rubble with glowing interior.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_VERT } from './glsl.js';
import { RM, RE, SUN_DIR, T, rng, sstep, clamp } from './sim.js';

const N_CELLS = 56;
const INNER = 0.55;

/** Build the shattering Moon: outer crust + inner shell + side walls per Voronoi cell (closed chunks). */
export function buildMoonGeometry(detail = 34) {
  const ico = new THREE.IcosahedronGeometry(1, detail);              // non-indexed, radius 1
  const pos = ico.attributes.position;
  const triCount = pos.count / 3;

  // weld vertices for edge adjacency
  const key = (i) => `${Math.round(pos.getX(i) * 4e4)},${Math.round(pos.getY(i) * 4e4)},${Math.round(pos.getZ(i) * 4e4)}`;
  const idMap = new Map(); const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const k = key(i); let id = idMap.get(k); if (id === undefined) { id = idMap.size; idMap.set(k, id); } vid[i] = id; }

  // Voronoi seeds (well-spread, jittered Fibonacci sphere)
  const r = rng(77); const seeds = [];
  for (let i = 0; i < N_CELLS; i++) {
    const y = 1 - (2 * (i + 0.5)) / N_CELLS, rad = Math.sqrt(1 - y * y), phi = i * 2.399963;
    const v = new THREE.Vector3(Math.cos(phi) * rad, y, Math.sin(phi) * rad);
    v.add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.28)).normalize();
    seeds.push(v);
  }
  const cell = new Int32Array(triCount);
  const c = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(pos.getX(t * 3 + k), pos.getY(t * 3 + k), pos.getZ(t * 3 + k)));
    c.normalize();
    // slightly warped distance so chunk borders are jagged
    let best = 1e9, bi = 0;
    for (let i = 0; i < N_CELLS; i++) {
      const d = c.distanceToSquared(seeds[i]) + 0.012 * Math.sin(c.x * 23.0 + c.y * 17.0 + i) * Math.cos(c.z * 19.0 - i * 0.7);
      if (d < best) { best = d; bi = i; }
    }
    cell[t] = bi;
  }
  // edge → triangles
  const edges = new Map();
  for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) {
    const a = vid[t * 3 + k], b = vid[t * 3 + ((k + 1) % 3)];
    const ek = a < b ? a * 1e7 + b : b * 1e7 + a;
    let e = edges.get(ek); if (!e) { e = []; edges.set(ek, e); }
    e.push({ t, k });
  }

  const P = [], Nn = [], CEN = [], SEED = [], KIND = [];
  const pushV = (x, y, z, nx, ny, nz, cellIdx, kind) => {
    P.push(x, y, z); Nn.push(nx, ny, nz);
    const s = seeds[cellIdx];
    CEN.push(s.x * 0.78, s.y * 0.78, s.z * 0.78);
    SEED.push(cellIdx / N_CELLS, hash(cellIdx, 1), hash(cellIdx, 2), hash(cellIdx, 3));
    KIND.push(kind);
  };
  function hash(i, j) { let x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); }

  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ci = cell[t];
    A.fromBufferAttribute(pos, t * 3); B.fromBufferAttribute(pos, t * 3 + 1); Cc.fromBufferAttribute(pos, t * 3 + 2);
    for (const v of [A, B, Cc]) pushV(v.x, v.y, v.z, v.x, v.y, v.z, ci, 0);                  // outer crust
    for (const v of [A, B, Cc]) pushV(v.x * INNER, v.y * INNER, v.z * INNER, -v.x, -v.y, -v.z, ci, 1);   // inner shell
  }
  // walls on cell borders
  const mid = new THREE.Vector3(), e = new THREE.Vector3(), rad = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
  for (const [, list] of edges) {
    for (const { t, k } of list) {
      const ci = cell[t];
      const other = list.find((o) => o.t !== t);
      if (other && cell[other.t] === ci) continue;        // interior edge of the same chunk
      const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + k);
      const b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + ((k + 1) % 3));
      const o = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + ((k + 2) % 3));
      mid.copy(a).add(b).multiplyScalar(0.5);
      e.copy(b).sub(a); rad.copy(mid).normalize();
      nrm.crossVectors(e, rad).normalize();
      cen.copy(o).sub(mid);
      if (nrm.dot(cen) > 0) nrm.negate();                 // point away from this chunk's interior
      const a2 = a.clone().multiplyScalar(INNER), b2 = b.clone().multiplyScalar(INNER);
      for (const v of [a, b, b2, a, b2, a2]) pushV(v.x, v.y, v.z, nrm.x, nrm.y, nrm.z, ci, 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(CEN, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(SEED, 4));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(KIND, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9);
  return g;
}

const moonVS = /* glsl */`
attribute vec3 aCenter; attribute vec4 aSeed; attribute float aKind;
uniform float uStretch, uSplit, uDrift, uTumble;
varying vec3 vRest, vWorld, vNW, vE, vNn; varying float vKind; varying float vSeed;
${GLSL_VERT}
mat3 axisAngle(vec3 a, float ang){
  float c = cos(ang), s = sin(ang), t = 1.0 - c;
  return mat3(t*a.x*a.x + c,     t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
              t*a.x*a.y - s*a.z, t*a.y*a.y + c,     t*a.y*a.z + s*a.x,
              t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
}
void main(){
  vec3 p = position; vec3 n = normal;
  vRest = position; vKind = aKind; vSeed = aSeed.x;
  float sx = 1.0 + 0.42 * uStretch;                    // tidal elongation toward Earth (+x)
  vec3 S = vec3(sx, 1.0 / sqrt(sx), 1.0 / sqrt(sx));
  vec3 dir = normalize(aCenter);
  vec3 rnd = aSeed.yzw - 0.5;
  float k = 0.35 + 1.0 * fract(aSeed.x * 7.13 + aSeed.y);
  vec3 off = dir * (uSplit * k * 0.85) + rnd * (uSplit * 0.9);
  off.x += aCenter.x * uDrift * 1.9 * (0.5 + aSeed.z);                       // near side runs ahead, far side lags: a stream
  off.yz += rnd.yz * uDrift * 0.55;
  vec3 ax = normalize(rnd + vec3(0.0001, 0.0002, 0.0003));
  mat3 R = axisAngle(ax, uTumble * (aSeed.w - 0.35) * 2.6 * min(uSplit * 2.0, 1.0));
  vec3 q = (R * (p - aCenter)) + aCenter + off;
  q *= S;
  n = R * n;
  vec3 dd = normalize(position);
  vec3 Er = normalize(vec3(dd.z, 0.0, -dd.x) + vec3(1e-5, 0.0, 0.0));
  vE = normalize(mat3(modelMatrix) * (R * Er));
  vNn = normalize(mat3(modelMatrix) * (R * cross(dd, Er)));
  vec4 w = modelMatrix * vec4(q, 1.0);
  vWorld = w.xyz;
  vNW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const moonFS = /* glsl */`
precision highp float;
uniform sampler2D uAlbedo, uNormal;
uniform highp sampler3D uNoise;
uniform vec3 uSunDir, uSunCol, uEarthDirW;
uniform float uCrack, uEarthShine, uHeat, uTime, uSplit, uCoreGlow;
varying vec3 vRest, vWorld, vNW, vE, vNn; varying float vKind; varying float vSeed;
${GLSL_COMMON}
void main(){
  vec3 L = normalize(uSunDir);
  vec3 N = normalize(vNW);
  vec3 rest = vRest;
  vec3 col = vec3(0.0), emis = vec3(0.0);
  float rr = length(rest);
  vec3 d = rest / max(rr, 1e-4);
  if(vKind < 0.5){
    vec3 alb = texSph(uAlbedo, d).rgb;
    // tangent-space normal map; basis from the rest direction, rotated into world through the (rotated) normal
    vec3 nm = texSph(uNormal, d).xyz * 2.0 - 1.0;
    vec3 E = normalize(vec3(d.z, 0.0, -d.x) + vec3(1e-5, 0.0, 0.0));
    vec3 Nn = cross(d, E);
    // express in world: use screen-space derivatives to build a stable world frame
    vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
    vec2 uv = sphUV(d);
    vec3 Nw = N;
    // world-space tangent from rest-frame vectors: columns of modelMatrix applied, then re-orthogonalised against N
    vec3 Ew = vE, Nnw = vNn;
    Ew = normalize(Ew - N * dot(Ew, N)); Nnw = normalize(Nnw - N * dot(Nnw, N));
    Nw = normalize(N + (Ew * nm.x + Nnw * nm.y) * 1.25);
    float ndl = dot(Nw, L), ndlG = dot(N, L);
    float V1 = max(dot(N, normalize(cameraPosition - vWorld)), 0.0);
    float lam = max(ndl, 0.0) * smoothstep(-0.02, 0.06, ndlG);
    float ls = lam / (max(ndlG, 0.0) + V1 + 0.25) * 1.5;                // Lommel–Seeliger flavour
    float dif = mix(lam, ls, 0.35);
    col = alb * dif * uSunCol * 1.15;
    col += alb * uEarthShine * max(dot(Nw, uEarthDirW), 0.0) * vec3(0.55, 0.75, 1.0) * 3.0;
    col += alb * 0.0035;
    // tidal-heating cracks
    if(uCrack > 0.001){
      float a = texture(uNoise, d * 1.7).r, b = texture(uNoise, d * 4.1 + 0.37).r, c = texture(uNoise, d * 9.0 + 0.11).r;
      float nn = 0.55 * a + 0.3 * b + 0.15 * c;
      float w = 0.006 + 0.022 * uCrack;
      float ad = abs(nn - 0.5);
      float line = 1.0 - smoothstep(0.0, w, ad);
      float glow = exp(-pow(ad / (w * 3.0), 2.0));
      col *= 1.0 - 0.8 * line * uCrack;
      emis += vec3(1.0, 0.27, 0.04) * (line * 4.0 + glow * 0.3) * uCrack * (0.7 + 0.6 * texture(uNoise, d * 12.0 + vec3(uTime * 0.05)).a);
    }
    // atmospheric compression heating on the Earth-facing hemisphere just before impact
    float face = smoothstep(0.1, 0.95, dot(N, uEarthDirW));
    emis += uHeat * face * vec3(3.2, 1.35, 0.4) * (0.55 + 0.9 * texture(uNoise, d * 6.0 + vec3(uTime * 0.6)).a);
  } else {
    // fracture interiors / inner shell: dark rock with magma towards the core
    float depth = smoothstep(1.0, 0.55, rr);
    float nz = texture(uNoise, rest * 3.5).r, nz2 = texture(uNoise, rest * 11.0).b;
    vec3 rock = vec3(0.075, 0.066, 0.058) * (0.55 + nz);
    float ndl = max(dot(N, L), 0.0);
    col = rock * (ndl * uSunCol + 0.05);
    float hot = smoothstep(0.7, 0.98, nz2 * 0.8 + depth * 0.3) * uCrack * (0.4 + 0.6 * depth);
    emis += vec3(1.0, 0.26, 0.04) * hot * 1.5 * (0.8 + 0.5 * nz);
  }
  gl_FragColor = vec4(col + emis, 1.0);
}`;

const coreFS = /* glsl */`
precision highp float;
uniform highp sampler3D uNoise; uniform float uTime, uCoreGlow;
varying vec3 vRest, vWorld, vNW; varying float vKind; varying float vSeed;
${GLSL_COMMON}
void main(){
  vec3 d = normalize(vRest);
  float n = texture(uNoise, d * 2.2 + vec3(uTime * 0.03, 0.0, 0.0)).a * 0.6 + texture(uNoise, d * 6.0 - vec3(0.0, uTime * 0.04, 0.0)).r * 0.4;
  gl_FragColor = vec4(fireRamp(0.7 + 1.6 * n) * uCoreGlow, 1.0);
}`;

export class Moon {
  constructor(tex, noise) {
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    this.uni = {
      uAlbedo: { value: tex.moonAlbedo }, uNormal: { value: tex.moonNormal }, uNoise: { value: noise },
      uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: new THREE.Vector3(3.3, 3.15, 2.95) },
      uEarthDirW: { value: new THREE.Vector3() }, uCrack: { value: 0 }, uEarthShine: { value: 0 }, uHeat: { value: 0 },
      uTime: { value: 0 }, uSplit: { value: 0 }, uStretch: { value: 0 }, uDrift: { value: 0 }, uTumble: { value: 0 }, uCoreGlow: { value: 1 },
    };
    this.chunks = new THREE.Mesh(buildMoonGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: moonVS, fragmentShader: moonFS, side: THREE.DoubleSide,
    }));
    this.chunks.frustumCulled = false;
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: /* glsl */`varying vec3 vRest, vWorld, vNW; varying float vKind, vSeed; void main(){ vRest = position; vKind=0.; vSeed=0.; vNW=normal; vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: coreFS,
    }));
    this.group.add(this.chunks, this.core);
    this.group.scale.setScalar(RM);
    this._basis = new THREE.Matrix4();
  }
  update(s) {
    const g = this.group, t = s.t, u = this.uni;
    g.visible = s.alive;
    if (!s.alive) return;
    g.matrix.copy(s.moonBasis).setPosition(s.pos).scale(new THREE.Vector3(RM, RM, RM));
    g.matrixWorldNeedsUpdate = true;
    u.uTime.value = t;
    u.uCrack.value = s.crack;
    u.uStretch.value = s.stretch;
    u.uSplit.value = s.split;
    const since = Math.max(0, t - T.SPLIT_START);
    u.uDrift.value = Math.pow(since / 40, 1.35) * 1.0;
    u.uTumble.value = since / 20;
    u.uEarthDirW.value.copy(s.dir).negate();
    const f = 0.5 * (1 + s.dir.dot(SUN_DIR));
    u.uEarthShine.value = 0.13 * f * Math.pow(clamp(RE * 1.2 / s.d), 2) ;
    u.uHeat.value = sstep(T.IMPACT - 9, T.IMPACT - 0.4, t) * 1.0;
    u.uCoreGlow.value = 1.0 + 0.8 * s.crack;
    this.core.visible = s.crack > 0.02;
    this.core.scale.setScalar(1 - 0.35 * sstep(T.SPLIT_START + 30, T.SPLIT_START + 110, t));
  }
  addTo(scene) { scene.add(this.group); }
}
