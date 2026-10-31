// The Test Isle's designed shape (docs/superpowers/plans/2026-11-01-test-isle.md): a small northern island in open sea,
// built from explicit features so every interaction has a place — shingle beaches, a broad flat meadow for gallops and
// running takeoffs, a stepped rock ledge flight to climb, a central hill with a stream valley, sea cliffs and sea
// stacks to fly to. Pure functions of (x, z) and ISLE; deterministic from ISLE.seed. +X east, −Z north, sea at y = 0.
import { fbm2, ridged2 } from './noise.mjs';

export const ISLE = {
  seed: 4242,
  grid: { size: 1024, spacing: 0.8, origin: -409.6 },
  heightRange: { min: -16, max: 112 },
  seaLevel: 0,
  sunAzimuth: 250,
  sunElevation: 22,
  /** Coastline: mean radius (m) with angular lobes; a bay bites into the south. */
  coast: { mean: 255, lobes: [{ n: 2, amp: 18, phase: 40 }, { n: 3, amp: 22, phase: 200 }, { n: 5, amp: 11, phase: 75 }, { n: 9, amp: 5, phase: 10 }],
    bay: { azimuth: 168, width: 26, depth: 85 } },
  beach: { width: 24, top: 2.0 },
  /** Lowlands rise from the beach top to ~lowTop over lowRun metres inland. */
  lowland: { top: 16, run: 120, undulation: 3.5 },
  hill: { x: -35, z: -70, height: 54, sigma: 78, ridgeAzimuth: 95, ridgeLen: 150, ridgeHeight: 22, ridgeSigma: 32 },
  /** Sea cliffs: the coastal sector (deg) where the land meets the sea in a cliff of this height. */
  cliffs: { from: 15, to: 115, height: 30, blend: 18, face: 9 },
  stacks: [
    { x: 175, z: -240, r: 11, h: 34 },
    { x: 238, z: -150, r: 8, h: 26 },
    { x: 120, z: -300, r: 13, h: 42 },
  ],
  meadow: { x: -105, z: 95, rx: 82, rz: 62, height: 12, blend: 30 },
  /** Ledge flight: a stepped rock tor on the meadow. From its foot (x, z) heading `azimuth`, `steps` risers of `rise` m
   *  every `tread` m, `halfWidth` wide, up to a `summit` m long top; its far side and flanks drop over `blend` m. */
  ledges: { x: -128, z: 72, azimuth: 330, steps: 6, tread: 3.2, rise: 2.2, halfWidth: 6, blend: 7, summit: 9 },
  stream: { points: [[-35, -40], [10, -20], [60, -35], [110, -15], [170, 5], [235, 20]], width: 6, depth: 2.6 },
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const D = Math.PI / 180;

/** Compass azimuth (deg, 0 = north = −Z, 90 = east = +X) of (x, z) from the origin. */
export function azimuthDeg(x, z) {
  const a = Math.atan2(x, -z) / D;
  return a < 0 ? a + 360 : a;
}

const angDist = (a, b) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
};

export function samplePos(i, j) {
  const { spacing, origin } = ISLE.grid;
  return [origin + i * spacing, origin + j * spacing];
}

/** Coast radius (m) at azimuth a (deg): lobes, a noisy wobble and the south bay. */
export function coastRadius(a) {
  const c = ISLE.coast;
  let r = c.mean;
  for (const l of c.lobes) r += l.amp * Math.sin((l.n * a + l.phase) * D);
  r += (fbm2(Math.cos(a * D) * 3 + 10, Math.sin(a * D) * 3 + 10, ISLE.seed, 4) - 0.5) * 24;
  const bay = Math.exp(-((angDist(a, c.bay.azimuth) / c.bay.width) ** 2));
  return r - c.bay.depth * bay;
}

/** Inland distance (m) from the coast along the ray (negative at sea). */
export function inland(x, z) {
  return coastRadius(azimuthDeg(x, z)) - Math.hypot(x, z);
}

