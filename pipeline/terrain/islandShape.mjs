// The island's designed shape, after the films' Isle of Berk (docs/superpowers/plans/2026-11-01-test-isle.md, the
// Berk revision): a rugged northern island ringed by sea cliffs, a mountain massif in the north, a sheltered harbour
// in the south-east with the village climbing terrace by terrace from the docks up to the Great Hall on the mountain's
// flank, the Kill Ring sunk into the cliff-top west of the village, the Cove hidden in the western forest, a forested
// western headland (after Raven Point), a grassy cliff-top plateau in the east for gallops (with a stepped rock tor
// for the climbing moves), and sea stacks all round. Pure functions of (x, z) and ISLE; deterministic from ISLE.seed.
// +X east, −Z north, sea at y = 0.
import { fbm2, ridged2 } from './noise.mjs';

const D = Math.PI / 180;
const HALL = { x: 18, z: 10, height: 52, rx: 34, rz: 24, yaw: 200 };
const SHORE = { x: 70, z: 205 };
/** The village climbs in terraces along the line from the harbour shore up to the Great Hall's terrace. */
const TERRACE_HEIGHTS = [9, 18, 27, 36, 44];

function terraceList() {
  const out = [];
  const n = TERRACE_HEIGHTS.length;
  for (let k = 0; k < n; k++) {
    const t = 0.16 + (0.7 * k) / (n - 1);
    // zigzag across the slope, each terrace a little turned: a village grown up the hill, not a staircase
    const yaw0 = Math.atan2(HALL.x - SHORE.x, -(HALL.z - SHORE.z)) / D;
    const side = (k % 2 === 0 ? 1 : -1) * (10 + 4 * k);
    const nx = Math.cos(yaw0 * D);
    const nz = Math.sin(yaw0 * D);
    out.push({
      x: +(SHORE.x + (HALL.x - SHORE.x) * t + nx * side).toFixed(2), z: +(SHORE.z + (HALL.z - SHORE.z) * t + nz * side).toFixed(2),
      height: TERRACE_HEIGHTS[k], rx: 44 - k * 3, rz: 16, yaw: +(yaw0 + (k % 2 === 0 ? 9 : -11)).toFixed(1),
    });
  }
  return out;
}

