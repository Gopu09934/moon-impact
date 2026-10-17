#!/usr/bin/env python3
"""
Procedural soundtrack for "What If the Moon Hit Earth?" – 8:00, stereo, 44.1 kHz.
No samples, no downloads: pads, sub-bass, heartbeat, tidal swells, rock cracks, debris whooshes,
the impact boom, lava crackle and a final solo bell motif – all synthesised with numpy/scipy and
timed to the same timeline as the visuals (src/sim.js).

    python3 tools/make_audio.py               -> assets/audio/soundtrack.wav (+ .m4a if ffmpeg is present)
"""
import os, subprocess, sys
import numpy as np
from scipy import signal

SR = 44100
DUR = 480.0
N = int(SR * DUR)
T = np.arange(N) / SR
rng = np.random.default_rng(8)
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "audio")
os.makedirs(OUT, exist_ok=True)

IMPACT = 330.0

def env_points(pts):
    x, y = zip(*pts)
    return np.interp(T, x, y)

def lp(x, fc, order=2):
    sos = signal.butter(order, fc, "low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)

def hp(x, fc, order=2):
    sos = signal.butter(order, fc, "high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)

def bp(x, lo, hi):
    sos = signal.butter(2, [lo, hi], "band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)

def place(buf, sig, t0, gain=1.0, pan=0.0):
    """add a mono signal into stereo buf at time t0 with equal-power pan (-1..1)"""
    if t0 < 0:
        sig = sig[int(-t0 * SR):]; t0 = 0.0
    i0 = int(t0 * SR)
    if i0 >= N or len(sig) == 0: return
    n = min(len(sig), N - i0)
    a = (pan + 1) * np.pi / 4
    buf[i0:i0 + n, 0] += sig[:n] * gain * np.cos(a)
    buf[i0:i0 + n, 1] += sig[:n] * gain * np.sin(a)

def noise(n): return rng.standard_normal(n).astype(np.float64)

# ------------------------------------------------------------------ pads / drone
def pad(freqs, dur, detune=0.0035, harmonics=6):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for k, d in enumerate((-1, 0, 1)):
            ff = f * (1 + d * detune)
            vib = 1 + 0.0015 * np.sin(2 * np.pi * (0.13 + 0.05 * k) * t + k)
            for h in range(1, harmonics + 1):
                out += np.sin(2 * np.pi * ff * h * t * vib + h * k) / (h ** 1.6)
    return out / (len(freqs) * 3)

# chords: (start, end, notes)
A2, C3, D3, E3, F3, G3, A3, C4, D4, E4, F4, G4, A4, B4, C5, E5 = 110.0, 130.81, 146.83, 164.81, 174.61, 196.0, 220.0, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 659.25
sections = [
    (0, 30, [A2, E3, A3, C4, B4]),
    (30, 60, [A2, E3, A3, D4, G4]),
    (60, 120, [F3 / 2, C3, F3, A3, C4]),
    (120, 180, [A2, E3, A3, C4, E4]),
    (180, 240, [D3 / 2 * 2, A2, D3, F3, A3]),
    (240, 300, [A2 * 0.5 * 2, E3, G3, C4, E4]),
    (300, 330, [A2, A2 * 1.5, E3 * 1.0, C4, B4 * 1.0]),
    (334, 400, [A2 * 0.5, E3 * 0.75, A3 * 0.75, 233.08, 277.18]),   # dissonant cluster
    (400, 440, [A2, E3, A3, C4, E4]),
    (440, 480, [A2, E3, A3, C4, E4, B4]),
]
music = np.zeros((N, 2))
for (a, b, notes) in sections:
    fade = 5.0
    d = (b - a) + 2 * fade
    sig = pad(notes, d)
    t = np.arange(len(sig)) / SR
    e = np.minimum(1, np.minimum(t / fade, (d - t) / fade)); e = np.clip(e, 0, 1) ** 1.5
    sig = lp(sig, 2600 if a < 300 else 1600) * e
    place(music, sig, a - fade, 1.0, -0.15)
    place(music, np.roll(sig, int(0.013 * SR)), a - fade, 0.8, 0.15)

# sub bass drone following the tension curve
tension = env_points([(0, .35), (14, .15), (58, .25), (120, .45), (180, .6), (240, .8), (300, 1.0), (329.2, 1.0), (329.9, 0.0), (332, .0), (336, .5), (400, .45), (440, .3), (470, .2), (480, 0)])
sub = np.sin(2 * np.pi * 55.0 * T + 0.8 * np.sin(2 * np.pi * 0.07 * T)) * 0.5 + np.sin(2 * np.pi * 27.5 * T) * 0.5
music[:, 0] += sub * tension * 0.35; music[:, 1] += sub * tension * 0.35

# intensity of the pad itself
mi = env_points([(0, .45), (10, .5), (14, .1), (20, .3), (58, .35), (120, .5), (180, .65), (240, .8), (300, .95), (326, .9), (329.4, 0.9), (329.9, 0.0), (333, 0.0), (340, .35), (360, .6), (420, .55), (462, .4), (476, 0.05), (480, 0)])
music *= mi[:, None] * 0.9

# ------------------------------------------------------------------ rhythmic tension
sfx = np.zeros((N, 2))
def thump(f0=62, dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (f0 * np.exp(-t * 6) + 28) * t) * np.exp(-t * 9)
th = thump()
t = 190.0
while t < 329.0:
    rate = 1.3 + 2.6 * ((t - 190) / 140) ** 1.6          # beats per second
    g = 0.12 + 0.55 * ((t - 190) / 140)
    place(sfx, th, t, g); place(sfx, th, t + 0.22 / rate * 1.0, g * 0.55)
    t += 1.0 / rate

# ------------------------------------------------------------------ rumble (grows with 1/d)
def moon_distance_env():
    ts = [0, 58, 66, 80, 92, 104, 120, 150, 180, 200, 215, 235, 260, 300, 330]
    ds = [384, 384, 310, 200, 130, 92, 64, 44, 32, 27, 23.8, 19.6, 16.2, 11.6, 8.1]
    return np.interp(T, ts, ds)
dist = moon_distance_env()
rumble = lp(noise(N), 90, 3) * 6
rumble += lp(noise(N), 240, 2) * 1.2 * (0.4 + 0.6 * np.sin(2 * np.pi * 0.21 * T) ** 2)
rum_env = np.clip((384 / dist - 1) / 45, 0, 1.0) ** 0.8 * (T < 329.6) * 0.7
sfx[:, 0] += rumble * rum_env; sfx[:, 1] += np.roll(rumble, 977) * rum_env

# tidal swells: slow filtered-noise sweeps, 2:00–3:00
for k, t0 in enumerate(np.arange(121, 176, 7.0)):
    n = int(6.0 * SR); tt = np.arange(n) / SR
    w = bp(noise(n), 200 + 90 * k, 900 + 250 * k) * np.sin(np.pi * tt / 6.0) ** 2
    place(sfx, w * 0.45, t0, 1.0, (-1) ** k * 0.5)

# rock cracks (3:00–4:00) — short noise bursts + low thud
for t0 in np.sort(rng.uniform(186, 242, 70)):
    n = int(0.35 * SR); tt = np.arange(n) / SR
    c = hp(noise(n), 600) * np.exp(-tt * 38) * 0.9 + lp(noise(n), 160) * np.exp(-tt * 14) * 1.5
    place(sfx, c, t0, rng.uniform(.25, .7) * (0.4 + 0.6 * (t0 - 186) / 56), rng.uniform(-.8, .8))
# metallic groan as the Moon is stretched
n = int(30 * SR); tt = np.arange(n) / SR
groan = np.sin(2 * np.pi * (48 + 12 * np.sin(2 * np.pi * 0.11 * tt)) * tt) * np.sin(np.pi * tt / 30) ** 2
groan += 0.5 * np.sin(2 * np.pi * (96.7 + 5 * np.sin(2 * np.pi * 0.17 * tt)) * tt) * np.sin(np.pi * tt / 30) ** 2
place(sfx, groan * 0.5, 190, 1.0, 0.0)

# debris whooshes (4:00–5:00): Doppler-ish swept noise passing from one ear to the other
for t0 in np.sort(rng.uniform(242, 298, 38)):
    dur = rng.uniform(0.7, 2.0); n = int(dur * SR); tt = np.arange(n) / SR
    base = bp(noise(n), 300, 5000)
    sw = base * np.sin(np.pi * tt / dur) ** 2
    pan = np.linspace(-0.9, 0.9, n) * rng.choice([-1, 1])
    a = (pan + 1) * np.pi / 4
    i0 = int(t0 * SR); m = min(n, N - i0)
    g = rng.uniform(.15, .5)
    sfx[i0:i0 + m, 0] += sw[:m] * np.cos(a[:m]) * g; sfx[i0:i0 + m, 1] += sw[:m] * np.sin(a[:m]) * g

# riser into the impact (300–329.8): rising tone + noise, then the air is sucked out
rn = int(29.8 * SR); rt = np.arange(rn) / SR
rise = np.sin(2 * np.pi * np.cumsum(80 + 900 * (rt / 29.8) ** 3) / SR) * (rt / 29.8) ** 2.2 * 0.5
rise += hp(noise(rn), 1500) * (rt / 29.8) ** 4 * 0.25
place(sfx, rise, 300, 0.8, 0.0)

# ------------------------------------------------------------------ IMPACT
bn = int(14 * SR); bt = np.arange(bn) / SR
boom = np.sin(2 * np.pi * np.cumsum(46 * np.exp(-bt * 0.28) + 16) / SR) * np.exp(-bt * 0.33)
boom += 0.6 * np.sin(2 * np.pi * np.cumsum(92 * np.exp(-bt * 0.5) + 30) / SR) * np.exp(-bt * 0.6)
blast = lp(noise(bn), 3500, 2) * np.exp(-bt * 1.1) + lp(noise(bn), 400, 2) * np.exp(-bt * 0.5) * 1.5
ring = np.sin(2 * np.pi * 3150 * bt) * np.exp(-bt * 0.38) * 0.06 * (bt > 0.15)
imp = boom * 1.1 + blast * 0.85 + ring
imp *= np.minimum(1, bt / 0.012)
place(sfx, imp, IMPACT - 0.02, 1.0, 0.0)
# secondary shock waves racing round the planet
for k, dt in enumerate([4.5, 9.0, 15.0, 23.0]):
    n = int(5 * SR); tt = np.arange(n) / SR
    s = lp(noise(n), 220, 2) * np.exp(-tt * 0.9) * 2.0 + np.sin(2 * np.pi * 34 * tt) * np.exp(-tt * 0.8)
    place(sfx, s, IMPACT + dt, 0.55 / (k + 1) ** 0.5, (-1) ** k * 0.4)

# ------------------------------------------------------------------ aftermath
# roaring ash wind + lava crackle
wind = bp(noise(N), 80, 700) * 4
we = env_points([(329, 0), (332, 0.45), (360, 0.5), (420, 0.3), (470, 0.1), (480, 0)])
sfx[:, 0] += wind * we * 0.5; sfx[:, 1] += np.roll(wind, 1301) * we * 0.5
for t0 in np.sort(rng.uniform(340, 440, 900)):
    n = int(rng.uniform(.004, .05) * SR); tt = np.arange(n) / SR
    c = hp(noise(n), rng.uniform(800, 4000)) * np.exp(-tt * rng.uniform(80, 400))
    place(sfx, c, t0, rng.uniform(.05, .35) * (1 - (t0 - 340) / 160), rng.uniform(-1, 1))

# ------------------------------------------------------------------ closing bell motif (7:20 →)
def bell(f, dur=7.0):
    n = int(dur * SR); tt = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * 3.5 * tt) * 2.2 * np.exp(-tt * 1.4)
    s = np.sin(2 * np.pi * f * tt + mod) * np.exp(-tt * 0.55)
    s += 0.35 * np.sin(2 * np.pi * f * 2.0 * tt) * np.exp(-tt * 0.9)
    return s * np.minimum(1, tt / 0.004)
motif = [(442, A4), (447, E5), (452, C5), (457, E4), (461, A4 * 0.5), (466, E5)]
for (t0, f) in motif:
    place(sfx, bell(f), t0, 0.28, rng.uniform(-.3, .3))
place(sfx, bell(A4 * 0.25, 14), 470, 0.3, 0.0)

# ------------------------------------------------------------------ simple stereo reverb (synthetic IR)
def reverb(x, rt=3.8, wet=0.28):
    n = int(rt * SR); tt = np.arange(n) / SR
    out = np.zeros_like(x)
    for c in range(2):
        ir = noise(n) * np.exp(-tt * (6.9 / rt)); ir = lp(ir, 5000, 1); ir[0] = 0
        out[:, c] = signal.oaconvolve(x[:, c], ir * 0.012, mode="full")[:len(x)]
    return x * (1 - wet) + out * wet * 2.2

mix = reverb(music, 4.5, 0.38) * 1.0 + reverb(sfx, 2.2, 0.16)
# pre-impact "air sucked out": a deliberate dip, then silence-before-the-boom
duck = env_points([(0, 1), (328.2, 1), (329.5, 0.12), (329.97, 0.0), (330.0, 1), (480, 1)])
mix[:, 0] = np.where((T > 328.2) & (T < 330.0), mix[:, 0] * duck, mix[:, 0])
mix[:, 1] = np.where((T > 328.2) & (T < 330.0), mix[:, 1] * duck, mix[:, 1])
# fade in/out
mix *= np.minimum(1, T / 2.0)[:, None] * np.minimum(1, (DUR - T) / 3.0)[:, None]
# loudness: soft-clip, then peak-normalise to -1.5 dBFS
mix = np.tanh(mix * 1.1)
mix /= np.max(np.abs(mix)) / 0.84
pcm = (mix * 32767).astype("<i2")
import wave
wav = os.path.join(OUT, "soundtrack.wav")
with wave.open(wav, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", wav, f"{DUR:.0f}s")
try:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "aac", "-b:a", "224k", os.path.join(OUT, "soundtrack.m4a")], check=True)
    print("wrote", os.path.join(OUT, "soundtrack.m4a"))
except Exception as e:
    print("ffmpeg not available, skipped m4a:", e)