/** 0…1: how much the coast here is a sea cliff. */
export function cliffMask(x, z) {
  const a = azimuthDeg(x, z);
  const c = ISLE.cliffs;
  const mid = (c.from + c.to) / 2;
  const half = (c.to - c.from) / 2;
  return smoothstep(half + 12, half - 6, angDist(a, mid));
}

/** The ledge flight's frame: distance along its azimuth from its foot, and lateral distance. */
export function ledgeFrame(x, z) {
  const L = ISLE.ledges;
  const fx = Math.sin(L.azimuth * D);
  const fz = -Math.cos(L.azimuth * D);
  const dx = x - L.x;
  const dz = z - L.z;
  return { along: dx * fx + dz * fz, lateral: Math.abs(dx * fz - dz * fx) };
}

/** Distance (m) to the stream's polyline, and how far along it (0 at the source … 1 at the sea). */
export function streamDist(x, z) {
  const P = ISLE.stream.points;
  let best = Infinity;
  let at = 0;
  let total = 0;
  const lens = [];
  for (let k = 0; k < P.length - 1; k++) {
    lens.push(Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]));
    total += lens[k];
  }
  let run = 0;
  for (let k = 0; k < P.length - 1; k++) {
    const [ax, az] = P[k];
    const [bx, bz] = P[k + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) {
      best = d;
      at = (run + t * lens[k]) / total;
    }
    run += lens[k];
  }
  return { d: best, at };
}

/** Meadow mask: 1 on the flat meadow, 0 beyond its blend. */
export function meadowMask(x, z) {
  const m = ISLE.meadow;
  const q = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
  const edge = 1 + (fbm2(x / 40, z / 40, ISLE.seed + 5, 3) - 0.5) * 0.25;
  return smoothstep(edge + m.blend / Math.min(m.rx, m.rz), edge, q);
}

/** The island's land height before the designed overrides (meadow, ledges, stream). */
function landHeight(x, z, d) {
  const S = ISLE.seed;
  const b = ISLE.beach;
  const lw = ISLE.lowland;
  // beach → lowland
  let h = d < b.width ? 0.15 + (b.top - 0.15) * (d / b.width) : b.top + (lw.top - b.top) * smoothstep(0, lw.run, d - b.width);
  h += (fbm2(x / 60, z / 60, S + 1, 4) - 0.5) * 2 * lw.undulation * smoothstep(b.width, b.width + 40, d);
  // the hill and its ridge spur (its gaussian tails fade out over the beach: at the waterline they left a step)
  const coastFade = smoothstep(0, b.width + 10, d);
  const hl = ISLE.hill;
  const dh = Math.hypot(x - hl.x, z - hl.z);
  h += hl.height * Math.exp(-(dh * dh) / (2 * hl.sigma * hl.sigma)) * (0.85 + 0.3 * ridged2(x / 70, z / 70, S + 2, 4)) * coastFade;
  const rx = Math.sin(hl.ridgeAzimuth * D);
  const rz = -Math.cos(hl.ridgeAzimuth * D);
  const along = (x - hl.x) * rx + (z - hl.z) * rz;
  const lat = Math.abs((x - hl.x) * rz - (z - hl.z) * rx);
  // (eased in behind the summit: a hard start at along = 0 left a seam across the hill)
  h += hl.ridgeHeight * Math.exp(-(lat * lat) / (2 * hl.ridgeSigma ** 2)) * smoothstep(hl.ridgeLen, hl.ridgeLen * 0.3, along) * smoothstep(-hl.ridgeSigma, hl.ridgeSigma, along) * coastFade;
  // rocky breakup on the higher ground
  h += (ridged2(x / 25, z / 25, S + 3, 3) - 0.4) * 3 * smoothstep(25, 55, h);
  return h;
}

/** Sea floor below the coast: shelving down from the beach, deeper under the cliffs. */
function seaFloor(x, z, d, cliff) {
  const depth = Math.min(13, -d * lerp(0.07, 0.35, cliff)) + 0.8;
  return -depth + (fbm2(x / 30, z / 30, ISLE.seed + 7, 3) - 0.5) * 1.5;
}

