#!/usr/bin/env python3
"""
Narration track from data/script.json  ->  assets/audio/narration.wav  (aligned to the timeline)

Uses the free `edge-tts` package (Microsoft neural voices; needs internet – fine on GitHub runners).
Default voice is Indian-English male:  en-IN-PrabhatNeural   (female: en-IN-NeerjaNeural)

    pip install edge-tts
    python3 tools/narrate.py [--voice en-IN-PrabhatNeural] [--rate +0%]

Each line is synthesised separately and placed at its "t" timestamp.  If a line is longer than its
slot it is sped up (max 1.3x) so it never collides with the next line.  If edge-tts is unavailable
the script exits cleanly and the film is simply muxed without narration (captions are still burned in).
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("--voice", default="en-IN-PrabhatNeural")
ap.add_argument("--rate", default="-4%")
ap.add_argument("--script", default="data/script.json")
ap.add_argument("--out", default="assets/audio/narration.wav")
a = ap.parse_args()

try:
    import edge_tts
except Exception:
    print("edge-tts not installed (pip install edge-tts) – skipping narration."); sys.exit(0)

script = json.load(open(a.script, encoding="utf-8"))
lines = script["lines"]
tmp = tempfile.mkdtemp()

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)

async def synth(i, text):
    p = os.path.join(tmp, f"l{i:02d}.mp3")
    await edge_tts.Communicate(text, a.voice, rate=a.rate).save(p)
    return p

async def main():
    paths = []
    for i, l in enumerate(lines):
        try: paths.append(await synth(i, l["text"]))
        except Exception as e:
            print("TTS failed:", e); return None
    return paths

paths = asyncio.run(main())
if not paths:
    print("narration skipped (no network / voice unavailable)"); sys.exit(0)

inputs, filters, labels = [], [], []
for i, (l, p) in enumerate(zip(lines, paths)):
    dur = probe(p)
    slot = (lines[i + 1]["t"] if i + 1 < len(lines) else 480) - l["t"] - 0.25
    tempo = min(1.3, max(1.0, dur / max(slot, 1.0)))
    if tempo > 1.0: print(f"line {i}: {dur:.1f}s > slot {slot:.1f}s → atempo {tempo:.2f}")
    inputs += ["-i", p]
    ms = int(l["t"] * 1000)
    filters.append(f"[{i}:a]atempo={tempo:.3f},aresample=44100,pan=stereo|c0=c0|c1=c0,adelay={ms}|{ms}[a{i}]")
    labels.append(f"[a{i}]")
fc = ";".join(filters) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.95[out]"
os.makedirs(os.path.dirname(a.out), exist_ok=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", fc, "-map", "[out]", "-t", "480", "-ar", "44100", a.out], check=True)
print("wrote", a.out)
