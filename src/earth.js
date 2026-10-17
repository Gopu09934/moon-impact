// Earth: surface (day / night / ocean / flood / lava), cloud layer, Rayleigh+Mie atmosphere.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_VERT } from './glsl.js';
import { RE, RM, SUN_DIR, SITE, T, sstep, easeOut, clamp, surfacePoint, earthMatrix } from './sim.js';

const SUN_COL = new THREE.Vector3(3.3, 3.15, 2.95);

const surfaceVS = /* glsl */`
uniform sampler2D uSpec;
uniform vec3 uMoonObj, uSiteObj;
uniform float uTideAmp, uCrater, uShock, uFront;
varying vec3 vRest, vWorld, vNGeoW;
${GLSL_VERT}
float craterProfile(float a){
  float R = 0.30;
  float bowl = a < R ? -0.075 * pow(1.0 - (a/R)*(a/R), 1.4) : 0.0;
  float rim = 0.016 * exp(-pow((a - R*1.06)/0.055, 2.0));
  float blanket = 0.004 * exp(-a * 3.5);
  return (bowl + rim + blanket);
}
float disp(vec3 n){
  float oc = textureLod(uSpec, sphUV(n), 4.5).r;     // blurred mask: smooth coastline transition, no cliffs
  float c = dot(n, uMoonObj);
  float bulge = (3.0*c*c - 1.0) * 0.5;
  float d = uTideAmp * bulge * mix(0.18, 1.0, oc);
  float ang = acos(clamp(dot(n, uSiteObj), -1.0, 1.0));
  d += uCrater * craterProfile(ang);
  // shock-wave ripples racing across the globe
  float front = max(uFront, 0.0);
  d += 0.0035 * smoothstep(0.0, 0.3, uShock) * exp(-uShock*0.05) * sin(ang*34.0 - uShock*7.0) * smoothstep(front + 0.12, front - 0.35, ang) * smoothstep(0.35, 0.6, ang);
  return d;
}
void main(){
  vec3 n = normalize(position);
  vRest = n;
  vec3 t1 = normalize(cross(n, abs(n.y) > 0.99 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0)));
  vec3 t2 = cross(n, t1);
  float e = 0.004;
  vec3 n1 = normalize(n + t1*e), n2 = normalize(n + t2*e);
  vec3 p0 = n * (1.0 + disp(n)), p1 = n1 * (1.0 + disp(n1)), p2 = n2 * (1.0 + disp(n2));
  vec3 N = normalize(cross(p1 - p0, p2 - p0));
  if(dot(N, n) < 0.0) N = -N;
  vNGeoW = normalize(mat3(modelMatrix) * N);
  vec4 w = modelMatrix * vec4(p0, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const surfaceFS = /* glsl */`
