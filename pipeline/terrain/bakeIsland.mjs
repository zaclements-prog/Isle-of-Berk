// Bakes the Test Isle: shape → erosion → masks → splat → placements → public/assets/world/island/.
// Deterministic from ISLE.seed. Usage: node pipeline/terrain/bakeIsland.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ISLE, isleHeight, erosionMask, samplePos, inland, cliffMask, ledgeFrame, meadowMask, streamDist, sunDirection } from './islandShape.mjs';
import { erode } from './erosion.mjs';
import { LAYERS, slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, quantizeWeights } from './masks.mjs';
import { fbm2 } from './noise.mjs';
import { mulberry32 } from './rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'world', 'island');
const PREVIEW = join(ROOT, 'docs', 'progress', 'img', 'island', 'terrain-preview.png');
const { size, spacing, origin } = ISLE.grid;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Layer weights for one cell (grass, forest, moss, mud, pebbles, rock) and its wetness. */
export function isleSplat(c) {
  const rock = Math.max(smoothstep(30, 46, c.slope), c.riser * 0.9, c.stack * smoothstep(12, 30, c.slope));
  const beach = smoothstep(ISLE.beach.top + 1.2, ISLE.beach.top - 0.4, c.height) * smoothstep(-6, -1, c.height) * (1 - c.cliff);
  const seabed = smoothstep(-0.2, -2.5, c.height);
  const pebbles = Math.max(beach, seabed * 0.6, c.streamBed * 0.5) * (1 - rock);
  const mud = Math.max(c.wetness * 0.55, seabed * 0.4, c.streamBed * 0.45) * (1 - rock) * (1 - beach * 0.7);
  const moss = (smoothstep(0, 0.35, c.curvature) * 0.4 + (1 - c.ao) * 0.6 + c.cliffTop * 0.5) * smoothstep(6, 16, c.slope)
    * (1 - smoothstep(36, 50, c.slope)) * (0.6 + 0.8 * c.noise) * (1 - beach);
  const forestZone = smoothstep(9, 16, c.height) * (1 - smoothstep(55, 70, c.height)) * (1 - c.meadow) * (1 - c.ledge);
  const forest = forestZone * smoothstep(0.45, 0.62, c.patch) * (1 - rock) * (1 - beach);
  const grass = Math.max(0, (1 - rock) * (1 - beach) * (1 - seabed) * (0.95 - 0.35 * c.noise) - moss * 0.5 - mud * 0.6 - forest * 0.8);
  const wet = Math.max(c.wetness * 0.7, smoothstep(0.9, 0.1, c.height) * smoothstep(-3, 0, c.height), c.streamBed * 0.8);
  return { weights: [grass, forest, moss, mud, pebbles, rock], wet, forest, rock, beach };
}

