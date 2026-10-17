#!/usr/bin/env python3
"""
Texture baker for "What If the Moon Hit Earth?"

Takes the equirectangular source maps in assets/source (real NASA-derived
continent / lunar-albedo data) and bakes high-resolution, film-ready maps:

  earth_day.jpg      sharpened + detail-enhanced day side
  earth_night.jpg    city lights with glow
  earth_clouds.jpg   procedural cloud coverage (grayscale alpha)
  earth_spec.jpg     ocean mask (roughness / glint)
  earth_normal.jpg   topography normal map
  earth_lava.jpg     emissive magma network (aftermath)
  earth_crust.jpg    cooled-crust albedo (aftermath)
  moon_albedo.jpg    albedo + stamped crater ejecta / rays
  moon_normal.png    crater normal map (true crater size distribution)
  milkyway.jpg       soft Milky Way band (stars are drawn as 3D points)

Usage:  python3 tools/bake_textures.py --res 4096      (4K, default)
        python3 tools/bake_textures.py --res 8192      (8K, needs ~6 GB RAM)

Drop your own files into assets/source with the same names to override the
inputs (e.g. NASA Blue Marble as earth_atmos_2048.jpg at any resolution).
"""
import argparse, math, os, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ap = argparse.ArgumentParser()
ap.add_argument("--res", type=int, default=4096, help="texture width (height = width/2)")
ap.add_argument("--src", default="assets/source")
ap.add_argument("--out", default="assets/baked")
ap.add_argument("--only", default="", help="comma list: earth,night,clouds,lava,moon,sky")
ap.add_argument("--quality", type=int, default=95)
args = ap.parse_args()

W = args.res
H = W // 2
SRC, OUT = args.src, args.out
os.makedirs(OUT, exist_ok=True)
only = set(s for s in args.only.split(",") if s)
want = lambda k: (not only) or (k in only)
T0 = time.time()
def log(*a): print(f"[{time.time()-T0:6.1f}s]", *a, flush=True)

# --------------------------------------------------------------------------
# Noise on the unit sphere (seamless in longitude, no pole pinching)
# --------------------------------------------------------------------------
TABLE = np.random.default_rng(1337).random(1 << 20, dtype=np.float32)

def _h(ix, iy, iz):
    return TABLE[((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & 0xFFFFF]

def vnoise(x, y, z):
    ix = np.floor(x); iy = np.floor(y); iz = np.floor(z)
    fx = (x - ix).astype(np.float32); fy = (y - iy).astype(np.float32); fz = (z - iz).astype(np.float32)
    ix = ix.astype(np.int64); iy = iy.astype(np.int64); iz = iz.astype(np.int64)
    ux = fx * fx * (3 - 2 * fx); uy = fy * fy * (3 - 2 * fy); uz = fz * fz * (3 - 2 * fz)
    c000 = _h(ix, iy, iz);         c100 = _h(ix + 1, iy, iz)
    c010 = _h(ix, iy + 1, iz);     c110 = _h(ix + 1, iy + 1, iz)
    c001 = _h(ix, iy, iz + 1);     c101 = _h(ix + 1, iy, iz + 1)
    c011 = _h(ix, iy + 1, iz + 1); c111 = _h(ix + 1, iy + 1, iz + 1)
    x00 = c000 + (c100 - c000) * ux; x10 = c010 + (c110 - c010) * ux
    x01 = c001 + (c101 - c001) * ux; x11 = c011 + (c111 - c011) * ux
    y0 = x00 + (x10 - x00) * uy;     y1 = x01 + (x11 - x01) * uy
    return y0 + (y1 - y0) * uz

def fbm(p, freq, octaves, gain=0.5, lac=2.03, seed=0.0):
    x, y, z = p
    s = np.zeros_like(x, dtype=np.float32); a = 1.0; tot = 0.0; f = freq
    for i in range(octaves):
        o = 17.31 * (i + 1) + seed
        s += a * vnoise(x * f + o, y * f - o * 0.7, z * f + o * 1.3)
        tot += a; a *= gain; f *= lac
    return s / tot

def sphere_dirs(r0, r1):
    rows = np.arange(r0, r1, dtype=np.float32)
    cols = np.arange(W, dtype=np.float32)
    lat = (0.5 - (rows + 0.5) / H) * math.pi
    lon = ((cols + 0.5) / W - 0.5) * 2 * math.pi
    LAT, LON = np.meshgrid(lat, lon, indexing="ij")
    c = np.cos(LAT)
    return (c * np.cos(LON)).astype(np.float32), np.sin(LAT).astype(np.float32), (c * np.sin(LON)).astype(np.float32), LAT

def chunked(fn, channels=1, rows=128):
    out = np.zeros((H, W) if channels == 1 else (H, W, channels), np.float32)
    for r0 in range(0, H, rows):
        r1 = min(H, r0 + rows)
        out[r0:r1] = fn(r0, r1)
    return out

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def load(name, mode="RGB"):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        sys.exit(f"missing source texture {path} - run tools/fetch_textures.sh")
    return Image.open(path).convert(mode)

def up(img, mode=Image.LANCZOS):
    return np.asarray(img.resize((W, H), mode), dtype=np.float32) / 255.0

def save_jpg(arr, name):
    a = np.clip(arr, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name), quality=args.quality, subsampling=0, optimize=True)
    log("wrote", name)

def save_png(arr, name):
    a = np.clip(arr, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name), optimize=True)
    log("wrote", name)

