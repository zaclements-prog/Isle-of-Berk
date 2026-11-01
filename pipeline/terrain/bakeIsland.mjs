// Bakes the island (after Berk): shape → erosion → masks → splat → placements (trees, boulders, houses, the Great
// Hall, docks) → public/assets/world/island/. Deterministic from ISLE.seed. Usage: node pipeline/terrain/bakeIsland.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ISLE, isleHeight, erosionMask, samplePos, inland, ledgeFrame, plateauMask, plateauHeight, sunDirection, harbourField, villageMask,
  pathField, ringRim, coveRim, pondLevel, terraceMask,
} from './islandShape.mjs';
import { erode } from './erosion.mjs';
import { LAYERS, slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, quantizeWeights } from './masks.mjs';
import { fbm2 } from './noise.mjs';
import { mulberry32 } from './rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'world', 'island');
const PREVIEW = join(ROOT, 'docs', 'progress', 'img', 'island', 'terrain-preview.png');
const { size, spacing, origin } = ISLE.grid;
const D = Math.PI / 180;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Layer weights for one cell (grass, forest, moss, mud, pebbles, rock) and its wetness. */
export function isleSplat(c) {
  const rock = Math.max(smoothstep(32, 46, c.slope), c.riser * 0.9, c.stack * smoothstep(12, 30, c.slope), c.ringWall * smoothstep(20, 40, c.slope));
  const seabed = smoothstep(-0.2, -2.5, c.height);
  const shore = smoothstep(2.2, 0.4, c.height) * smoothstep(-3, 0, c.height);
  // village ground: beaten earth on the path, worn stone and earth on the terraces, sand on the Kill Ring's floor
  const pebbles = Math.max(seabed * 0.6, shore * 0.8, c.village * 0.2, c.ringFloor * 0.9) * (1 - rock);
  const mud = Math.max(c.wetness * 0.55, seabed * 0.4, c.path * 0.85, c.village * 0.08, c.pondBed) * (1 - rock);
  const moss = (smoothstep(0, 0.35, c.curvature) * 0.4 + (1 - c.ao) * 0.6) * smoothstep(6, 16, c.slope)
    * (1 - smoothstep(36, 50, c.slope)) * (0.6 + 0.8 * c.noise) * (1 - c.village);
  const forest = smoothstep(14, 30, c.height) * (1 - smoothstep(120, 150, c.height)) * smoothstep(0.42, 0.58, c.patch)
    * (1 - rock) * (1 - c.village) * (1 - c.plateau) * (1 - c.ringFloor);
  const grass = Math.max(0, (1 - rock) * (1 - seabed) * (0.95 - 0.35 * c.noise) - moss * 0.5 - mud * 0.6 - forest * 0.8 - pebbles * 0.7);
  const wet = Math.max(c.wetness * 0.7, shore * 0.8, c.pondBed);
  return { weights: [grass, forest, moss, mud, pebbles, rock], wet, forest, rock };
}

/** Houses along a terrace, each side of the path through its middle, facing down toward the harbour. */
function terraceHouses(rnd) {
  const out = [];
  ISLE.terraces.forEach((t, k) => {
    const yaw = t.yaw * D;
    const ux = Math.cos(yaw);
    const uz = Math.sin(yaw);
    const vx = -Math.sin(yaw);
    const vz = Math.cos(yaw);
    for (const [side, back0] of [[-1, -0.35], [1, -0.35], [-1, 0.4], [1, 0.4]]) {
      for (let u = 9 + rnd() * 4; u < t.rx - 5; u += 10 + rnd() * 4) {
        const back = t.rz * back0 + (rnd() - 0.5) * 2.5;
        const x = t.x + ux * u * side + vx * back;
        const z = t.z + uz * u * side + vz * back;
        if (pathField(x, z).d < 7.5) continue;                         // the path through the village stays open
        out.push({ x: +x.toFixed(2), z: +z.toFixed(2), y: t.height, yaw: +(yaw + Math.PI / 2 + (rnd() - 0.5) * 0.25).toFixed(3),
          len: +(8 + rnd() * 4).toFixed(2), wid: +(5.5 + rnd() * 1.5).toFixed(2), terrace: k });
      }
    }
  });
  return out;
}

