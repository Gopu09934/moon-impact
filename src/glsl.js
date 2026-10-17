// Shared GLSL snippets + procedural 3D noise volume.
import * as THREE from 'three';

export const GLSL_VERT = /* glsl */`
const float PI = 3.14159265359;
// Texture convention: lon = atan2(-z, x), so +x is longitude 0 and east is to the right when viewed from outside.
vec2 sphUV(vec3 d){ return vec2(atan(-d.z, d.x) / 6.28318531 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5); }
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 rotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c*v.x + s*v.z, v.y, -s*v.x + c*v.z); }
// cinematic blackbody-ish ramp, x in 0..~4 (HDR out)
vec3 fireRamp(float x){
  x = max(x, 0.0);
  vec3 c = vec3(0.0);
  c.r = smoothstep(0.0, 0.35, x) * 1.0 + smoothstep(0.8, 3.0, x) * 3.0;
  c.g = smoothstep(0.25, 1.0, x) * 0.55 + smoothstep(1.0, 3.0, x) * 2.6;
  c.b = smoothstep(0.9, 2.2, x) * 0.5 + smoothstep(2.2, 4.0, x) * 2.8;
  return c * min(x, 2.5) * 0.9;
}
`;

export const GLSL_COMMON = GLSL_VERT + /* glsl */`
// Seam-free equirect sampling (derivatives are taken from whichever of two uv parameterisations is continuous)
vec4 texSph(sampler2D t, vec3 d){
  vec2 uv = sphUV(d);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 ax = dFdx(uv), ay = dFdy(uv), bx = dFdx(uv2), by = dFdy(uv2);
  bool useA = (dot(ax,ax) + dot(ay,ay)) < (dot(bx,bx) + dot(by,by));
  return textureGrad(t, uv, useA ? ax : bx, useA ? ay : by);
}
`;

/** Tileable RGBA value-noise volume (R: soft fbm, G: ridge, B: fbm #2, A: billow). */
export function makeNoise3D(size = 96) {
  const S = size, data = new Uint8Array(S * S * S * 4);
  const lat = (seed, P) => {
    const g = new Float32Array(P * P * P);
    let s = seed >>> 0;
    for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return g;
  };
  const periods = [4, 8, 16, 32, 64];
  const channels = [101, 202, 303, 404].map((seed) => periods.map((P, i) => ({ P, g: lat(seed + i * 17, P) })));
  const sm = (t) => t * t * (3 - 2 * t);
  const sample = (oct, x, y, z) => {
    const { P, g } = oct;
    const fx = x * P, fy = y * P, fz = z * P;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = sm(fx - x0), ty = sm(fy - y0), tz = sm(fz - z0);
    const X0 = ((x0 % P) + P) % P, Y0 = ((y0 % P) + P) % P, Z0 = ((z0 % P) + P) % P;
    const X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P, Z1 = (Z0 + 1) % P;
    const i = (a, b, c) => g[(c * P + b) * P + a];
    const a = i(X0, Y0, Z0) + (i(X1, Y0, Z0) - i(X0, Y0, Z0)) * tx;
    const b = i(X0, Y1, Z0) + (i(X1, Y1, Z0) - i(X0, Y1, Z0)) * tx;
    const c = i(X0, Y0, Z1) + (i(X1, Y0, Z1) - i(X0, Y0, Z1)) * tx;
    const d = i(X0, Y1, Z1) + (i(X1, Y1, Z1) - i(X0, Y1, Z1)) * tx;
    return (a + (b - a) * ty) + ((c + (d - c) * ty) - (a + (b - a) * ty)) * tz;
  };
  const amps = [1, 0.62, 0.38, 0.22, 0.13];
  const tot = amps.reduce((a, b) => a + b, 0);
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = ((z * S + y) * S + x) * 4;
    const u = x / S, v = y / S, w = z / S;
    for (let ch = 0; ch < 4; ch++) {
      let s = 0;
      for (let k = 0; k < 5; k++) s += amps[k] * sample(channels[ch][k], u, v, w);
      s /= tot;
      let val = s;
      if (ch === 1) val = 1 - Math.abs(2 * s - 1);
      if (ch === 3) val = Math.abs(2 * s - 1);
      // contrast stretch around the mean so thresholds behave
      val = Math.min(1, Math.max(0, (val - 0.5) * 1.55 + 0.5));
      data[o + ch] = (val * 255) | 0;
    }
  }
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}