def unsharp(a, sigma, amount):
    blur = np.stack([ndi.gaussian_filter(a[..., c], sigma, mode=("nearest", "wrap")) for c in range(a.shape[2])], -1)
    return a + (a - blur) * amount

DET = W / 4096.0  # detail frequency scale so 8K gets genuinely finer detail

# --------------------------------------------------------------------------
# EARTH
# --------------------------------------------------------------------------
if want("earth"):
    log("earth day / specular / normal")
    day = up(load("earth_atmos_2048.jpg"))
    spec = up(load("earth_specular_2048.jpg"), Image.BICUBIC)[..., 0]
    ocean = np.clip(spec * 1.6, 0, 1)                      # 1 = ocean
    ocean = ndi.gaussian_filter(ocean, 0.8, mode=("nearest", "wrap"))
    land = 1 - ocean

    def detail(r0, r1):
        p = sphere_dirs(r0, r1)[:3]
        d1 = fbm(p, 55, 5, seed=3) - 0.5
        d2 = fbm(p, 240 * DET, 4, seed=9) - 0.5
        d3 = fbm(p, 900 * DET, 2, seed=21) - 0.5
        return np.stack([d1, d2, d3], -1)
    D = chunked(detail, 3)
    lum = day.mean(-1, keepdims=True)
    # land: rock / vegetation micro-texture, stronger on bright terrain (deserts, snow, mountains)
    amp = land[..., None] * (0.55 + 0.9 * lum)
    day = day * (1 + amp * (0.55 * D[..., 0:1] + 0.45 * D[..., 1:2] + 0.25 * D[..., 2:3]))
    # ocean: depth variation + slightly lifted blue so it reads on a dark film grade
    ocean_tint = np.array([0.020, 0.075, 0.165], np.float32)
    odepth = 0.85 + 0.30 * (D[..., 0:1] * 1.2 + 0.5)
    day = day * (1 - 0.35 * ocean[..., None]) + ocean[..., None] * (ocean_tint * odepth + day * 0.55)
    day = unsharp(day, 1.2 * DET, 0.55)
    # cinematic grade: lift saturation slightly
    g = day.mean(-1, keepdims=True)
    day = np.clip(g + (day - g) * 1.18, 0, 1)
    save_jpg(day, "earth_day.jpg")
    # R = ocean mask, G = distance inland from the nearest coast (0..1500 km) used by the flood shader
    dist_px = ndi.distance_transform_edt(ocean < 0.5)
    coast = np.clip(dist_px * (40075.0 / W) / 1500.0, 0, 1)
    save_jpg(np.stack([ocean, coast, ocean * 0 + 0.5], -1), "earth_spec.jpg")

    nrm = up(load("earth_normal_2048.jpg"), Image.BICUBIC)
    # add land micro relief to the normal map
    nrm[..., 0] += land * (D[..., 1] * 0.35 + D[..., 2] * 0.18)
    nrm[..., 1] += land * (D[..., 2] * 0.35 + D[..., 1] * 0.18)
    save_jpg(nrm, "earth_normal.jpg")
    del day, D, nrm, amp