export function isleHeight(x, z) {
  const d = inland(x, z);
  const cliff = cliffMask(x, z);
  let h;
  if (d >= 0) {
    h = landHeight(x, z, d);
    // sea cliffs: the land stands at the cliff height right to the edge, the face drops in `face` metres
    const c = ISLE.cliffs;
    if (cliff > 0) {
      const top = Math.max(h, c.height + (fbm2(x / 35, z / 35, ISLE.seed + 9, 3) - 0.5) * 10) * smoothstep(0, c.blend, d + c.face);
      const face = smoothstep(0, c.face, d);
      h = lerp(h, lerp(seaFloor(x, z, -1, 1), top, face), cliff);
    }
  } else {
    h = seaFloor(x, z, d, cliff);
    // the beach runs smoothly out under the water
    h = lerp(h, 0.15 + d * 0.08, smoothstep(-20, 0, d) * (1 - cliff));
  }
  // sea stacks: steep pillars with a slight lean of noise
  for (const s of ISLE.stacks) {
    const ds = Math.hypot(x - s.x, z - s.z) * (1 + (fbm2(x / 9, z / 9, ISLE.seed + 11, 2) - 0.5) * 0.35);
    const top = s.h + (ridged2(x / 8, z / 8, ISLE.seed + 12, 2) - 0.5) * 4;
    h = Math.max(h, lerp(h, top, smoothstep(s.r + 4, s.r - 1, ds)));
  }
  if (d > 0) {
    // the meadow: flattened to its height
    const m = meadowMask(x, z);
    if (m > 0) h = lerp(h, ISLE.meadow.height + (fbm2(x / 20, z / 20, ISLE.seed + 13, 2) - 0.5) * 0.5, m);
    // the ledge flight: grassy treads and rock risers stepping up from the meadow
    const L = ISLE.ledges;
    const f = ledgeFrame(x, z);
    const len = L.steps * L.tread;
    const top = len + L.summit;
    if (f.along > -L.tread && f.along < top + L.blend && f.lateral < L.halfWidth + L.blend) {
      const k = Math.max(0, Math.min(L.steps, Math.floor(f.along / L.tread) + 1));
      const stepH = ISLE.meadow.height + k * L.rise + (fbm2(x / 3, z / 3, ISLE.seed + 14, 2) - 0.5) * 0.12;
      const lat = smoothstep(L.halfWidth + L.blend, L.halfWidth, f.lateral);
      const ends = smoothstep(-L.tread, 0, f.along) * smoothstep(top + L.blend, top, f.along);
      // the flight stands up out of the ground as a stepped outcrop (never cut into it: a cut leaves a slot between
      // two rock walls); where the ground is already higher than a tread, the ground wins
      h = lerp(h, Math.max(h, stepH), lat * ends);
    }
    // the stream: a channel down from the hill to the east beach
    const st = streamDist(x, z);
    const w = ISLE.stream.width;
    if (st.d < w * 2.5) h -= ISLE.stream.depth * smoothstep(w * 2.5, w * 0.4, st.d) * smoothstep(0, 0.08, st.at) * smoothstep(0, 10, d);
  }
  return h;
}

/** Erosion protection: 0 on the designed features (meadow, ledges, stacks, beaches), 1 elsewhere. */
export function erosionMask(x, z) {
  const d = inland(x, z);
  let m = smoothstep(ISLE.beach.width * 0.5, ISLE.beach.width + 20, d);
  m *= 1 - meadowMask(x, z);
  const f = ledgeFrame(x, z);
  const L = ISLE.ledges;
  if (f.lateral < L.halfWidth + L.blend + 4 && f.along > -8 && f.along < L.steps * L.tread + L.summit + L.blend + 4) m = 0;
  for (const s of ISLE.stacks) if (Math.hypot(x - s.x, z - s.z) < s.r + 8) m = 0;
  return m;
}

export function sunDirection(azimuth, elevation) {
  const a = azimuth * D;
  const e = elevation * D;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