/** Piers from the shelf at the harbour's head out over the water. */
function docks() {
  const H = ISLE.harbour;
  const out = [];
  const a = H.mouthAzimuth * D;
  const r = 400;
  const mx = Math.sin(a) * r;
  const mz = -Math.cos(a) * r;
  const dir = Math.atan2(mx - H.inner.x, mz - H.inner.z);
  for (const off of [-0.55, 0, 0.55]) {
    const ang = dir + off;
    const start = H.innerWidth + 2;
    out.push({ x: +(H.inner.x + Math.sin(ang) * start).toFixed(2), z: +(H.inner.z + Math.cos(ang) * start).toFixed(2), yaw: +ang.toFixed(3), len: 20, width: 3.4, deck: H.shelf + 0.6 });
  }
  return out;
}

export function bakeIsle() {
  const h = new Float32Array(size * size);
  const mask = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [x, z] = samplePos(i, j);
      h[j * size + i] = isleHeight(x, z);
      mask[j * size + i] = erosionMask(x, z);
    }
  }
  const designed = h.slice();
  const flow = erode(h, size, mask, { seed: ISLE.seed + 11, droplets: 180000 });
  let change = 0;
  for (let k = 0; k < h.length; k++) change += Math.abs(h[k] - designed[k]);
  const slope = slopeField(h, size, spacing);
  const curv = curvatureField(h, size, spacing);
  const ao = horizonAO(h, size, spacing);
  const wetF = wetnessFromFlow(flow, size);
  const vis = sunVisibility(h, size, spacing, sunDirection(ISLE.sunAzimuth, ISLE.sunElevation), 360);
  const splatA = Buffer.alloc(size * size * 4);
  const splatB = Buffer.alloc(size * size * 4);
  const forestW = new Float32Array(size * size);
  const rockW = new Float32Array(size * size);
  const villW = new Float32Array(size * size);
  const L = ISLE.ledges;
  const R = ISLE.killRing;
  const C = ISLE.cove;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const [x, z] = samplePos(i, j);
      const f = ledgeFrame(x, z);
      const onLedge = f.lateral < L.halfWidth + L.blend && f.along > -1 && f.along < L.steps * L.tread + L.summit + L.blend ? 1 : 0;
      const inTread = ((f.along % L.tread) + L.tread) % L.tread;
      const riser = onLedge && f.lateral < L.halfWidth + 0.5 && f.along < L.steps * L.tread && inTread > L.tread - 0.6 ? 1 : 0;
      let stack = 0;
      for (const s of ISLE.stacks) if (Math.hypot(x - s.x, z - s.z) < s.r + 3) stack = 1;
      const dr = Math.hypot(x - R.x, z - R.z);
      const v = villageMask(x, z);
      const c = isleSplat({
        slope: slope[k], height: h[k], curvature: curv[k], ao: ao[k], wetness: wetF[k], noise: fbm2(x / 9, z / 9, ISLE.seed + 99, 4),
        patch: fbm2(x / 80, z / 80, ISLE.seed + 21, 4) + 0.12 * fbm2(x / 15, z / 15, ISLE.seed + 22, 3),
        plateau: plateauMask(x, z), riser, stack, village: v, path: smoothstep(ISLE.path.width * 0.8, ISLE.path.width * 0.3, pathField(x, z).d),
        ringFloor: dr < R.r - 1 ? 1 : 0, ringWall: dr < R.r + R.wall + 2 ? 1 : 0,
        pondBed: Math.hypot(x - C.pond.x, z - C.pond.z) < C.pond.r + 1 ? 1 : 0,
      });
      forestW[k] = c.forest;
      rockW[k] = c.rock;
      villW[k] = v;
      const q = quantizeWeights(c.weights);
      for (let m = 0; m < 4; m++) splatA[k * 4 + m] = q[m];
      splatB[k * 4] = q[4];
      splatB[k * 4 + 1] = q[5];
      splatB[k * 4 + 2] = Math.round(Math.min(1, c.wet) * 255);
      splatB[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao[k])) * 255);
    }
  }
  const rnd = mulberry32(ISLE.seed + 31);
  const at = (x, z) => {
    const fi = Math.round((x - origin) / spacing);
    const fj = Math.round((z - origin) / spacing);
    return fi < 1 || fj < 1 || fi >= size - 1 || fj >= size - 1 ? -1 : fj * size + fi;
  };
  // keep-outs: the village (with a margin), the Kill Ring, the Cove's pond, the tor, the docks' shelf
  const clear = (x, z, k, margin) => {
    if (villW[k] > 0.02) return false;
    for (let dx = -margin; dx <= margin; dx += margin) for (let dz = -margin; dz <= margin; dz += margin) {
      const kk = at(x + dx, z + dz);
      if (kk >= 0 && villW[kk] > 0.02) return false;
    }
    if (Math.hypot(x - R.x, z - R.z) < R.r + R.wall + 4) return false;
    if (Math.hypot(x - C.pond.x, z - C.pond.z) < C.pond.r + 3) return false;
    const f = ledgeFrame(x, z);
    if (f.lateral < L.halfWidth + L.blend + 3 && f.along > -6 && f.along < L.steps * L.tread + L.summit + L.blend + 3) return false;
    return true;
  };
  const trees = [];
  for (let n = 0; n < 140000 && trees.length < 4200; n++) {
    const x = origin + rnd() * (size - 1) * spacing;
    const z = origin + rnd() * (size - 1) * spacing;
    const k = at(x, z);
    if (k < 0 || h[k] < 4 || slope[k] > 34 || !clear(x, z, k, 8)) continue;
    const p = forestW[k] * 0.9 + (plateauMask(x, z) > 0.5 ? 0.002 : 0.012);
    if (rnd() > p) continue;
    trees.push([+x.toFixed(2), +h[k].toFixed(2), +z.toFixed(2), +(0.8 + rnd() * 0.7).toFixed(2), Math.floor(rnd() * 3), +(rnd() * 6.283).toFixed(3)]);
  }
  const rocks = [];
  for (let n = 0; n < 60000 && rocks.length < 420; n++) {
    const x = origin + rnd() * (size - 1) * spacing;
    const z = origin + rnd() * (size - 1) * spacing;
    const k = at(x, z);
    if (k < 0 || h[k] < -0.8 || !clear(x, z, k, 3)) continue;
    const p = rockW[k] * 0.05 + smoothstep(18, 32, slope[k]) * 0.05 + (h[k] < 2.5 ? 0.05 : 0);
    if (rnd() > p) continue;
    rocks.push([+x.toFixed(2), +h[k].toFixed(2), +z.toFixed(2), +(0.9 + rnd() ** 2 * 3.2).toFixed(2), Math.floor(rnd() * 4), +(rnd() * 6.283).toFixed(3)]);
  }
  const houses = terraceHouses(mulberry32(ISLE.seed + 41));
  let hmin = Infinity;
  let hmax = -Infinity;
  for (const v of h) {
    hmin = Math.min(hmin, v);
    hmax = Math.max(hmax, v);
  }
  // spawn: on the path just below the Great Hall's door, looking down over the village to the harbour
  const hl = ISLE.hall;
  const t4 = ISLE.terraces[ISLE.terraces.length - 1];
  const len = Math.hypot(t4.x - hl.x, t4.z - hl.z);
  const sx = hl.x + ((t4.x - hl.x) / len) * 24;
  const sz = hl.z + ((t4.z - hl.z) / len) * 24;
  const spawn = [{ x: +sx.toFixed(2), z: +sz.toFixed(2), heading: +Math.atan2(ISLE.harbour.inner.x - sx, ISLE.harbour.inner.z - sz).toFixed(4) }];
  return {
    h, splatA, splatB, ao, vis, trees, rocks, houses, docks: docks(), spawn,
    stats: { heightMin: +hmin.toFixed(3), heightMax: +hmax.toFixed(3), erosionMeanChange: +(change / h.length).toFixed(5) },
  };
}