if want("night"):
    log("earth night lights")
    n = up(load("earth_lights_2048.png"))
    n = np.clip((n - 0.07) / 0.93, 0, 1) ** 1.15      # kill the faint purple base level, keep real lights
    # keep only the real lights; add atmospheric glow and warm sodium tint
    core = unsharp(n, 0.7 * DET, 0.9)
    glow = np.stack([ndi.gaussian_filter(n[..., c], 2.2 * DET, mode=("nearest", "wrap")) for c in range(3)], -1)
    glow2 = np.stack([ndi.gaussian_filter(n[..., c], 7.0 * DET, mode=("nearest", "wrap")) for c in range(3)], -1)
    out = core * 1.15 + glow * 1.1 + glow2 * 0.9
    sp = chunked(lambda a, b: fbm(sphere_dirs(a, b)[:3], 700 * DET, 2, seed=5)[..., None] * np.ones(3, np.float32), 3)
    out = out * (0.7 + 0.8 * sp)
    out *= np.array([1.0, 0.82, 0.55], np.float32) * 0.5 + np.array([0.5, 0.5, 0.5], np.float32) * 0
    out = out * 1.9
    save_jpg(out, "earth_night.jpg")
    del n, out, sp

if want("clouds"):
    log("earth clouds")
    def clouds(r0, r1):
        x, y, z, lat = sphere_dirs(r0, r1)
        p = (x, y, z)
        wx = fbm(p, 1.7, 4, seed=40) - 0.5
        wy = fbm(p, 1.7, 4, seed=50) - 0.5
        wz = fbm(p, 1.7, 4, seed=60) - 0.5
        q = (x + wx * 1.1, y + wy * 1.1, z + wz * 1.1)
        base = fbm(q, 3.1, 8, gain=0.52, seed=7)
        # banding: ITCZ, mid-latitude storm tracks, clearer subtropics
        band = 0.10 * np.cos(lat * 6.0 + 0.4) + 0.07 * np.cos(lat * 12.0) - 0.06 * np.exp(-((np.abs(lat) - 0.45) / 0.18) ** 2)
        cov = base + band
        c = smoothstep(0.455, 0.72, cov)
        wisps = smoothstep(0.58, 0.8, fbm(q, 14 * DET, 5, seed=11)) * 0.35
        c = np.clip(c + wisps * (1 - c) * 0.8, 0, 1)
        return c
    C = chunked(clouds, 1)
    save_jpg(np.repeat(C[..., None], 3, -1), "earth_clouds.jpg")
    del C

if want("lava"):
    log("earth lava / crust")
    def lava(r0, r1):
        x, y, z, lat = sphere_dirs(r0, r1)
        p = (x, y, z)
        wx = (fbm(p, 2.2, 4, seed=71) - 0.5) * 0.9
        wy = (fbm(p, 2.2, 4, seed=72) - 0.5) * 0.9
        wz = (fbm(p, 2.2, 4, seed=73) - 0.5) * 0.9
        q = (x + wx, y + wy, z + wz)
        n1 = fbm(q, 5.0, 6, seed=3)
        ridge = 1 - np.abs(2 * n1 - 1)
        n2 = fbm(q, 17 * DET, 5, seed=8)
        ridge2 = 1 - np.abs(2 * n2 - 1)
        crack = np.maximum(smoothstep(0.90, 0.99, ridge), 0.55 * smoothstep(0.93, 0.995, ridge2))
        melt = smoothstep(0.60, 0.68, fbm(p, 1.9, 4, seed=90))
        turb = fbm(p, 24 * DET, 5, seed=15)
        heat = np.clip(crack * (0.7 + 0.6 * turb) + melt * (0.30 + 0.6 * turb), 0, 1.25)
        # blackbody-ish ramp
        h = heat[..., None]
        r = np.clip(h * 2.4, 0, 1.4)
        g = np.clip((h - 0.35) * 1.9, 0, 1.0) ** 1.3
        b = np.clip((h - 0.85) * 2.2, 0, 1.0)
        e = np.concatenate([r, g * 0.8, b * 0.5], -1)
        # crust albedo: charcoal basalt with faint relief
        cr = 0.035 + 0.09 * fbm(p, 36 * DET, 6, seed=33)[..., None]
        cr = cr * np.array([1.0, 0.9, 0.82], np.float32)
        return np.concatenate([e, cr], -1)
    L = chunked(lava, 6)
    save_jpg(L[..., 0:3] / 1.4, "earth_lava.jpg")     # shader multiplies by 1.4
    save_jpg(L[..., 3:6] * 2.0, "earth_crust.jpg")
    del L