export function bakeIsle() {
  // 1. designed shape + erosion protection
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
  const flow = erode(h, size, mask, { seed: ISLE.seed + 11, droplets: 160000 });
  let change = 0;
  for (let k = 0; k < h.length; k++) change += Math.abs(h[k] - designed[k]);
  // 2. masks
  const slope = slopeField(h, size, spacing);
  const curv = curvatureField(h, size, spacing);
  const ao = horizonAO(h, size, spacing);
  const wetF = wetnessFromFlow(flow, size);
  const vis = sunVisibility(h, size, spacing, sunDirection(ISLE.sunAzimuth, ISLE.sunElevation), 300);
  // 3. splat
  const splatA = Buffer.alloc(size * size * 4);
  const splatB = Buffer.alloc(size * size * 4);
  const forestW = new Float32Array(size * size);
  const rockW = new Float32Array(size * size);
  const L = ISLE.ledges;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const [x, z] = samplePos(i, j);
      const f = ledgeFrame(x, z);
      const onLedge = f.lateral < L.halfWidth + L.blend && f.along > -1 && f.along < L.steps * L.tread + L.summit + L.blend ? 1 : 0;
      // a riser: the last 0.35 m of each tread before the next step up
      const inTread = ((f.along % L.tread) + L.tread) % L.tread;
      const riser = onLedge && f.lateral < L.halfWidth + 0.5 && f.along < L.steps * L.tread && inTread > L.tread - 0.6 ? 1 : 0;
      let stack = 0;
      for (const s of ISLE.stacks) if (Math.hypot(x - s.x, z - s.z) < s.r + 3) stack = 1;
      const d = inland(x, z);
      const st = streamDist(x, z);
      const c = isleSplat({
        slope: slope[k], height: h[k], curvature: curv[k], ao: ao[k], wetness: wetF[k], noise: fbm2(x / 9, z / 9, ISLE.seed + 99, 4),
        patch: fbm2(x / 70, z / 70, ISLE.seed + 21, 4) + 0.12 * fbm2(x / 15, z / 15, ISLE.seed + 22, 3), cliff: cliffMask(x, z),
        cliffTop: cliffMask(x, z) * smoothstep(5, 15, d) * smoothstep(40, 20, d), meadow: meadowMask(x, z), ledge: onLedge, riser, stack,
        streamBed: st.d < ISLE.stream.width * 0.8 && d > 2 ? 1 : 0,
      });
      forestW[k] = c.forest;
      rockW[k] = c.rock;
      const q = quantizeWeights(c.weights);
      for (let m = 0; m < 4; m++) splatA[k * 4 + m] = q[m];
      splatB[k * 4] = q[4];
      splatB[k * 4 + 1] = q[5];
      splatB[k * 4 + 2] = Math.round(Math.min(1, c.wet) * 255);
      splatB[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao[k])) * 255);
    }
  }
  // 4. placements: pines in the forest patches (denser in the middle of a patch), lone pines on grass, boulders on the
  //    rocky slopes, the beaches and the meadow's edge; never on the ledges or in the sea
  const rnd = mulberry32(ISLE.seed + 31);
  const at = (x, z) => {
    const fi = Math.round((x - origin) / spacing);
    const fj = Math.round((z - origin) / spacing);
    return fi < 1 || fj < 1 || fi >= size - 1 || fj >= size - 1 ? -1 : fj * size + fi;
  };
  const trees = [];
  for (let n = 0; n < 60000 && trees.length < 2200; n++) {
    const x = origin + rnd() * (size - 1) * spacing;
    const z = origin + rnd() * (size - 1) * spacing;
    const k = at(x, z);
    if (k < 0 || h[k] < 3 || slope[k] > 32) continue;
    const f = ledgeFrame(x, z);
    if (f.lateral < L.halfWidth + L.blend + 3 && f.along > -6 && f.along < L.steps * L.tread + L.summit + L.blend + 3) continue;
    const p = forestW[k] * 0.9 + (meadowMask(x, z) > 0.5 ? 0 : 0.015);
    if (rnd() > p) continue;
    const s = 0.75 + rnd() * 0.6;
    trees.push([+x.toFixed(2), +h[k].toFixed(2), +z.toFixed(2), +s.toFixed(2), Math.floor(rnd() * 3), +(rnd() * 6.283).toFixed(3)]);
  }
  const rocks = [];
  for (let n = 0; n < 40000 && rocks.length < 320; n++) {
    const x = origin + rnd() * (size - 1) * spacing;
    const z = origin + rnd() * (size - 1) * spacing;
    const k = at(x, z);
    if (k < 0 || h[k] < -0.8) continue;
    const f = ledgeFrame(x, z);
    if (f.lateral < L.halfWidth + 2 && f.along > -4 && f.along < L.steps * L.tread + L.summit + 2) continue;
    const beach = h[k] < ISLE.beach.top + 0.6 ? 0.04 : 0;
    const edge = meadowMask(x, z) > 0.05 && meadowMask(x, z) < 0.6 ? 0.03 : 0;
    const p = rockW[k] * 0.06 + smoothstep(18, 32, slope[k]) * 0.05 + beach + edge;
    if (rnd() > p) continue;
    const s = 0.9 + rnd() ** 2 * 3.2;
    rocks.push([+x.toFixed(2), +h[k].toFixed(2), +z.toFixed(2), +s.toFixed(2), Math.floor(rnd() * 4), +(rnd() * 6.283).toFixed(3)]);
  }
  // 5. stats + spawn: the meadow's middle, facing the ledge flight
  let hmin = Infinity;
  let hmax = -Infinity;
  for (const v of h) {
    hmin = Math.min(hmin, v);
    hmax = Math.max(hmax, v);
  }
  const sx = ISLE.meadow.x + 20;
  const sz = ISLE.meadow.z - 5;
  const spawn = [{ x: sx, z: sz, heading: +Math.atan2(ISLE.ledges.x - sx, ISLE.ledges.z - sz).toFixed(4) }];
  return { h, splatA, splatB, ao, vis, slope, trees, rocks, spawn, stats: { heightMin: +hmin.toFixed(3), heightMax: +hmax.toFixed(3), erosionMeanChange: +(change / h.length).toFixed(5) } };
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
    version: 1, size, spacing, origin, heightMin: ISLE.heightRange.min, heightMax: ISLE.heightRange.max,
    waterLevel: ISLE.seaLevel, seaLevel: ISLE.seaLevel, seed: ISLE.seed,
    sun: { azimuth: ISLE.sunAzimuth, elevation: ISLE.sunElevation },
    meadow: ISLE.meadow, ledges: ISLE.ledges, stacks: ISLE.stacks, hill: { x: ISLE.hill.x, z: ISLE.hill.z },
    spawn: b.spawn, layers: LAYERS,
    files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' },
    /** [x, y, z, scale, variant, yaw] */
    trees: b.trees,
    rocks: b.rocks,
    stats: { ...b.stats, trees: b.trees.length, rocks: b.rocks.length },
  };
  await writeFile(join(OUT, 'terrain.json'), JSON.stringify(header) + '\n');
  // preview: splat colours × hillshade × sun, sea in blue (top = north)
  const colours = [[96, 128, 60], [52, 72, 40], [60, 100, 50], [70, 55, 40], [150, 140, 125], [128, 124, 118]];
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
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let m = 0; m < 6; m++) v += colours[m][c] * w[m];
        const sea = [20 + 25 * Math.max(0, 1 + h[k] / 6), 60 + 40 * Math.max(0, 1 + h[k] / 6), 85 + 40 * Math.max(0, 1 + h[k] / 6)][c];
        img[k * 3 + c] = h[k] < ISLE.seaLevel ? Math.min(255, Math.round(sea)) : Math.min(255, Math.round(v * s));
      }
    }
  }
  for (const t of b.trees) {
    const i = Math.round((t[0] - origin) / spacing);
    const j = Math.round((t[2] - origin) / spacing);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (j + dj) * size + (i + di);
      if (k >= 0 && k < size * size) { img[k * 3] = 30; img[k * 3 + 1] = 52; img[k * 3 + 2] = 30; }
    }
  }
  await sharp(img, { raw: { width: size, height: size, channels: 3 } }).png().toFile(PREVIEW);
  console.log(`island baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`, header.stats, 'spawn', b.spawn[0]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
