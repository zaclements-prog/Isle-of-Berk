// The Cove's height as explicit shape functions (spec §7.2–7.3). World metres, +Y up, +X east, −Z north.
// Compass azimuth φ: 0° = north (−Z), 90° = east (+X) — the same convention as src/render/sun.ts.
import { fbm2, ridged2 } from './noise.mjs';

export const COVE = {
  seed: 1337,
  grid: { size: 1024, spacing: 0.4, origin: -204.8 }, // sample i sits at origin + i·spacing
  heightRange: { min: -8, max: 72 }, // 16-bit quantisation range (1.2 mm steps)
  floorRadius: 35, // hollow floor ≈ 70 m across
  rimRadius: 50, // rim ≈ 100 m across
  sunAzimuth: 292, // GOLDEN_HOUR: walls are lowest toward the sun and the gully opens there
  sunElevation: 14,
  wall: { mean: 19.5, amp: 5.5, sharpness: 5, jitter: 1.6 }, // H(φ) = mean − amp·cos(φ − sun): 14–25 m
  water: { level: -0.45 },
  pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5, bank: 0.4 }, // ≈ 35 × 25 m, 2.5 m deep
  gully: { azimuth: 292, rStart: 30, rEnd: 110, halfWidthIn: 8, halfWidthOut: 13, blend: 8, ease: 1.6 },
  routeA: { azimuth: 330, rStart: 29, steps: 7, tread: 3.0, rise: 2.2, riserRun: 0.3, halfWidth: 3.5, blend: 3 },
  routeB: { azimuth: 250, r0: 33, r1: 51, sharpness: 3.5, halfWidth: 4, blend: 4 },
};

const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Compass azimuth of (x, z) in degrees [0, 360). */
export function azimuthDeg(x, z) {
  const a = Math.atan2(x, -z) / DEG;
  return a < 0 ? a + 360 : a;
}

/** Unit ground direction [x, z] of a compass azimuth. */
export function azimuthDir(deg) {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}

/** Unit vector from the scene toward the sun — identical to src/render/sun.ts sunDirection. */
export function sunDirection(azimuthDegrees, elevationDegrees) {
  const az = azimuthDegrees * DEG;
  const el = elevationDegrees * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** Distance along and across a ray from the origin at compass azimuth `deg`. */
export function rayFrame(x, z, deg) {
  const [ux, uz] = azimuthDir(deg);
  return { along: x * ux + z * uz, lateral: Math.abs(x * uz - z * ux) };
}

/** Rim height above the floor at azimuth φ: lowest toward the sun, tallest opposite. */
export function wallHeight(phiDeg) {
  return COVE.wall.mean - COVE.wall.amp * Math.cos((phiDeg - COVE.sunAzimuth) * DEG);
}

/** Steep S-curve on t ∈ [0, 1] → [0, 1]; max slope 0.5·k / tanh(k/2) at t = 0.5. */
export function cliffCurve(t, k) {
  const tt = clamp(t, 0, 1);
  return 0.5 + (0.5 * Math.tanh(k * (tt - 0.5))) / Math.tanh(k / 2);
}

/** Radial jitter of the wall ring, periodic in azimuth (sampled on a circle in noise space). */
export function ringJitter(phiDeg) {
  const s = Math.sin(phiDeg * DEG);
  const c = Math.cos(phiDeg * DEG);
  return COVE.wall.jitter * (fbm2(s * 2.2 + 11.3, c * 2.2 + 7.9, COVE.seed + 1, 4) * 2 - 1);
}

/** The hollow floor: gently rising toward the wall foot, low undulation; always above the water level. */
export function floorHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = 0.6 * clamp(r / COVE.floorRadius, 0, 1) ** 2;
  const und = 0.3 * (fbm2(x / 18, z / 18, COVE.seed + 2, 4) * 2 - 1);
  return rise + und;
}

function outside(x, z, d) {
  const slope = 0.06 * d;
  const hills = smoothstep(0, 60, d) * 14 * (fbm2(x / 70, z / 70, COVE.seed + 4, 5) - 0.4);
  const far = smoothstep(100, 160, d) * 9 * (fbm2(x / 45, z / 45, COVE.seed + 5, 4) - 0.3);
  return slope + hills + far;
}

/** Floor → cliff wall → rim → rolling hills, before the pond, gully and routes are cut in. */
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const phi = azimuthDeg(x, z);
  const j = ringJitter(phi);
  const rf = COVE.floorRadius + j;
  const rr = COVE.rimRadius + j;
  const H = wallHeight(phi);
  const fl = floorHeight(x, z);
  if (r <= rf) return fl;
  const t = (r - rf) / (rr - rf);
  if (t <= 1) {
    const rough = 1.2 * Math.sin(Math.PI * t) * (ridged2(x / 6, z / 6, COVE.seed + 3, 4) - 0.5);
    return lerp(fl, H, cliffCurve(t, COVE.wall.sharpness)) + rough;
  }
  return H + outside(x, z, r - rr);
}

/** Pond ellipse parameter: q < 1 inside the water outline, 1 on it. */
export function pondQ(x, z) {
  const p = COVE.pond;
  const a = p.angle * DEG;
  const dx = x - p.cx;
  const dz = z - p.cz;
  const u = dx * Math.cos(a) + dz * Math.sin(a);
  const v = -dx * Math.sin(a) + dz * Math.cos(a);
  return (u / p.a) ** 2 + (v / p.b) ** 2;
}