# --------------------------------------------------------------------------
# MOON
# --------------------------------------------------------------------------
if want("moon"):
    log("moon craters")
    rng = np.random.default_rng(2026)
    height = np.zeros((H, W), np.float32)     # radians of surface relief (unit sphere)
    bright = np.zeros((H, W), np.float32)     # fresh-ejecta brightening
    px_ang = 2 * math.pi / W                  # radians per pixel at equator

    # crater population: cumulative N(>r) ~ r^-2 (typical lunar production slope)
    r_min_px = 2.6
    n_total = int(55000 * (W / 4096) ** 2)
    u = rng.random(n_total)
    r_px = r_min_px * (1 - u) ** (-1 / 2.0)
    r_px = np.minimum(r_px, 120 * (W / 4096))
    # a handful of big basins
    big = np.array([(0.30, 0.15, 340), (-0.55, 3.4, 300), (0.70, -2.3, 260), (-0.15, 1.2, 230), (0.2, -0.9, 200), (-0.8, -1.4, 220)])
    lats = np.arcsin(rng.uniform(-0.985, 0.985, n_total))   # uniform on sphere
    lons = rng.uniform(-math.pi, math.pi, n_total)
    craters = [(lats[i], lons[i], r_px[i] * px_ang) for i in range(n_total)]
    for la, lo, rp in big:
        craters.append((la, lo, rp * (W / 4096) * px_ang))
    craters.sort(key=lambda c: -c[2])          # large first, small overprint them
    fresh_flags = rng.random(len(craters)) < 0.06

    def stamp(i, lat0, lon0, rho):
        rpx = rho / px_ang
        if rpx < 1.2: return
        reach = 3.2 if rpx > 6 else 2.2
        halo = rho * reach
        row0 = (0.5 - lat0 / math.pi) * H
        dr = int(halo * H / math.pi) + 2
        cl = max(math.cos(lat0), 0.06)
        dc = int(min(halo / cl, math.pi) * W / (2 * math.pi)) + 2
        c0 = (lon0 / (2 * math.pi) + 0.5) * W
        ri = np.arange(max(0, int(row0) - dr), min(H, int(row0) + dr + 1))
        if len(ri) == 0: return
        ci = np.arange(int(c0) - dc, int(c0) + dc + 1)
        lat = (0.5 - (ri + 0.5) / H) * math.pi
        lon = ((ci + 0.5) / W - 0.5) * 2 * math.pi
        LA, LO = np.meshgrid(lat, lon, indexing="ij")
        # angular distance (haversine)
        a = np.sin((LA - lat0) / 2) ** 2 + np.cos(LA) * math.cos(lat0) * np.sin((LO - lon0) / 2) ** 2
        d = 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
        x = d / rho
        # depth/diameter ~0.2 for small simple craters, shallower for big complex ones
        depth = rho * (0.40 if rpx < 14 else (0.24 if rpx < 45 else 0.11))
        rim = depth * 0.30
        bowl = np.where(x < 1, -depth * (1 - x ** 2) ** (0.75 if rpx < 14 else 0.55), 0.0)
        if rpx >= 14:  # flat floor (terraces) for complex craters
            bowl = np.where(x < 0.85, np.minimum(bowl, -depth * 0.92) * 0 + (-depth * (0.92 + 0.08 * (x / 0.85) ** 2)), bowl)
        rimp = rim * np.exp(-(((x - 1.0) / 0.16) ** 2)) * (x >= 0.55)
        ej = np.where(x > 1, rim * 0.45 * np.maximum(x, 1.0) ** -3.0, 0.0)
        peak = 0.0
        if rpx >= 28:
            peak = depth * 0.55 * np.exp(-((x / 0.11) ** 2))
        h = bowl + rimp + ej + peak
        cols = np.mod(ci, W)
        r_a, r_b = ri[0], ri[-1] + 1
        height[r_a:r_b, cols] = height[r_a:r_b, cols] + h.astype(np.float32)
        if fresh_flags[i] and rpx > 3:
            ang = np.arctan2(LA - lat0, (LO - lon0) * np.cos(LA))
            rays = 0.55 + 0.45 * np.cos(ang * (9 + (i % 7)) + (i * 1.7)) ** 2
            b = (np.exp(-((np.maximum(x, 0.0) - 1.0) / 0.55) ** 2) * (x > 0.7) + np.where(x > 1, 1.6 * rays * np.maximum(x, 1.0) ** -1.5, 0)) * 0.55
            bright[ri[0]:ri[-1] + 1, cols] = np.maximum(bright[ri[0]:ri[-1] + 1, cols], b.astype(np.float32))

    for i, (la, lo, rho) in enumerate(craters):
        stamp(i, la, lo, rho)
        if i % 15000 == 0: log(f"  craters {i}/{len(craters)}")

    # regolith roughness + gentle undulation (highlands/maria relief)
    def rough(r0, r1):
        p = sphere_dirs(r0, r1)[:3]
        return (fbm(p, 6, 5, seed=2) - 0.5) * 0.0045 + (fbm(p, 80 * DET, 5, seed=4) - 0.5) * 0.00045 + (fbm(p, 420 * DET, 3, seed=6) - 0.5) * 0.00014
    height += chunked(rough, 1)

    # normal map (tangent space, OpenGL / +Y up)
    hp = np.pad(height, ((1, 1), (0, 0)), mode="edge")
    dh_n = (hp[0:-2] - hp[2:]) / 2.0            # toward north
    dh_e = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2.0
    lat_row = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    dx = (px_ang * np.maximum(np.cos(lat_row), 0.05))[:, None]
    dy = math.pi / H
    k = 1.35
    nx = -dh_e / dx * k; ny = -dh_n / dy * k
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1)
    N = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, inv * 0.5 + 0.5], -1)
    save_png(N, "moon_normal.png")

    # albedo: real lunar albedo guide upscaled + high-pass detail + fresh ejecta
    alb = up(load("moon_1024.jpg"))
    g = alb.mean(-1)
    g = g / max(g.mean(), 1e-3)
    g = np.clip(g, 0.05, 2.5) ** 1.55
    def mdet(r0, r1):
        p = sphere_dirs(r0, r1)[:3]
        return np.stack([fbm(p, 60 * DET, 5, seed=12), fbm(p, 380 * DET, 3, seed=14)], -1) - 0.5
    MD = chunked(mdet, 2)
    # crater-shaped shading proxy (cavity darkens, rims lighten) so detail agrees with the normal map
    cav = np.clip(height / 0.0035, -1, 1)
    base = (g * 0.55 + 0.10)[..., None] * (1 + 0.9 * MD[..., 0:1] + 0.5 * MD[..., 1:2] + 0.12 * cav[..., None])
    base = base * (1 + 0.9 * bright[..., None])
    mare = smoothstep(0.55, 0.9, 1.0 - g)[..., None]
    tint_hi = np.array([1.00, 0.965, 0.90], np.float32)
    tint_ma = np.array([0.86, 0.92, 1.05], np.float32)
    alb2 = base * (tint_hi * (1 - mare) + tint_ma * mare)
    save_jpg(alb2 * 0.52, "moon_albedo.jpg")
    del height, bright, N, MD, alb, alb2