async function main() {
  const t0 = performance.now();
  const b = bakeIsle();
  const { h } = b;
  const toU16 = new Uint16Array(size * size);
  const range = ISLE.heightRange.max - ISLE.heightRange.min;
  for (let k = 0; k < h.length; k++) {
    if (h[k] < ISLE.heightRange.min || h[k] > ISLE.heightRange.max) throw new Error(`height ${h[k]} outside the 16-bit range`);
    toU16[k] = Math.round(((h[k] - ISLE.heightRange.min) / range) * 65535);
  }
  const le = Buffer.alloc(size * size * 2);
  for (let k = 0; k < toU16.length; k++) le.writeUInt16LE(toU16[k], k * 2);
  await mkdir(OUT, { recursive: true });
  await mkdir(dirname(PREVIEW), { recursive: true });
  await writeFile(join(OUT, 'height.bin'), le);
  await sharp(b.splatA, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatA.png'));
  await sharp(b.splatB, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatB.png'));
  const header = {
    version: 2, size, spacing, origin, heightMin: ISLE.heightRange.min, heightMax: ISLE.heightRange.max,
    waterLevel: ISLE.seaLevel, seaLevel: ISLE.seaLevel, seed: ISLE.seed,
    sun: { azimuth: ISLE.sunAzimuth, elevation: ISLE.sunElevation },
    hall: ISLE.hall, terraces: ISLE.terraces, harbour: { inner: ISLE.harbour.inner, shelf: ISLE.harbour.shelf, mouthAzimuth: ISLE.harbour.mouthAzimuth },
    killRing: { ...ISLE.killRing, rim: ringRim() },
    cove: { x: ISLE.cove.x, z: ISLE.cove.z, r: ISLE.cove.r, rim: coveRim(), pond: { ...ISLE.cove.pond, level: +pondLevel().toFixed(2) } },
    plateau: { ...ISLE.plateau, height: plateauHeight() },
    meadow: { x: ISLE.plateau.x, z: ISLE.plateau.z, rx: ISLE.plateau.rx, rz: ISLE.plateau.rz, height: plateauHeight() },
    ledges: ISLE.ledges, stacks: ISLE.stacks,
    spawn: b.spawn, layers: LAYERS,
    files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' },
    /** [x, y, z, scale, variant, yaw] */
    trees: b.trees,
    rocks: b.rocks,
    houses: b.houses,
    docks: b.docks,
    stats: { ...b.stats, trees: b.trees.length, rocks: b.rocks.length, houses: b.houses.length },
  };
  await writeFile(join(OUT, 'terrain.json'), JSON.stringify(header) + '\n');
  // preview: splat colours × hillshade × sun, sea in blue, houses red (top = north)
  const colours = [[96, 128, 60], [52, 72, 40], [60, 100, 50], [110, 85, 60], [150, 140, 125], [128, 124, 118]];
  const img = Buffer.alloc(size * size * 3);
  const Ld = [-0.6, 0.5, -0.4];
  const Ll = Math.hypot(...Ld);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const gx = (h[j * size + Math.min(size - 1, i + 1)] - h[j * size + Math.max(0, i - 1)]) / (2 * spacing);
      const gz = (h[Math.min(size - 1, j + 1) * size + i] - h[Math.max(0, j - 1) * size + i]) / (2 * spacing);
      const nl = Math.hypot(gx, 1, gz);
      const lam = Math.max(0, (-gx * Ld[0] + Ld[1] - gz * Ld[2]) / (nl * Ll));
      const w = [b.splatA[k * 4], b.splatA[k * 4 + 1], b.splatA[k * 4 + 2], b.splatA[k * 4 + 3], b.splatB[k * 4], b.splatB[k * 4 + 1]];
      const s = (0.35 + 0.65 * lam) * (b.vis[k] ? 1 : 0.55) * (0.6 + 0.4 * b.ao[k]) * 1.6 / 255;
      const [x, z] = samplePos(i, j);
      const pond = Math.hypot(x - ISLE.cove.pond.x, z - ISLE.cove.pond.z) < ISLE.cove.pond.r + 2 && h[k] < pondLevel();
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let m = 0; m < 6; m++) v += colours[m][c] * w[m];
        const sea = [20 + 25 * Math.max(0, 1 + h[k] / 6), 60 + 40 * Math.max(0, 1 + h[k] / 6), 85 + 40 * Math.max(0, 1 + h[k] / 6)][c];
        img[k * 3 + c] = h[k] < ISLE.seaLevel || pond ? Math.min(255, Math.round(sea)) : Math.min(255, Math.round(v * s));
      }
    }
  }
  const dot = (x, z, rgb, r = 1) => {
    const i = Math.round((x - origin) / spacing);
    const j = Math.round((z - origin) / spacing);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const k = (j + dj) * size + (i + di);
      if (k >= 0 && k < size * size) { img[k * 3] = rgb[0]; img[k * 3 + 1] = rgb[1]; img[k * 3 + 2] = rgb[2]; }
    }
  };
  for (const t of b.trees) dot(t[0], t[2], [30, 52, 30]);
  for (const hs of b.houses) dot(hs.x, hs.z, [150, 70, 40], 3);
  dot(ISLE.hall.x, ISLE.hall.z, [170, 60, 30], 8);
  for (const d of b.docks) dot(d.x, d.z, [120, 90, 50], 2);
  await sharp(img, { raw: { width: size, height: size, channels: 3 } }).png().toFile(PREVIEW);
  console.log(`island baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`, header.stats, 'spawn', b.spawn[0]);
  void terraceMask;
  void inland;
  void harbourField;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
