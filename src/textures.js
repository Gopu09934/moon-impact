import * as THREE from 'three';

const FILES = {
  day: ['earth_day.jpg', true], night: ['earth_night.jpg', true], spec: ['earth_spec.jpg', false], normal: ['earth_normal.jpg', false],
  clouds: ['earth_clouds.jpg', false], lava: ['earth_lava.jpg', true], crust: ['earth_crust.jpg', true],
  moonAlbedo: ['moon_albedo.jpg', true], moonNormal: ['moon_normal.png', false], milkyway: ['milkyway.jpg', true],
};

export async function loadTextures(renderer, base = './assets/baked/', onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const out = {}; let done = 0;
  await Promise.all(Object.entries(FILES).map(([key, [file, srgb]]) => new Promise((res, rej) => {
    loader.load(base + file, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(8, maxAniso);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      out[key] = t; onProgress(++done / Object.keys(FILES).length); res();
    }, undefined, () => rej(new Error('missing texture ' + base + file + ' — run: npm run textures')));
  })));
  return out;
}
