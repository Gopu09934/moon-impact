import * as THREE from 'three';
import { state, DURATION, FPS, T, RE, SUN_DIR, clamp, sstep } from './sim.js';
import { makeNoise3D } from './glsl.js';
import { loadTextures } from './textures.js';
import { Earth } from './earth.js';
import { Moon } from './moon.js';
import { Rocks, Dust, RingDisc, Ejecta, Plume } from './debris.js';
import { Sky } from './sky.js';
import { Post } from './post.js';
import { shotAt, applyCamera, applyHook } from './shots.js';
import { Overlay } from './overlay.js';

const q = new URLSearchParams(location.search);
const RENDER_MODE = q.has('render');                         // frame-exact mode driven by tools/render.mjs
const PIX = parseFloat(q.get('pix') || (RENDER_MODE ? '1' : String(Math.min(window.devicePixelRatio || 1, 2))));
const SAMPLES = parseInt(q.get('samples') ?? (RENDER_MODE ? '4' : '4'), 10);
const W = 1920, H = 1080;
const TEX = q.get('tex') || './assets/baked/';

const status = document.getElementById('status');
const say = (m) => { if (status) status.textContent = m; };

async function boot() {
  const stage = document.getElementById('stage');
  stage.style.width = W + 'px'; stage.style.height = H + 'px';
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: RENDER_MODE, stencil: false, alpha: false });
  renderer.setPixelRatio(PIX); renderer.setSize(W, H, false);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  say('Generating noise volume…');
  const noise = makeNoise3D(96);
  say('Loading textures…');
  const tex = await loadTextures(renderer, TEX, (p) => say(`Loading textures… ${Math.round(p * 100)}%`));
  say('Building world…');
  const script = await (await fetch('./data/script.json')).json();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 7000);
  const sky = new Sky(tex, noise); sky.addTo(scene);
  const earth = new Earth(tex, noise); earth.addTo(scene);
  earth.clouds.renderOrder = 2; earth.atmo.renderOrder = 3;
  const ring = new RingDisc(noise); ring.addTo(scene); ring.mesh.renderOrder = 4;
  const moon = new Moon({ moonAlbedo: tex.moonAlbedo, moonNormal: tex.moonNormal }, noise); moon.addTo(scene);
  const rocks = new Rocks(noise); rocks.addTo(scene);
  const dust = new Dust(); dust.addTo(scene); dust.points.renderOrder = 10;
  const ejecta = new Ejecta(); ejecta.addTo(scene); ejecta.points.renderOrder = 11;
  const plume = new Plume(noise); plume.addTo(scene);
  const post = new Post(renderer, scene, camera, W, H, PIX, SAMPLES);
  const overlay = new Overlay(script);

  document.fonts && (await document.fonts.ready);

  let last = null;
  function renderAt(t) {
    t = clamp(t, 0, DURATION - 1 / FPS);
    const s = applyHook(state(t));
    const c = shotAt(t, s);
    applyCamera(camera, c, t);
    earth.update(s); moon.update(s); rocks.update(s); ring.update(s);
    dust.update(s, camera, H, PIX); ejecta.update(s, camera, H, PIX); plume.update(s);
    sky.update(camera, t, PIX);
    // dynamic post
    const ti = t - T.IMPACT;
    post.bloom.strength = c.bloom + 0.4 * Math.exp(-Math.max(0, ti) / 6) * (t > T.IMPACT ? 1 : 0);
    post.bloom.radius = 0.7; post.bloom.threshold = 1.9;
    post.grade.uniforms.uFlash.value = c.flash || 0;
    post.grade.uniforms.uExposure.value = c.exposure;
    post.film.uniforms.uTime.value = t;
    post.film.uniforms.uFade.value = clamp(c.fade);
    post.render();
    overlay.update(t, s, camera, c.name, { timecode: q.has('tc') });
    // fade overlays with the picture on hard cuts
    document.getElementById('hudlayer').style.opacity = String(1 - clamp(c.fade) * 0.9);
    last = { t, s, c };
    return last;
  }
  window.__renderAt = renderAt;
  window.__renderFrame = async (f) => { renderAt(f / FPS); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; };
  window.__ready = true;
  say('');
  document.getElementById('loading').style.display = 'none';

  if (RENDER_MODE) { document.getElementById('ui').style.display = 'none'; return; }

  // -------- interactive preview player --------
  const bar = document.getElementById('scrub'), clock = document.getElementById('clock'), playBtn = document.getElementById('play'), ui = document.getElementById('ui');
  let t = parseFloat(q.get('t') || '0'), playing = q.get('t') === null, t0 = performance.now() - t * 1000, audio = null;
  try { audio = new Audio('./assets/audio/soundtrack.m4a'); audio.preload = 'auto'; audio.onerror = () => (audio = null); } catch (e) {}
  const setPlaying = (p) => { playing = p; playBtn.textContent = p ? '❚❚' : '▶'; t0 = performance.now() - t * 1000; if (audio) { try { audio.currentTime = t; p ? audio.play().catch(() => {}) : audio.pause(); } catch (e) {} } };
  playBtn.onclick = () => setPlaying(!playing);
  bar.max = DURATION; bar.oninput = () => { t = parseFloat(bar.value); t0 = performance.now() - t * 1000; if (audio) { try { audio.currentTime = t; } catch (e) {} } if (!playing) renderAt(t); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    if (e.key === 'ArrowRight') { t = Math.min(DURATION - 0.05, t + 5); t0 = performance.now() - t * 1000; }
    if (e.key === 'ArrowLeft') { t = Math.max(0, t - 5); t0 = performance.now() - t * 1000; }
    if (e.key === 'f') document.documentElement.requestFullscreen?.();
    if (e.key >= '1' && e.key <= '8') { t = (parseInt(e.key, 10) - 1) * 60; t0 = performance.now() - t * 1000; }
    if (e.key === 'h') ui.classList.toggle('hidden');
  });
  const fit = () => { const k = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `translate(-50%,-50%) scale(${k})`; };
  addEventListener('resize', fit); fit();
  const loop = () => {
    if (playing) { t = (performance.now() - t0) / 1000; if (t >= DURATION) { t = DURATION - 0.05; setPlaying(false); } }
    renderAt(t);
    bar.value = t; clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')} / 08:00`;
    requestAnimationFrame(loop);
  };
  setPlaying(playing);
  loop();
}
boot().catch((e) => { console.error(e); say('ERROR: ' + e.message); window.__error = String(e && e.stack || e); });