# --------------------------------------------------------------------------
# SKY (soft Milky Way band; stars are 3D points in the scene)
# --------------------------------------------------------------------------
if want("sky"):
    log("milky way")
    SW, SH = 2048, 1024
    def mw():
        rows = np.arange(SH, dtype=np.float32); cols = np.arange(SW, dtype=np.float32)
        lat = (0.5 - (rows + 0.5) / SH) * math.pi
        lon = ((cols + 0.5) / SW - 0.5) * 2 * math.pi
        LAT, LON = np.meshgrid(lat, lon, indexing="ij")
        c = np.cos(LAT)
        p = ((c * np.cos(LON)).astype(np.float32), np.sin(LAT).astype(np.float32), (c * np.sin(LON)).astype(np.float32))
        n = np.array([0.32, 0.88, 0.34]); n /= np.linalg.norm(n)
        d = p[0] * n[0] + p[1] * n[1] + p[2] * n[2]
        core_dir = np.cross(n, [0, 0, 1.0]); core_dir /= np.linalg.norm(core_dir)
        cdot = p[0] * core_dir[0] + p[1] * core_dir[1] + p[2] * core_dir[2]
        band = np.exp(-(d / 0.20) ** 2) * 0.8 + np.exp(-(d / 0.07) ** 2) * 0.7
        gal = 0.55 + 0.45 * np.clip(cdot, 0, 1) ** 2
        cloud = fbm(p, 3.2, 7, seed=101)
        fine = fbm(p, 22, 5, seed=102)
        dust = smoothstep(0.52, 0.72, fbm((p[0] + 0.1 * cloud, p[1], p[2]), 6.5, 6, seed=103))
        val = band * gal * (0.35 + 1.0 * cloud) * (0.55 + 0.8 * fine) * (1 - 0.8 * dust * np.exp(-(d / 0.14) ** 2))
        warm = np.array([1.0, 0.82, 0.62], np.float32); cool = np.array([0.55, 0.70, 1.0], np.float32)
        col = (cool * (1 - np.clip(cdot, 0, 1)[..., None] ** 1.5) + warm * np.clip(cdot, 0, 1)[..., None] ** 1.5)
        out = val[..., None] * col * 0.42 + 0.004
        return out
    save_jpg(np.clip(mw(), 0, 1), "milkyway.jpg")

log("done ->", OUT)
