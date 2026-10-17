# What If the Moon Hit Earth? — 8-minute cinematic Three.js simulation
**Technical Talk India** · exactly 8:00 · 30 fps · 1080p and 4K · hypothetical scenario (not a prediction)

A single self-contained WebGL project. Everything on screen is a pure function of time `t`, so any frame can be
rendered independently — which is what lets GitHub Actions split the film across dozens of parallel runners.

| Time | Shot | What happens |
|------|------|--------------|
| 00:00 | Hook | Peaceful Earth limb, Moon far too large, title |
| 00:14 | Establishing | Wide orbital view, push-in, pan to reveal the Moon (384,400 km) |
| 01:00 | Moon grows | Dolly toward the Moon, cut to surface view; live angular-size + distance HUD |
| 02:00 | Oceans | Sun-glint glide over flooding coasts, tidal-bulge diagram (force ∝ 1/d³) |
| 03:00 | Breakup | Tidal heating cracks, Roche-zone label, Voronoi rubble stream |
| 04:00 | Debris ring | Fly through rocks (InstancedMesh), dust, Saturn-like ring with Earth's shadow |
| 05:00 | Impact | Tracking shot, wide cut, white flash, volumetric ejecta plume, Kepler-orbit ejecta |
| 06:00 | Aftermath | Molten front sweeping the globe, lava flow shader, ash clouds, glowing debris |
| 07:00 | Reveal | Pull back into deep space, fade to black, final question |

## Quick start
```bash
npm install                 # puppeteer-core (+ optional bundled Chromium)
npm start                   # live player → http://localhost:8080   (space = play, ←/→ ±5 s, 1–8 = chapters, f = fullscreen)
```
The live player needs a GPU for real-time playback; on weak machines scrub with the slider.

## Render on GitHub (recommended)
1. Create a repo, push this folder, enable Actions.
2. **Actions → "Render film" → Run workflow** → choose `1080p`, `4k` or `both`.
3. Download the artifacts `FINAL-1080p` / `FINAL-4k` (or tick *release* to get a GitHub Release).

The workflow: bakes textures (4096 px for 1080p, **8192 px for 4K**) → renders N parallel chunks using software
WebGL (SwiftShader – no GPU needed) → synthesises the soundtrack → (optionally) generates narration with `edge-tts`
(`en-IN-PrabhatNeural`) → joins and muxes to one MP4 (H.264, 30 fps, AAC 256k).

**Time/cost (measured on a 2-core sandbox, so treat as rough):** 1080p ≈ 3–8 s per frame, ≈ 15 s during the impact/plume
shots; 4K ≈ 4× that. Default chunks: 30 s (1080p, 16 jobs) and 6 s (4K, 80 jobs). GitHub's free tier runs 20 jobs at
once and caps each job at 6 h; private repos consume paid minutes, so use a public repo for the free tier.
If a 4K job times out, lower `chunk_seconds_4k`.

## Render locally (much faster with a GPU)
```bash
node tools/render.mjs --res 1080 --gpu --out out/1080p/video.mp4        # full film
node tools/render.mjs --res 4k   --gpu --out out/4k/video.mp4
node tools/render.mjs --res 1080 --still 5,94,330.3,385 --out out/stills # test frames
python3 tools/make_audio.py && python3 tools/narrate.py                  # audio (optional)
node tools/mux.mjs --chunks out/1080p --out out/final_1080p.mp4          # needs *.mp4 chunks in that dir
```
Set `CHROME_PATH` if Chrome is not auto-detected. `--start/--end` render a time range; `--samples 0|4` toggles MSAA.

## Textures
`tools/bake_textures.py` turns the equirectangular base maps in `assets/source/` into film-ready maps
(day / night / clouds / ocean + coast-distance / normal / lava / crust / Moon albedo / Moon normal with a
true crater size distribution / Milky Way). `assets/baked/` already contains 4096-px output.
**For the best result drop real NASA maps into `assets/source/` (same file names, any resolution — Blue Marble, LROC) and run
`npm run textures:8k`.** The shipped source maps come from the three.js examples repository; I could not verify
their licence terms, so check them (or swap in NASA imagery, which is generally public domain) before monetising.

## Project layout
```
index.html            player + overlay markup          src/sim.js      scenario physics (pure f(t))
src/shots.js          8 camera shots                   src/earth.js    surface / clouds / atmosphere shaders
src/moon.js           shattering Moon                  src/debris.js   rocks, dust, ring, ejecta, plume
src/overlay.js        HUD, captions, diagrams          src/post.js     bloom, flash, tone-map, film finish
data/script.json      captions + narration lines       tools/          bake, render, audio, narrate, mux
```

## Scientific notes (also in the film)
* The Moon is presently receding ~3.8 cm/yr; the approach requires an unspecified trigger that removes its orbital momentum.
* Tidal force scales as 1/d³ (HUD shows the live ratio). Tides, flooding and plume sizes are exaggerated for visibility.
* Roche limit ≈ 9,500 km (rigid) – 18,400 km (fluid), centre to centre; breakup distance depends on strength, density and path.
* Impact speed ≈ 9.8 km/s from rest at 384,400 km; kinetic energy ≈ 3.5×10³⁰ J (~10⁷ × Chicxulub). The debris ring is one possible outcome.
* Not simulated physically: real orbital time (time is compressed), N-body fragment dynamics, atmospheric chemistry.

## Controls / flags
`?t=95` start at a time · `?tc` show timecode · `?pix=1` lower render scale · `?samples=0` disable MSAA.