export const ISLE = {
  seed: 7101,
  grid: { size: 1024, spacing: 1.0, origin: -512 },
  heightRange: { min: -26, max: 200 },
  seaLevel: 0,
  sunAzimuth: 245,
  sunElevation: 36,
  /** Coastline: mean radius (m) with angular lobes; Raven Point juts out in the west, the harbour bites into the SE. */
  coast: { mean: 372, lobes: [{ n: 2, amp: 30, phase: 100 }, { n: 3, amp: 26, phase: 15 }, { n: 5, amp: 14, phase: 200 }, { n: 8, amp: 7, phase: 60 }],
    point: { azimuth: 285, width: 14, out: 70 }, wobble: 30 },
  /** Sea cliffs all round: the cliff-top height, how fast the face drops, and the land rising inland from the top. */
  cliffs: { top: 26, topVar: 14, face: 9, rise: 30, riseRun: 260 },
  mountain: { x: -10, z: -175, height: 80, sigma: 120, ridges: [{ azimuth: 60, len: 260, height: 40, sigma: 34 }, { azimuth: 300, len: 230, height: 34, sigma: 30 }] },
  /** The harbour: a channel cut from the sea at `mouth` azimuth inward to the shore shelf by the docks. */
  harbour: { mouthAzimuth: 162, inner: SHORE, width: 72, innerWidth: 40, shelf: 2.2, shelfWidth: 12, depth: -7 },
  hall: HALL,
  terraces: terraceList(),
  /** The path up through the village: from the shore shelf, through every terrace, to the hall's terrace. */
  path: { width: 7 },
  killRing: { x: -95, z: 170, r: 26, depth: 9, wall: 2.5 },
  cove: { x: -205, z: -40, r: 38, depth: 16, floor: 4, pond: { x: -200, z: -32, r: 13, depth: 2.2 }, gully: { azimuth: 110, width: 8 } },
  plateau: { x: 215, z: 15, rx: 70, rz: 48, blend: 55 },
  ledges: { x: 232, z: 42, azimuth: 80, steps: 6, tread: 3.2, rise: 2.2, halfWidth: 6, blend: 7, summit: 9 },
  stacks: [
    { x: 250, z: 345, r: 10, h: 34 }, { x: 320, z: 270, r: 8, h: 28 }, { x: 175, z: 405, r: 12, h: 40 },
    { x: -330, z: -260, r: 11, h: 36 }, { x: -270, z: -360, r: 9, h: 30 }, { x: 110, z: -440, r: 13, h: 46 },
    { x: 380, z: -150, r: 9, h: 31 }, { x: -470, z: 40, r: 10, h: 33 }, { x: -150, z: 410, r: 8, h: 27 },
  ],
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

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

/** Coast radius (m) at azimuth a: lobes, a wobble, Raven Point. (The harbour is carved separately, see harbourField.) */
export function coastRadius(a) {
  const c = ISLE.coast;
  let r = c.mean;
  for (const l of c.lobes) r += l.amp * Math.sin((l.n * a + l.phase) * D);
  r += (fbm2(Math.cos(a * D) * 4 + 10, Math.sin(a * D) * 4 + 10, ISLE.seed, 4) - 0.5) * c.wobble;
  r += c.point.out * Math.exp(-((angDist(a, c.point.azimuth) / c.point.width) ** 2));
  return r;
}

/** Inland distance (m) from the outer coast along the ray from the origin (negative at sea). */
export function inland(x, z) {
  return coastRadius(azimuthDeg(x, z)) - Math.hypot(x, z);
}

/**
 * The harbour as a field: distance (m) from its centreline (the segment from the mouth, beyond the coast, to the shore
 * shelf), its local half-width, and the fraction along it (0 at sea … 1 at the shelf).
 */
export function harbourField(x, z) {
  const H = ISLE.harbour;
  const a = H.mouthAzimuth * D;
  const r = coastRadius(H.mouthAzimuth) + 40;
  const mx = Math.sin(a) * r;
  const mz = -Math.cos(a) * r;
  const vx = H.inner.x - mx;
  const vz = H.inner.z - mz;
  const len2 = vx * vx + vz * vz;
  const t = Math.min(1, Math.max(0, ((x - mx) * vx + (z - mz) * vz) / len2));
  const d = Math.hypot(x - mx - vx * t, z - mz - vz * t);
  const wob = (fbm2(x / 40, z / 40, ISLE.seed + 3, 3) - 0.5) * 10;
  return { d: d + wob, half: lerp(H.width, H.innerWidth, t), t, along: t * Math.sqrt(len2), len: Math.sqrt(len2) };
}

function ellipseQ(x, z, e) {
  const yaw = (e.yaw ?? 0) * D;
  const dx = x - e.x;
  const dz = z - e.z;
  const u = dx * Math.cos(yaw) + dz * Math.sin(yaw);
  const v = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
  // an irregular outline: the edge wanders by up to ±18 %
  return Math.hypot(u / e.rx, v / e.rz) * (1 + (fbm2(x / 22 + e.x, z / 22, ISLE.seed + 6, 3) - 0.5) * 0.36);
}

/** 0…1 on terrace k (flat), fading over `blend` m beyond its edge. */
export function terraceMask(x, z, k, blend = 14) {
  const t = ISLE.terraces[k];
  const q = ellipseQ(x, z, t);
  return smoothstep(1 + blend / Math.min(t.rx, t.rz), 1, q);
}

export function hallMask(x, z, blend = 12) {
  const q = ellipseQ(x, z, ISLE.hall);
  return smoothstep(1 + blend / ISLE.hall.rz, 1, q);
}

/** The village path: distance to the polyline shore → terraces → hall, and the height along it there. */
export function pathField(x, z) {
  const pts = [{ x: ISLE.harbour.inner.x, z: ISLE.harbour.inner.z, h: ISLE.harbour.shelf }, ...ISLE.terraces.map((t) => ({ x: t.x, z: t.z, h: t.height })),
    { x: ISLE.hall.x, z: ISLE.hall.z, h: ISLE.hall.height }];
  let best = Infinity;
  let hb = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (d < best) {
      best = d;
      hb = lerp(a.h, b.h, smoothstep(0, 1, t));
    }
  }
  return { d: best, h: hb };
}

export function plateauMask(x, z) {
  const p = ISLE.plateau;
  const q = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
  return smoothstep(1 + p.blend / Math.min(p.rx, p.rz), 1, q);
}

export function ledgeFrame(x, z) {
  const L = ISLE.ledges;
  const fx = Math.sin(L.azimuth * D);
  const fz = -Math.cos(L.azimuth * D);
  const dx = x - L.x;
  const dz = z - L.z;
  return { along: dx * fx + dz * fz, lateral: Math.abs(dx * fz - dz * fx) };
}

