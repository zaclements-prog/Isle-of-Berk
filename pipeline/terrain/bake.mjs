// Bakes the Cove terrain: shape → erosion → masks → splat → public/assets/world/cove/.
// Deterministic from COVE.seed. Usage: npm run terrain:bake
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  COVE, coveHeight, erosionMask, samplePos, pondQ, azimuthDeg, rayFrame, ringJitter, sunDirection,
} from './coveShape.mjs';
import { erode, EROSION_DEFAULTS } from './erosion.mjs';
import {
  LAYERS, slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, splatForCell, quantizeWeights,
} from './masks.mjs';
import { fbm2 } from './noise.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'world', 'cove');
const PREVIEW = join(ROOT, 'docs', 'progress', 'img', 'cove', 'terrain-preview.png');
const { size, spacing, origin } = COVE.grid;
const t0 = performance.now();

// 1. designed shape + erosion protection mask
const h = new Float32Array(size * size);
const mask = new Float32Array(size * size);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const [x, z] = samplePos(i, j);
    h[j * size + i] = coveHeight(x, z);
    mask[j * size + i] = erosionMask(x, z);
  }
}
// 2. light erosion
const designed = h.slice();
const flow = erode(h, size, mask, { seed: COVE.seed + 11 });
let change = 0;
for (let k = 0; k < h.length; k++) change += Math.abs(h[k] - designed[k]);

// 3. masks
const slope = slopeField(h, size, spacing);
const curv = curvatureField(h, size, spacing);
const ao = horizonAO(h, size, spacing);
const wet = wetnessFromFlow(flow, size);
const vis = sunVisibility(h, size, spacing, sunDirection(COVE.sunAzimuth, COVE.sunElevation));

// 4. splat + wet + AO
const splatA = Buffer.alloc(size * size * 4);
const splatB = Buffer.alloc(size * size * 4);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const [x, z] = samplePos(i, j);
    const r = Math.hypot(x, z);
    const jit = ringJitter(azimuthDeg(x, z));
    const rimT = (r - (COVE.floorRadius + jit)) / (COVE.rimRadius - COVE.floorRadius);
    const ra = rayFrame(x, z, COVE.routeA.azimuth);
    const rb = rayFrame(x, z, COVE.routeB.azimuth);
    const g = rayFrame(x, z, COVE.gully.azimuth);
    const onRoute = Math.max(
      ra.along > COVE.routeA.rStart - 1 && ra.lateral < COVE.routeA.halfWidth + 0.5 ? 1 : 0,
      rb.along > COVE.routeB.r0 - 1 && rb.lateral < COVE.routeB.halfWidth + 1 ? 1 : 0,
    );
    const inGully = g.along > COVE.gully.rStart && g.lateral < COVE.gully.halfWidthIn + 1 ? 1 : 0;
    const c = splatForCell({
      slope: slope[k], height: h[k], waterLevel: COVE.water.level, pondQ: pondQ(x, z), r, rimT, curvature: curv[k],
      wetness: wet[k], noise: fbm2(x / 9, z / 9, COVE.seed + 99, 4), onRoute, inGully,
    });
    const q = quantizeWeights(c.weights);
    splatA[k * 4] = q[0];
    splatA[k * 4 + 1] = q[1];
    splatA[k * 4 + 2] = q[2];
    splatA[k * 4 + 3] = q[3];
    splatB[k * 4] = q[4];
    splatB[k * 4 + 1] = q[5];
    splatB[k * 4 + 2] = Math.round(Math.min(1, c.wet) * 255);
    splatB[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao[k])) * 255);
  }
}

// 5. statistics, lit floor fraction, spawn (lit, flat, away from the pond, facing it)
let hmin = Infinity;
let hmax = -Infinity;
let litCount = 0;
let floorCount = 0;
let best = null;
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    hmin = Math.min(hmin, h[k]);
    hmax = Math.max(hmax, h[k]);
    const [x, z] = samplePos(i, j);
    const r = Math.hypot(x, z);
    const q = pondQ(x, z);
    if (r < 33 && q > 1.1) {
      floorCount++;
      litCount += vis[k];
    }
    if (vis[k] && r < 24 && q > 1.8 && slope[k] < 6) {
      // prefer spots in the middle of a lit patch and a comfortable distance from the pond
      let lit = 0;
      for (let dj = -6; dj <= 6; dj += 3) for (let di = -6; di <= 6; di += 3) lit += vis[Math.min(size - 1, Math.max(0, j + dj)) * size + Math.min(size - 1, Math.max(0, i + di))];
      const score = lit - Math.abs(q - 3) * 2;
      if (!best || score > best.score) best = { score, x, z };
    }
  }
}
if (!best) throw new Error('no lit spawn point on the floor — check the shape parameters');
const spawn = [{ x: +best.x.toFixed(2), z: +best.z.toFixed(2), heading: +Math.atan2(COVE.pond.cx - best.x, COVE.pond.cz - best.z).toFixed(4) }];

