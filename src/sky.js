// Starfield (3D points with real-ish magnitude/colour distribution) + soft Milky Way band.
import * as THREE from 'three';
import { GLSL_COMMON } from './glsl.js';
import { rng } from './sim.js';

const starVS = /* glsl */`
attribute vec4 aStar; uniform float uPix; uniform float uTime;
varying vec3 vC;
void main(){
  float mag = aStar.w;
  float tw = 1.0 + 0.06 * sin(uTime * (0.7 + aStar.x * 3.0) + aStar.y * 40.0);
  vec3 col = mix(vec3(1.0, 0.68, 0.45), mix(vec3(1.0), vec3(0.62, 0.74, 1.0), aStar.z), aStar.y);
  vC = col * (0.12 + 1.8 * pow(mag, 2.6)) * tw;
  gl_PointSize = (1.0 + 2.4 * pow(mag, 5.0)) * uPix;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const starFS = /* glsl */`
precision highp float; varying vec3 vC;
void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(q)); gl_FragColor = vec4(vC * a, 1.0); }`;

const mwFS = /* glsl */`
precision highp float;
uniform sampler2D uMW; uniform highp sampler3D uNoise; uniform float uI;
varying vec3 vDir;
${GLSL_COMMON}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = texSph(uMW, d).rgb;
  float grain = 0.8 + 0.45 * texture(uNoise, d * 38.0).b;
  c = mix(vec3(dot(c, vec3(0.33))), c, 0.55) * vec3(0.9, 0.98, 1.12);
  gl_FragColor = vec4(c * grain * uI, 1.0);
}`;

export class Sky {
  constructor(tex, noise) {
    this.group = new THREE.Group();
    const N = 16000, r = rng(31337);
    const pos = new Float32Array(N * 3), st = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      // slight concentration towards the galactic plane
      pos.set([Math.cos(a) * s * 3000, z * 3000, Math.sin(a) * s * 3000], i * 3);
      st.set([r(), r(), r(), Math.pow(r(), 5.5)], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aStar', new THREE.BufferAttribute(st, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.starUni = { uPix: { value: 1 }, uTime: { value: 0 } };
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.starUni, vertexShader: starVS, fragmentShader: starFS, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true,
    }));
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.mwUni = { uMW: { value: tex.milkyway }, uNoise: { value: noise }, uI: { value: 0.42 } };
    this.mw = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.mwUni, vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: mwFS, side: THREE.BackSide, depthTest: false, depthWrite: false,
    }));
    this.mw.renderOrder = -10; this.mw.frustumCulled = false;
    this.group.add(this.mw, this.stars);
  }
  addTo(scene) { scene.add(this.group); }
  update(camera, t, pix) {
    this.group.position.copy(camera.position);
    this.starUni.uPix.value = pix; this.starUni.uTime.value = t;
  }
}