/** The land before the designed sites: cliff-top plateau rising inland, the mountain and its ridges, rocky breakup. */
function landHeight(x, z, d) {
  const S = ISLE.seed;
  const c = ISLE.cliffs;
  const top = c.top + (fbm2(x / 90, z / 90, S + 1, 3) - 0.5) * 2 * c.topVar;
  let h = top + c.rise * smoothstep(0, c.riseRun, d) + (fbm2(x / 55, z / 55, S + 2, 4) - 0.5) * 12;
  const m = ISLE.mountain;
  const dm = Math.hypot(x - m.x, z - m.z);
  h += m.height * Math.exp(-(dm * dm) / (2 * m.sigma * m.sigma)) * (0.8 + 0.4 * ridged2(x / 80, z / 80, S + 4, 4));
  for (const r of m.ridges) {
    const rx = Math.sin(r.azimuth * D);
    const rz = -Math.cos(r.azimuth * D);
    const along = (x - m.x) * rx + (z - m.z) * rz;
    const lat = Math.abs((x - m.x) * rz - (z - m.z) * rx);
    h += r.height * Math.exp(-(lat * lat) / (2 * r.sigma ** 2)) * smoothstep(r.len, r.len * 0.3, along) * smoothstep(-r.sigma, r.sigma, along);
  }
  h += (ridged2(x / 28, z / 28, S + 5, 3) - 0.4) * 5 * smoothstep(40, 90, h);
  return h;
}

function seaFloor(x, z, d) {
  return -Math.min(20, 2 - d * 0.22) + (fbm2(x / 30, z / 30, ISLE.seed + 7, 3) - 0.5) * 2;
}

/** The cliff edge: land at its height inland, a steep face down to the sea floor over `face` m at the shore. */
function withCliff(land, sea, d, face) {
  return lerp(sea, land, smoothstep(-1, face, d));
}

export function isleHeight(x, z) {
  const d = inland(x, z);
  const cf = ISLE.cliffs.face;
  let h = d > -cf ? withCliff(landHeight(x, z, Math.max(0, d)), seaFloor(x, z, Math.min(d, -1)), d, cf) : seaFloor(x, z, d);
  // the harbour: open water down the channel, cliffs either side, a low shelf at its head for the docks
  const H = ISLE.harbour;
  const hb = harbourField(x, z);
  const edge = hb.d - hb.half;
  if (edge < cf + 4) {
    const water = H.depth + (fbm2(x / 25, z / 25, ISLE.seed + 8, 2) - 0.5) * 1.5;
    h = withCliff(h, water, edge, cf);
  }
  // the shelf at the harbour's head and the village path
  // (a band along the water's edge round the harbour's head)
  const shelf = smoothstep(-1.5, 0.5, edge) * smoothstep(H.shelfWidth + 4, H.shelfWidth - 1, edge) * smoothstep(0.72, 0.88, hb.t);
  const p = pathField(x, z);
  const onPath = smoothstep(ISLE.path.width + 5, ISLE.path.width * 0.5, p.d);
  // terraces and the hall's terrace, flattened into the slope (cut and fill)
  for (let k = 0; k < ISLE.terraces.length; k++) {
    const m = terraceMask(x, z, k);
    if (m > 0) h = lerp(h, ISLE.terraces[k].height, m);
  }
  const hm = hallMask(x, z);
  if (hm > 0) h = lerp(h, ISLE.hall.height, hm);
  if (onPath > 0 && hb.d > hb.half - 2) h = lerp(h, p.h, onPath);
  if (shelf > 0) h = lerp(h, H.shelf, shelf);
  // the eastern plateau: flattened at its own height for gallops and running takeoffs
  const pm = plateauMask(x, z);
  if (pm > 0) h = lerp(h, plateauHeight(), pm);
  // the stepped tor on the plateau
  const L = ISLE.ledges;
  const f = ledgeFrame(x, z);
  const len = L.steps * L.tread;
  const tTop = len + L.summit;
  if (f.along > -L.tread && f.along < tTop + L.blend && f.lateral < L.halfWidth + L.blend) {
    const k = Math.max(0, Math.min(L.steps, Math.floor(f.along / L.tread) + 1));
    const stepH = plateauHeight() + k * L.rise;
    const lat = smoothstep(L.halfWidth + L.blend, L.halfWidth, f.lateral);
    const ends = smoothstep(-L.tread, 0, f.along) * smoothstep(tTop + L.blend, tTop, f.along);
    h = lerp(h, Math.max(h, stepH), lat * ends);
  }
  // the Kill Ring: a round pit with steep stone sides and a flat floor
  const R = ISLE.killRing;
  const dr = Math.hypot(x - R.x, z - R.z);
  if (dr < R.r + R.wall + 8) {
    const rim = ringRim();
    const around = smoothstep(R.r + R.wall + 8, R.r + R.wall, dr);
    h = lerp(h, rim, around);
    h = lerp(h, rim - R.depth, smoothstep(R.r + R.wall, R.r, dr));
  }
  // the Cove: a hollow sunk into the forest, walled by rock, with a gully out to the east and a pond
  const C = ISLE.cove;
  const dc = Math.hypot(x - C.x, z - C.z) * (1 + (fbm2(x / 20, z / 20, ISLE.seed + 9, 3) - 0.5) * 0.18);
  if (dc < C.r + 26) {
    const rimH = coveRim();
    const floor = rimH - C.depth;
    const ga = azimuthDeg(x - C.x, z - C.z);
    const gAng = smoothstep(C.gully.width * 2.2, C.gully.width, angDist(ga, C.gully.azimuth) * D * dc);
    const gully = gAng * smoothstep(C.r * 0.6, C.r, dc);
    const wall = smoothstep(C.r + 6, C.r - 3, dc);
    // a raised rim round the hollow, so its walls stand their full height all round (open where the gully leaves)
    h = lerp(h, Math.max(h, rimH + (fbm2(x / 15, z / 15, ISLE.seed + 14, 2) - 0.5) * 4), smoothstep(C.r + 24, C.r + 4, dc) * (1 - gAng));
    let inner = lerp(h, floor + (fbm2(x / 12, z / 12, ISLE.seed + 10, 2) - 0.5) * 1.2, wall);
    inner = lerp(inner, lerp(floor, h, smoothstep(C.r, C.r + 26, dc)), gully);
    h = inner;
    const dp = Math.hypot(x - C.pond.x, z - C.pond.z) * (1 + (fbm2(x / 8, z / 8, ISLE.seed + 11, 2) - 0.5) * 0.3);
    h -= C.pond.depth * smoothstep(C.pond.r + 2, C.pond.r - 3, dp) * wall;
  }
  // sea stacks
  for (const s of ISLE.stacks) {
    const ds = Math.hypot(x - s.x, z - s.z) * (1 + (fbm2(x / 9, z / 9, ISLE.seed + 12, 2) - 0.5) * 0.35);
    const top = s.h + (ridged2(x / 8, z / 8, ISLE.seed + 13, 2) - 0.5) * 4;
    h = Math.max(h, lerp(h, top, smoothstep(s.r + 4, s.r - 1, ds)));
  }
  return h;
}