function carvePond(h, x, z) {
  const p = COVE.pond;
  const wl = COVE.water.level;
  const q = pondQ(x, z);
  if (q >= 1 + p.bank) return h;
  if (q < 1) {
    const bedNoise = 0.25 * (fbm2(x / 5, z / 5, COVE.seed + 6, 3) - 0.5) * (1 - q);
    return Math.min(h, wl - p.depth * Math.pow(1 - q, 0.7) + bedNoise);
  }
  return lerp(wl, h, smoothstep(1, 1 + p.bank, q));
}

let gullyEnd = null;
function carveGully(h, x, z) {
  const g = COVE.gully;
  const { along, lateral } = rayFrame(x, z, g.azimuth);
  if (along < g.rStart - g.blend) return h;
  if (gullyEnd === null) {
    const [ux, uz] = azimuthDir(g.azimuth);
    gullyEnd = baseHeight(ux * g.rEnd, uz * g.rEnd);
  }
  const s = smoothstep(g.rStart, g.rEnd, along);
  const halfW = lerp(g.halfWidthIn, g.halfWidthOut, s);
  const w = smoothstep(halfW, halfW + g.blend, lateral); // 0 in the channel, 1 outside it
  if (w >= 1) return h;
  // ease-in rise: flat where it opens into the hollow (lets the low sun in), steeper farther out
  const rise = Math.pow(clamp((along - g.rStart) / (g.rEnd - g.rStart), 0, 1), g.ease);
  const floorH = lerp(floorHeight(x, z), gullyEnd, rise) + 0.3 * (fbm2(x / 9, z / 9, COVE.seed + 7, 3) - 0.5);
  const cut = lerp(Math.min(h, floorH), h, w);
  return lerp(h, cut, smoothstep(g.rStart - g.blend, g.rStart, along));
}

/** Route A: scramble terraces — risers of `rise` over `riserRun` (> 70°) and flat treads. Null before the start. */
export function routeAProfile(along) {
  const ra = COVE.routeA;
  if (along < ra.rStart) return null;
  const i = Math.floor((along - ra.rStart) / ra.tread);
  if (i >= ra.steps) return ra.steps * ra.rise;
  const within = along - (ra.rStart + i * ra.tread);
  return (i + smoothstep(0, ra.riserRun, within)) * ra.rise;
}

let routeABase = null;
function shapeRouteA(h, x, z) {
  const ra = COVE.routeA;
  const { along, lateral } = rayFrame(x, z, ra.azimuth);
  const end = ra.rStart + ra.steps * ra.tread;
  if (along < ra.rStart - 2 || along > end + 4 || lateral > ra.halfWidth + ra.blend) return h;
  if (routeABase === null) {
    const [ux, uz] = azimuthDir(ra.azimuth);
    routeABase = floorHeight(ux * ra.rStart, uz * ra.rStart);
  }
  const stair = routeAProfile(along);
  const target = stair === null ? floorHeight(x, z) : routeABase + stair;
  const endFade = 1 - smoothstep(end, end + 4, along);
  const w = (1 - smoothstep(ra.halfWidth, ra.halfWidth + ra.blend, lateral)) * endFade;
  return lerp(h, target, w);
}

/** Route B: a climbable slope (45–70° in the middle, walkable at both ends). */
export function routeBProfile(along) {
  const rb = COVE.routeB;
  return wallHeight(rb.azimuth) * cliffCurve((along - rb.r0) / (rb.r1 - rb.r0), rb.sharpness);
}

function shapeRouteB(h, x, z) {
  const rb = COVE.routeB;
  const { along, lateral } = rayFrame(x, z, rb.azimuth);
  if (along < rb.r0 - 2 || along > rb.r1 + 2 || lateral > rb.halfWidth + rb.blend) return h;
  const target = lerp(floorHeight(x, z), routeBProfile(along), smoothstep(rb.r0 - 2, rb.r0, along));
  const w = 1 - smoothstep(rb.halfWidth, rb.halfWidth + rb.blend, lateral);
  const endFade = 1 - smoothstep(rb.r1, rb.r1 + 2, along);
  return lerp(h, target, w * endFade);
}

/** Final designed height (before erosion). */
export function coveHeight(x, z) {
  let h = baseHeight(x, z);
  h = shapeRouteB(h, x, z);
  h = shapeRouteA(h, x, z);
  h = carveGully(h, x, z);
  h = carvePond(h, x, z);
  return h;
}

/**
 * 1 where erosion may act, 0 where the designed shape must survive exactly: climb routes, the gully
 * path and the pond. The floor erodes lightly (0.3) so small channels drain toward the pond.
 */
export function erosionMask(x, z) {
  const r = Math.hypot(x, z);
  let m = r < COVE.floorRadius - 3 ? 0.3 : 1;
  const ra = rayFrame(x, z, COVE.routeA.azimuth);
  if (ra.along > COVE.routeA.rStart - 4) m *= smoothstep(COVE.routeA.halfWidth + 2, COVE.routeA.halfWidth + COVE.routeA.blend + 4, ra.lateral);
  const rb = rayFrame(x, z, COVE.routeB.azimuth);
  if (rb.along > COVE.routeB.r0 - 4) m *= smoothstep(COVE.routeB.halfWidth + 2, COVE.routeB.halfWidth + COVE.routeB.blend + 4, rb.lateral);
  const g = rayFrame(x, z, COVE.gully.azimuth);
  if (g.along > COVE.gully.rStart - 6) m *= smoothstep(COVE.gully.halfWidthOut, COVE.gully.halfWidthOut + 6, g.lateral);
  m *= smoothstep(1 + COVE.pond.bank, 1.8, pondQ(x, z));
  return m;
}

/** World (x, z) of grid sample (i, j). */
export function samplePos(i, j) {
  const g = COVE.grid;
  return [g.origin + i * g.spacing, g.origin + j * g.spacing];
}