// 6. write outputs
const toU16 = new Uint16Array(size * size);
const range = COVE.heightRange.max - COVE.heightRange.min;
for (let k = 0; k < h.length; k++) {
  if (h[k] < COVE.heightRange.min || h[k] > COVE.heightRange.max) throw new Error(`height ${h[k]} outside the 16-bit range`);
  toU16[k] = Math.round(((h[k] - COVE.heightRange.min) / range) * 65535);
}
const le = Buffer.alloc(size * size * 2);
for (let k = 0; k < toU16.length; k++) le.writeUInt16LE(toU16[k], k * 2);
await mkdir(OUT, { recursive: true });
await mkdir(dirname(PREVIEW), { recursive: true });
await writeFile(join(OUT, 'height.bin'), le);
await sharp(splatA, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatA.png'));
await sharp(splatB, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatB.png'));
const header = {
  version: 1,
  size,
  spacing,
  origin,
  heightMin: COVE.heightRange.min,
  heightMax: COVE.heightRange.max,
  waterLevel: COVE.water.level,
  seed: COVE.seed,
  pond: { cx: COVE.pond.cx, cz: COVE.pond.cz, a: COVE.pond.a, b: COVE.pond.b, angle: COVE.pond.angle, depth: COVE.pond.depth },
  floorRadius: COVE.floorRadius,
  rimRadius: COVE.rimRadius,
  wall: COVE.wall,
  sun: { azimuth: COVE.sunAzimuth, elevation: COVE.sunElevation },
  gully: COVE.gully,
  routeA: COVE.routeA,
  routeB: COVE.routeB,
  spawn,
  layers: LAYERS,
  files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' },
  stats: {
    floorLitFraction: +(litCount / floorCount).toFixed(4),
    heightMin: +hmin.toFixed(3),
    heightMax: +hmax.toFixed(3),
    erosionMeanChange: +(change / h.length).toFixed(5),
    erosionDroplets: EROSION_DEFAULTS.droplets,
  },
};
await writeFile(join(OUT, 'terrain.json'), JSON.stringify(header, null, 1) + '\n');

// 7. preview: splat colours × hillshade × sun, for docs/progress (top = north)
const colours = [[96, 128, 60], [88, 70, 48], [60, 100, 50], [70, 55, 40], [150, 140, 125], [128, 124, 118]];
const shade = Buffer.alloc(size * size * 3);
const L = [-0.6, 0.5, -0.4];
const Ll = Math.hypot(...L);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const gx = (h[j * size + Math.min(size - 1, i + 1)] - h[j * size + Math.max(0, i - 1)]) / (2 * spacing);
    const gz = (h[Math.min(size - 1, j + 1) * size + i] - h[Math.max(0, j - 1) * size + i]) / (2 * spacing);
    const nl = Math.hypot(gx, 1, gz);
    const lam = Math.max(0, (-gx * L[0] + L[1] - gz * L[2]) / (nl * Ll));
    const w = [splatA[k * 4], splatA[k * 4 + 1], splatA[k * 4 + 2], splatA[k * 4 + 3], splatB[k * 4], splatB[k * 4 + 1]];
    const s = (0.35 + 0.65 * lam) * (vis[k] ? 1 : 0.45) * (0.6 + 0.4 * ao[k]) * 1.6 / 255;
    const [x, z] = samplePos(i, j);
    const water = h[k] < COVE.water.level && pondQ(x, z) < 1.2;
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let m = 0; m < 6; m++) v += colours[m][c] * w[m];
      shade[k * 3 + c] = water ? [40, 70, 90][c] : Math.min(255, Math.round(v * s));
    }
  }
}
await sharp(shade, { raw: { width: size, height: size, channels: 3 } }).extract({ left: 300, top: 300, width: 424, height: 424 })
  .resize(848, 848).png().toFile(PREVIEW);
console.log(`terrain baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`, header.stats, 'spawn', spawn[0]);
