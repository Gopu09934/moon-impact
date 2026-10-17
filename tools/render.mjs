#!/usr/bin/env node
// Frame-exact renderer: drives the page with __renderFrame(n) and pipes screenshots into ffmpeg.
//
//   node tools/render.mjs --res 1080 --start 0 --end 480 --out out/1080p/full.mp4
//   node tools/render.mjs --res 4k   --start 60 --end 90 --out out/4k/chunk_002.mp4
//   node tools/render.mjs --res 1080 --still 5,25,95 --out out/stills        (PNG test frames)
//
// --gpu   use the machine's real GPU (fast).  Default is software WebGL (SwiftShader) – works on any GitHub runner.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { serve } from './serve.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); if (i < 0) return d; const v = process.argv[i + 1]; return (!v || v.startsWith('--')) ? true : v; };
const FPS = 30, DURATION = 480;
const res = String(arg('res', '1080'));
const pix = res === '4k' || res === '2160' ? 2 : 1;
const start = parseFloat(arg('start', 0)), end = parseFloat(arg('end', DURATION));
const out = String(arg('out', pix === 2 ? 'out/4k/video.mp4' : 'out/1080p/video.mp4'));
const still = arg('still', null), gpu = !!arg('gpu', false);
const samples = String(arg('samples', pix === 2 ? '0' : '4'));
const crf = String(arg('crf', pix === 2 ? '15' : '14'));
const port = +arg('port', 8765);
const texDir = String(arg('tex', './assets/baked/'));

async function findChrome() {
  for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)) {
    try { if (fs.existsSync(p) && !/snap/.test(fs.readFileSync(p, 'utf8').slice(0, 200))) return p; } catch { /* binary */ if (fs.existsSync(p)) return p; }
  }
  try { const chromium = (await import('@sparticuz/chromium')).default; return await chromium.executablePath(); } catch {}
  throw new Error('No Chrome found. Set CHROME_PATH or install google-chrome / @sparticuz/chromium.');
}

const srv = await serve(port);
const exe = await findChrome();
const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb'];
if (!gpu) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'); else args.push('--use-gl=angle', '--enable-gpu-rasterization');
const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args, protocolTimeout: 0, defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: pix } });
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (/error|warn|fail/i.test(t)) console.log('[page]', t.slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
await page.goto(`http://localhost:${port}/index.html?render=1&pix=${pix}&samples=${samples}&tex=${encodeURIComponent(texDir)}`);
await page.waitForFunction('window.__ready === true || window.__error', { timeout: 0 });
const err = await page.evaluate('window.__error');
if (err) { console.error(err); process.exit(1); }
console.log(`ready · ${pix === 2 ? '3840×2160' : '1920×1080'} · ${gpu ? 'GPU' : 'software WebGL'} · chrome=${exe}`);

const shot = async () => page.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false });

if (still) {
  const dir = out; fs.mkdirSync(dir, { recursive: true });
  for (const ts of String(still).split(',')) {
    const t0 = Date.now(); await page.evaluate(`window.__renderFrame(${Math.round(parseFloat(ts) * FPS)})`);
    const buf = await shot(); const f = path.join(dir, `t${String(ts).padStart(6, '0').replace('.', '_')}.png`); fs.writeFileSync(f, buf);
    console.log(`still t=${ts}s → ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await browser.close(); srv.close(); process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const f0 = Math.round(start * FPS), f1 = Math.round(end * FPS);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', String(arg('preset', 'medium')), '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', '30', '-bf', '2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('error', (e) => { console.error('ffmpeg not found or failed: install ffmpeg (sudo apt-get install ffmpeg)'); process.exit(1); });
const done = new Promise((r) => ff.on('close', r));
const T0 = Date.now();
for (let f = f0; f < f1; f++) {
  await page.evaluate(`window.__renderFrame(${f})`);
  const buf = await shot();
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if ((f - f0) % 15 === 0) { const el = (Date.now() - T0) / 1000, n = f - f0 + 1; console.log(`frame ${f}/${f1} (${(f / FPS).toFixed(1)}s)  ${(el / n).toFixed(2)} s/frame  eta ${(((f1 - f - 1) * el) / n / 60).toFixed(1)} min`); }
}
ff.stdin.end(); await done; await browser.close(); srv.close();
console.log('wrote', out);
