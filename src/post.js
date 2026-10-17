// Post-processing: HDR bloom → flash/exposure grade → ACES tone-map + sRGB → film finish (vignette, CA, grain, fade).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uExposure: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uFlash, uExposure; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uExposure * uTint;
      col += vec3(1.0, 0.97, 0.9) * uFlash * 6.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 0 }, uVig: { value: 0.32 }, uGrain: { value: 0.022 }, uCA: { value: 0.0012 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uLift: { value: 0.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uFade, uVig, uGrain, uCA, uLift; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uCA * (1.0 + r2 * 4.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // gentle filmic contrast + cool shadows / warm highlights
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      c += vec3(-0.004, 0.0, 0.010) * (1.0 - l);
      float vig = 1.0 - uVig * smoothstep(0.18, 0.95, r2 * 2.2);
      c *= vig;
      // blue-noise-ish grain + dithering (kills banding in dark space gradients)
      float g = h(vUv * uRes + fract(uTime) * 61.0) - 0.5;
      float g2 = h(vUv * uRes * 0.5 + fract(uTime * 1.7) * 37.0) - 0.5;
      c += (g * 0.7 + g2 * 0.3) * uGrain * (0.35 + 0.65 * (1.0 - l)) + g / 255.0;
      c = max(c, 0.0) + uLift;
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, w, h, pix, samples) {
    this.renderer = renderer;
    const rt = new THREE.WebGLRenderTarget(w * pix, h * pix, { type: THREE.HalfFloatType, samples, colorSpace: THREE.LinearSRGBColorSpace });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pix); this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w * pix * 0.5, h * pix * 0.5), 0.35, 0.75, 1.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader); this.composer.addPass(this.film);
    this.film.uniforms.uRes.value.set(w * pix, h * pix);
  }
  setSize(w, h, pix) { this.composer.setPixelRatio(pix); this.composer.setSize(w, h); this.film.uniforms.uRes.value.set(w * pix, h * pix); }
  render() { this.composer.render(); }
}
