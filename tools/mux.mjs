#!/usr/bin/env node
// Join video chunks, add soundtrack (+ narration with ducking) → final MP4.
//   node tools/mux.mjs --chunks out/1080p/chunks --out out/Moon_Impact_1080p30.mp4 [--audio assets/audio/soundtrack.wav] [--narration assets/audio/narration.wav]
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const dir = arg('chunks', 'out/chunks'), out = arg('out', 'out/final.mp4');
const music = arg('audio', 'assets/audio/soundtrack.wav'), narr = arg('narration', 'assets/audio/narration.wav');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort();
if (!files.length) throw new Error('no chunks in ' + dir);
const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, files.map((f) => `file '${path.resolve(dir, f)}'`).join('\n'));
const silent = out.replace(/\.mp4$/, '.silent.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent], { stdio: 'inherit' });
const hasMusic = fs.existsSync(music), hasNarr = fs.existsSync(narr);
if (!hasMusic && !hasNarr) { fs.renameSync(silent, out); console.log('no audio found – wrote silent', out); process.exit(0); }
const inputs = ['-i', silent]; if (hasMusic) inputs.push('-i', music); if (hasNarr) inputs.push('-i', narr);
let fc;
if (hasMusic && hasNarr) fc = '[2:a]asplit=2[n1][n2];[1:a][n1]sidechaincompress=threshold=0.02:ratio=7:attack=25:release=500[m];[m][n2]amix=inputs=2:normalize=0:weights=1 1.25,alimiter=limit=0.97[a]';
else fc = '[1:a]alimiter=limit=0.97[a]';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', '480', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.unlinkSync(silent);
console.log('wrote', out);