/** Heights of the designed sites, taken from the undisturbed land there so they sit naturally. */
let _plateau = null;
export function plateauHeight() {
  _plateau ??= Math.round(landHeight(ISLE.plateau.x, ISLE.plateau.z, inland(ISLE.plateau.x, ISLE.plateau.z)));
  return _plateau;
}
let _ring = null;
export function ringRim() {
  const R = ISLE.killRing;
  _ring ??= Math.round(landHeight(R.x, R.z, inland(R.x, R.z)));
  return _ring;
}
let _cove = null;
export function coveRim() {
  const C = ISLE.cove;
  _cove ??= Math.round(landHeight(C.x, C.z, inland(C.x, C.z)));
  return _cove;
}
export function pondLevel() {
  return coveRim() - ISLE.cove.depth - 0.35;
}

/** Erosion protection: 0 on every designed site and the cliff faces' feet, 1 elsewhere. */
export function erosionMask(x, z) {
  let m = smoothstep(4, 30, inland(x, z));
  const hb = harbourField(x, z);
  m *= smoothstep(hb.half + 4, hb.half + 30, hb.d);
  for (let k = 0; k < ISLE.terraces.length; k++) m *= 1 - terraceMask(x, z, k, 14);
  m *= 1 - hallMask(x, z, 14);
  m *= smoothstep(ISLE.path.width, ISLE.path.width + 14, pathField(x, z).d);
  m *= 1 - plateauMask(x, z);
  const R = ISLE.killRing;
  if (Math.hypot(x - R.x, z - R.z) < R.r + 20) m = 0;
  const C = ISLE.cove;
  if (Math.hypot(x - C.x, z - C.z) < C.r + 30) m = 0;
  for (const s of ISLE.stacks) if (Math.hypot(x - s.x, z - s.z) < s.r + 8) m = 0;
  return m;
}

/** 0…1: how much this is open village ground (terraces, the hall's terrace, the path, the shelf). */
export function villageMask(x, z) {
  let v = 0;
  for (let k = 0; k < ISLE.terraces.length; k++) v = Math.max(v, terraceMask(x, z, k, 3));
  v = Math.max(v, hallMask(x, z, 3), smoothstep(ISLE.path.width, ISLE.path.width * 0.4, pathField(x, z).d));
  const H = ISLE.harbour;
  v = Math.max(v, smoothstep(H.innerWidth + H.shelfWidth + 2, H.innerWidth + H.shelfWidth - 3, Math.hypot(x - H.inner.x, z - H.inner.z)));
  return v;
}

export function sunDirection(azimuth, elevation) {
  const a = azimuth * D;
  const e = elevation * D;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