precision highp float;
uniform sampler2D uDay, uNight, uSpec, uNormal, uClouds, uLava, uCrust;
uniform highp sampler3D uNoise;
uniform vec3 uSunDir, uSunCol, uSiteObj;
uniform float uTime, uFlood, uMolten, uFront, uShock, uDrift, uCrater, uLavaI, uNightI, uMoonI;
uniform vec3 uMoonDirW;
uniform mat3 uEarthRot;
varying vec3 vRest, vWorld, vNGeoW;
${GLSL_COMMON}
void main(){
  vec3 n0 = normalize(vRest);
  vec3 Ng = normalize(vNGeoW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);
  float dist = length(cameraPosition - vWorld);
  vec3 spec = texSph(uSpec, n0).rgb;
  float oc = smoothstep(0.35, 0.65, spec.r);
  float coastKm = spec.g * 1500.0;
  vec3 day = texSph(uDay, n0).rgb;

  // ---- close-range detail (only evaluated when the camera is near the ground)
  float near = smoothstep(7.0, 0.6, dist);
  float dN = 0.0; vec2 wave = vec2(0.0);
  if(near > 0.001){
    vec3 q = n0 * 340.0;
    float a = texture(uNoise, q).r, b = texture(uNoise, q * 5.3 + 0.31).b;
    dN = ((a - 0.5) * 0.7 + (b - 0.5) * 0.5) * near;
    vec3 q2 = n0 * 900.0 + vec3(uTime * 0.03, 0.0, uTime * 0.021);
    vec3 q3 = n0 * 2600.0 + vec3(-uTime * 0.05, uTime * 0.04, 0.0);
    vec4 w1 = texture(uNoise, q2), w2 = texture(uNoise, q3);
    wave = vec2(w1.g - 0.5 + (w2.b - 0.5) * 0.6, w1.a - 0.5 + (w2.g - 0.5) * 0.6) * near;
  }

  // ---- tidal flooding
  float fl = uFlood * 1150.0 * (0.55 + 0.9 * texture(uNoise, n0 * 26.0).b);
  float inund = (1.0 - oc) * (1.0 - smoothstep(fl * 0.72, fl, coastKm)) * step(0.002, uFlood);
  float foam = smoothstep(0.15, 0.5, inund) * (1.0 - smoothstep(0.5, 0.9, inund));
  float wet = max(oc, inund * 0.92);

  vec3 landCol = day * (1.0 + dN * 1.3);
  vec3 floodCol = vec3(0.035, 0.075, 0.095) + day * 0.12;
  vec3 base = mix(landCol, floodCol, inund * 0.9);
  base += foam * vec3(0.18, 0.2, 0.2) * (0.6 + wave.x);

  // ---- lighting
  vec3 nm = texSph(uNormal, n0).xyz * 2.0 - 1.0;
  vec3 E = normalize(vec3(n0.z, 0.0, -n0.x) + vec3(1e-5, 0.0, 0.0));
  vec3 Nn = cross(n0, E);
  vec3 Ew = normalize(uEarthRot * E), Nw = normalize(uEarthRot * Nn);
  vec3 N = normalize(Ng + (Ew * nm.x + Nw * nm.y) * 0.85 * (1.0 - wet));
  float ndlG = dot(Ng, L);
  float lit = smoothstep(-0.10, 0.22, ndlG);
  float dif = clamp(dot(N, L), 0.0, 1.0) * lit;

  // cloud shadows (cheap): sample cloud layer displaced toward the sun
  vec3 dr = rotY(n0, uDrift);
  float cl = texSph(uClouds, dr).r;
  vec3 shiftDir = normalize(n0 - (L - n0 * dot(L, n0)) * 0.006);
  float clS = texSph(uClouds, rotY(shiftDir, uDrift)).r;
  float shadow = 1.0 - 0.55 * smoothstep(0.35, 0.8, clS) * lit;

  vec3 col = base * dif * uSunCol * shadow;

  // sun glint on water
  vec3 Nwater = normalize(Ng + (Ew * wave.x + Nw * wave.y) * 0.2);
  vec3 H = normalize(L + V);
  float ndh = max(dot(Nwater, H), 0.0);
  float glint = (pow(ndh, 180.0) * 3.0 + pow(ndh, 24.0) * 0.12) * wet * lit * (1.0 - 0.85 * cl);
  col += uSunCol * vec3(1.0, 0.95, 0.85) * glint * 0.55;
  // fresnel sky reflection on water
  float fres = pow(1.0 - max(dot(Nwater, V), 0.0), 4.0);
  col += vec3(0.20, 0.38, 0.75) * fres * wet * lit * 0.55;

  // twilight warmth near the terminator
  float tw = exp(-pow(ndlG / 0.16, 2.0)) * lit;
  col += base * vec3(1.0, 0.42, 0.14) * tw * 0.55 * uSunCol * 0.35;

  // moonlight (the approaching Moon becomes a real light source) + lunar glitter path on water
  vec3 Lm = normalize(uMoonDirW);
  float mlit = smoothstep(-0.10, 0.25, dot(Ng, Lm));
  col += base * clamp(dot(N, Lm), 0.0, 1.0) * mlit * uMoonI * vec3(0.62, 0.72, 1.0) * (1.0 - 0.7 * cl);
  float ndhm = max(dot(Nwater, normalize(Lm + V)), 0.0);
  col += vec3(0.62, 0.74, 1.0) * (pow(ndhm, 150.0) * 2.2 + pow(ndhm, 18.0) * 0.08) * wet * mlit * uMoonI * 7.0 * (1.0 - 0.85 * cl);
  // ambient / earth-shine
  col += base * vec3(0.012, 0.020, 0.040);

  // night lights
  float nightMask = (1.0 - smoothstep(-0.20, 0.04, ndlG));
  vec3 city = texSph(uNight, n0).rgb * nightMask * (1.0 - inund) * (1.0 - uMolten) * uNightI;
  col += city * 1.9;

  // limb haze
  float fr = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
  col += vec3(0.28, 0.5, 0.95) * fr * lit * 0.22;

  // ---- molten aftermath
  vec3 emis = vec3(0.0);
  if(uFront > 0.001){
    float ang = acos(clamp(dot(n0, uSiteObj), -1.0, 1.0));
    float wob = (texture(uNoise, n0 * 3.0).r - 0.5) * 0.5 + (texture(uNoise, n0 * 9.0).g - 0.5) * 0.2;
    float aw = ang + wob * smoothstep(0.1, 1.0, uFront);
    float m = 1.0 - smoothstep(uFront - 0.32, uFront, aw);
    float rim = exp(-pow((uFront - aw) / 0.07, 2.0));
    float ahead = exp(-max(aw - uFront, 0.0) / 0.22) * (1.0 - m);
    // flowing lava: two counter-rotating samples of the emissive map
    vec3 l1 = texSph(uLava, rotY(n0, uTime * 0.012)).rgb;
    vec3 l2 = texSph(uLava, rotY(n0, -uTime * 0.009 + 1.7)).rgb;
    float pulse = 0.7 + 0.6 * texture(uNoise, n0 * 38.0 + vec3(0.0, uTime * 0.06, 0.0)).r;
    vec3 lava = mix(l1, l2, 0.45) * 1.1 * pulse;
    vec3 crust = texSph(uCrust, n0).rgb;
    vec3 solid = crust * dif * uSunCol * 0.55 + crust * 0.02;
    col = mix(col * mix(1.0, 0.45, ahead), solid, m);
    float plates = texture(uNoise, n0 * 420.0).r * 0.6 + texture(uNoise, n0 * 1700.0).g * 0.4;
    float nearK = smoothstep(7.0, 0.5, dist);
    float plateMask = mix(1.0, smoothstep(0.38, 0.66, plates) * 1.3, nearK);
    emis += lava * m * uLavaI * 1.0 * plateMask;
    emis += rim * vec3(6.0, 3.4, 1.4) * (1.0 - 0.6 * m);
    emis += ahead * vec3(0.55, 0.16, 0.04) * 0.6;
    emis += exp(-ang * ang / 0.05) * vec3(3.6, 1.7, 0.5) * smoothstep(0.0, 1.0, uCrater) * (0.45 + 0.55 * pulse);
  }
  gl_FragColor = vec4(col + emis, 1.0);
}`;

const cloudVS = /* glsl */`
varying vec3 vRest, vWorld, vNW;
void main(){
  vRest = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNW = normalize(mat3(modelMatrix) * vRest);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const cloudFS = /* glsl */`
precision highp float;
uniform sampler2D uClouds;
uniform highp sampler3D uNoise;
uniform vec3 uSunDir, uSunCol, uSiteObj;
uniform float uDrift, uMolten, uFront, uTime, uAsh, uCloudI;
varying vec3 vRest, vWorld, vNW;
${GLSL_COMMON}
void main(){
  vec3 n0 = normalize(vRest);
  float lat = asin(n0.y);
  vec3 dr = rotY(n0, uDrift * (1.0 + 0.55 * sin(lat * 3.0)));
  float c = texSph(uClouds, dr).r;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNW);
  float ndl = dot(N, normalize(uSunDir));
  float lit = smoothstep(-0.12, 0.28, ndl);
  float fine = texture(uNoise, n0 * 22.0 + vec3(uTime * 0.002)).b;
  float dens = clamp(c * (0.82 + 0.4 * fine), 0.0, 1.0);
  float alpha = smoothstep(0.10, 0.95, dens) * 0.80 * uCloudI;
  vec3 col = mix(vec3(0.50, 0.54, 0.62), vec3(0.88, 0.9, 0.93), smoothstep(0.3, 0.95, dens)) * (max(ndl, 0.0) * 0.85 + 0.04) * lit * uSunCol;
  col += vec3(1.0, 0.45, 0.2) * exp(-pow(ndl / 0.14, 2.0)) * 0.22 * dens * lit;
  col += vec3(0.015, 0.02, 0.04) * dens;

  if(uFront > 0.001){
    float ang = acos(clamp(dot(n0, uSiteObj), -1.0, 1.0));
    float wob = (texture(uNoise, n0 * 3.0).r - 0.5) * 0.5 + (texture(uNoise, n0 * 9.0).g - 0.5) * 0.2;
    float aw = ang + wob * smoothstep(0.1, 1.0, uFront);
    float m = 1.0 - smoothstep(uFront - 0.45, uFront + 0.05, aw);
    float ash = m * (0.55 + 0.9 * fine);
    float t2 = texture(uNoise, n0 * 6.0 + vec3(uTime * 0.004, 0.0, 0.0)).a;
    alpha = clamp(alpha + ash * 0.95 * uAsh, 0.0, 0.98);
    vec3 ashCol = vec3(0.07, 0.055, 0.05) * (0.6 + max(ndl, 0.0)) * uSunCol * 0.25;
    col = mix(col, ashCol, clamp(m * uAsh * 0.9, 0.0, 1.0));
    // glow from the molten surface underneath
    col += vec3(1.0, 0.33, 0.07) * m * (0.35 + 1.2 * t2) * 1.6 * uAsh * (0.4 + 0.6 * (1.0 - smoothstep(0.0, 1.0, uMolten)));
  }
  gl_FragColor = vec4(col, alpha);
}`;

const atmoVS = /* glsl */`
varying vec3 vWorld;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const atmoFS = /* glsl */`
precision highp float;
uniform vec3 uSunDir, uSunCol, uBlastPos, uTint;
uniform float uPR, uAR, uHot, uBlast, uBlastR, uK;
varying vec3 vWorld;
vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd), c = dot(ro, ro) - r*r, h = b*b - c;
  if(h < 0.0) return vec2(-1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
void main(){
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  vec2 ta = raySphere(ro, rd, uAR);
  float t0 = max(ta.x, 0.0), t1 = ta.y;
  vec2 tp = raySphere(ro, rd, uPR);
  if(tp.x > 0.0) t1 = min(t1, tp.x);
  if(t1 <= t0) discard;
  const int N = 24;
  float ds = (t1 - t0) / float(N);
  const float HR = 0.026, HM = 0.0085;
  vec3 bR = vec3(0.50, 1.18, 2.90) * uTint, bM = vec3(0.42);
  vec3 L = normalize(uSunDir);
  float cosT = dot(rd, L);
  float phR = 0.75 * (1.0 + cosT*cosT);
  const float g = 0.78;
  float phM = 1.5 * (1.0 - g*g) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*cosT, 1.5));
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 sum = vec3(0.0); float od = 0.0;
  for(int i = 0; i < N; i++){
    vec3 p = ro + rd * (t0 + (float(i) + jit) * ds);
    float h = max(length(p) - uPR, 0.0);
    float rR = exp(-h / HR), rM = exp(-h / HM);
    od += (rR + 0.25 * rM) * ds;
    vec3 tau = (bR * rR + bM * rM * 0.6) ;
    float pl = dot(p, L);
    float mu = pl / max(length(p), 1e-3);
    float sh = 1.0;
    if(pl < 0.0){ float dd = length(p - L * pl); sh = smoothstep(uPR * 0.985, uPR * 1.035, dd); }
    float pf = clamp(1.0 / (max(mu, 0.0) + 0.09), 1.0, 9.0);
    vec3 Tl = exp(-(bR * HR * rR + bM * 0.6 * HM * rM) * pf * 3.2);
    vec3 Tv = exp(-(bR * od * 0.0 + bR * (od * 1.0) + bM * od * 0.3));
    sum += (bR * rR * phR * 0.62 + bM * rM * phM * 0.9) * Tl * sh * Tv * ds;
    sum += uHot * vec3(1.0, 0.36, 0.08) * rR * ds * 0.55;
    if(uBlast > 0.0){
      vec3 dq = p - uBlastPos;
      sum += uBlast * exp(-dot(dq, dq) / (uBlastR * uBlastR)) * vec3(1.0, 0.55, 0.22) * (rR * 0.9 + 0.1) * ds * 6.0;
    }
  }
  gl_FragColor = vec4(sum * uSunCol * 0.42 * uK, 1.0);
}`;

export class Earth {
  constructor(tex, noise) {
    this.group = new THREE.Group();            // tilt + spin applied via matrix
    this.group.matrixAutoUpdate = false;
    const uni = {
      uDay: { value: tex.day }, uNight: { value: tex.night }, uSpec: { value: tex.spec }, uNormal: { value: tex.normal },
      uClouds: { value: tex.clouds }, uLava: { value: tex.lava }, uCrust: { value: tex.crust }, uNoise: { value: noise },
      uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: SUN_COL.clone() }, uMoonDirW: { value: new THREE.Vector3(1, 0, 0) }, uMoonI: { value: 0 }, uEarthRot: { value: new THREE.Matrix3() },
      uMoonObj: { value: new THREE.Vector3(1, 0, 0) }, uSiteObj: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 }, uFlood: { value: 0 }, uMolten: { value: 0 }, uFront: { value: 0 }, uShock: { value: 0 },
      uDrift: { value: 0 }, uCrater: { value: 0 }, uLavaI: { value: 1 }, uNightI: { value: 1 }, uTideAmp: { value: 0 },
    };
    this.uni = uni;
    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(1, 512, 256),
      new THREE.ShaderMaterial({ uniforms: uni, vertexShader: surfaceVS, fragmentShader: surfaceFS })
    );
    this.surface.scale.setScalar(RE);
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    this.cloudUni = {
      uClouds: uni.uClouds, uNoise: uni.uNoise, uSunDir: uni.uSunDir, uSunCol: uni.uSunCol, uSiteObj: uni.uSiteObj,
      uDrift: uni.uDrift, uMolten: uni.uMolten, uFront: uni.uFront, uTime: uni.uTime, uAsh: { value: 0 }, uCloudI: { value: 1 },
    };
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1, 256, 128),
      new THREE.ShaderMaterial({ uniforms: this.cloudUni, vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false })
    );
    this.clouds.scale.setScalar(RE * 1.0042);
    this.group.add(this.clouds);

    this.atmoUni = {
      uSunDir: uni.uSunDir, uSunCol: uni.uSunCol, uBlastPos: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uPR: { value: RE }, uAR: { value: RE + 0.14 }, uHot: { value: 0 }, uBlast: { value: 0 }, uBlastR: { value: 1 }, uK: { value: 1 },
    };
    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(RE + 0.14, 128, 64),
      new THREE.ShaderMaterial({
        uniforms: this.atmoUni, vertexShader: atmoVS, fragmentShader: atmoFS, side: THREE.BackSide,
        transparent: true, depthWrite: false, blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      })
    );
    this.atmo.frustumCulled = false;
    // atmosphere lives in world space (not in the rotating group)
    this._inv = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this.site = surfacePoint(SITE.lat, SITE.lon, T.IMPACT, 1);
  }
  get siteObj() { const la = THREE.MathUtils.degToRad(SITE.lat), lo = THREE.MathUtils.degToRad(SITE.lon); return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)); }

  update(s) {
    const t = s.t, u = this.uni;
    earthMatrix(t, this.group.matrix); this.group.matrixWorldNeedsUpdate = true;
    this._inv.copy(this.group.matrix).invert();
    u.uEarthRot.value.setFromMatrix4(this.group.matrix);
    u.uMoonObj.value.copy(s.dir).transformDirection(this._inv);
    if (!u.uSiteObj._set) { u.uSiteObj.value.copy(this.siteObj); u.uSiteObj._set = true; }
    u.uMoonDirW.value.copy(s.dir);
    u.uMoonI.value = s.alive ? Math.min(0.35, 0.02 * 0.5 * (1 - s.dir.dot(SUN_DIR)) * Math.pow(384.4 / s.d, 1.3)) : 0;
    u.uTime.value = t;
    u.uFlood.value = s.flood * (t < T.IMPACT ? 1 : Math.max(0, 1 - (t - T.IMPACT) / 6));
    const preTide = s.alive ? s.tide : Math.max(0, 1 - (t - T.IMPACT) / 3) * 1.0;
    u.uTideAmp.value = 0.034 * preTide;
    const ti = t - T.IMPACT;
    u.uCrater.value = ti > 0 ? easeOut(ti / 5) : 0;
    u.uShock.value = Math.max(0, ti);
    // molten front radius (radians from impact site), reaches the antipode around t = 410
    const front = ti > 0 ? Math.PI * 1.08 * Math.pow(clamp(ti / 78), 0.72) + 0.28 * easeOut(ti / 3) : 0;
    u.uFront.value = front;
    u.uMolten.value = s.molten;
    u.uLavaI.value = 1.0 - 0.25 * sstep(400, 478, t);
    u.uNightI.value = 1.0;
    u.uDrift.value = 0.0012 * t + 0.0022 * Math.max(0, t - 120) * (1 + sstep(150, 300, t));
    this.cloudUni.uAsh.value = sstep(T.IMPACT, T.IMPACT + 10, t);
    this.cloudUni.uCloudI.value = 1.0;
    // atmosphere
    const a = this.atmoUni;
    a.uHot.value = 0.9 * sstep(T.IMPACT + 3, T.IMPACT + 35, t) * (1 - 0.35 * sstep(400, 478, t));
    const hotT = sstep(T.IMPACT + 4, T.IMPACT + 70, t);
    a.uTint.value.set(1 + 0.8 * hotT, 1 - 0.25 * hotT, 1 - 0.55 * hotT);
    // blast glow: Moon plunging through the air, then the fireball
    const toSite = surfacePoint(SITE.lat, SITE.lon, t, RE * 1.001, this._v);
    a.uBlastPos.value.copy(toSite);
    const approach = s.alive ? sstep(2.0, 0.15, s.surfDist - RM) : 1;
    a.uBlast.value = (s.alive ? approach * 0.9 : 1.6 * Math.exp(-Math.max(0, ti) / 22) + 0.15);
    a.uBlastR.value = s.alive ? 2.0 : 2.5 + 4.5 * easeOut(ti / 10);
    // keep a pre-impact blast from showing before the Moon is near
    if (s.alive && s.surfDist > RM + 2.5) a.uBlast.value = 0;
    this.atmo.position.set(0, 0, 0);
  }
  addTo(scene) { scene.add(this.group); scene.add(this.atmo); }
}
