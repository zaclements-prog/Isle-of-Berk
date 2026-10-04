// The Cove's height as explicit shape functions (spec §7.2–7.3). World metres, +Y up, +X east, −Z north.
// Compass azimuth φ: 0° = north (−Z), 90° = east (+X) — the same convention as src/render/sun.ts.
import { fbm2, ridged2 } from './noise.mjs';
import { mulberry32 } from './rng.mjs';

export const COVE = {
  seed: 1337,
  grid: { size: 1024, spacing: 0.4, origin: -204.8 }, // sample i sits at origin + i·spacing
  heightRange: { min: -8, max: 72 }, // 16-bit quantisation range (1.2 mm steps)
  floorRadius: 35, // hollow floor ≈ 70 m across (plus the outline lobes below)
  rimRadius: 50, // rim ≈ 100 m across (plus the outline lobes below)
  sunAzimuth: 292, // GOLDEN_HOUR: walls are lowest toward the sun and the gully opens there
  sunElevation: 14,
  wall: { mean: 19.5, amp: 5.5, sharpness: 5, jitter: 1.6 }, // H(φ) = mean − amp·cos(φ − sun): 14–25 m
  /**
   * The hollow's irregular outline: bays (+) and noses (−) in metres, added to both ring radii.
   * - lobes: L(φ) = mean + Σ amp·cos(n·(φ − phase)) ∈ ≈ [−2.3, +7.2]; each design phase gets a seeded offset of up to
   *   ±phaseJitter/(2n)°. Designed for three bays — ≈ +6.9 m east-south-east right behind the pond (127°), +6 m
   *   north-east (55°), +5 m south (201°) — between noses that jut in by 0.8–2.1 m (20°, 91°, 166°).
   * - taper w(φ): 0 within ±inner° of the gully and both routes, 1 beyond ±outer°, so their geometry never moves.
   * - run k(φ) = 1 + Σ amp·cos(n·(φ − phase)), phases jittered the same way: the rim takes L·k, so the wall run
   *   rr − rf = 15 + w·L·(k − 1) spans ≈ 12.6–17.2 m — a sheer north-east bay, gentler walls behind the pond and south.
   */
  outline: {
    lobes: { mean: 2.4, harmonics: [[2, 0.67, 81.5], [3, 0.89, 13.7], [5, 3.68, 55.1]] },
    run: { harmonics: [[1, 0.36, 187.4], [3, 0.16, 1.9]] },
    phaseJitter: 12,
    taper: { azimuths: [292, 330, 250], inner: 20, outer: 35 },
  },
  water: { level: -0.45 },
  pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5, bank: 0.4 }, // ≈ 35 × 25 m, 2.5 m deep
  gully: { azimuth: 292, rStart: 30, rEnd: 110, halfWidthIn: 8, halfWidthOut: 13, blend: 8, ease: 1.6 },
  /**
   * Each gully side wall moves OUTWARD by its own seeded wiggle(along) ∈ [0, max] m (so the walls stop being
   * parallel); the straight channel of half-width halfW(along) never narrows. Two sines per side, wavelengths drawn
   * from [min, max] m, weights summing to 0.5 around a 0.5 mean.
   */
  gullyWiggle: { max: 4, waves: [{ min: 18, max: 25, weight: 0.3 }, { min: 13, max: 17, weight: 0.2 }] },
  routeA: { azimuth: 330, rStart: 29, steps: 7, tread: 3.0, rise: 2.2, riserRun: 0.3, halfWidth: 3.5, blend: 3 },
  /**
   * Route A as rough ledges (routeASteps): per-step tread ∈ tread[] m and rise ∈ rise[] m, summing to steps·tread and
   * steps·rise so the flight ends where and as high as before. Each riser bows riserBow·(lateral/halfWidth)² m outward
   * across the route, and each tread tilts across it by up to ±maxTilt°, limited so no riser anywhere on the flat
   * ledges exceeds maxRiser (tread ≥ 2.9 keeps every flat tread ≥ 2.5 m deep past the 0.3 m riser run). Each ledge
   * also reaches OUTWARD past the route's halfWidth by its own seeded sideExtra[] m on each side, so the flight reads
   * as uneven shelves; the straight halfWidth strip (the corridor) never narrows.
   */
  ledges: { tread: [2.9, 3.4], rise: [1.8, 2.3], maxRiser: 2.3, maxTilt: 4, riserBow: 0.5, sideExtra: [0, 2.2] },
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

/** rayFrame's lateral with its sign: > 0 on the left of the ray looking outward along it, < 0 on the right. */
export function signedLateral(x, z, deg) {
  const [ux, uz] = azimuthDir(deg);
  return x * uz - z * ux;
}

/** Smallest angle between two compass azimuths, in degrees [0, 180]. */
const angDist = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const round = (v, digits) => +v.toFixed(digits);

/** The outline parameters with their seeded phases resolved (written to the header as `outline`). */
function resolveOutline() {
  const o = COVE.outline;
  const rng = mulberry32(COVE.seed + 31);
  const jitter = ([n, amp, phase]) => ({ n, amp, phase: round(phase + ((rng() - 0.5) * o.phaseJitter) / n, 2) });
  const lobes = o.lobes.harmonics.map(jitter);
  const run = o.run.harmonics.map(jitter);
  return { mean: o.lobes.mean, lobes, taper: { ...o.taper }, run };
}
export const OUTLINE = resolveOutline();

/** w(φ): 0 within ±inner° of the gully and both routes, 1 beyond ±outer°, smooth in between. */
export function lobeTaper(phiDeg) {
  const t = OUTLINE.taper;
  let w = 1;
  for (const a of t.azimuths) w = Math.min(w, smoothstep(t.inner, t.outer, angDist(phiDeg, a)));
  return w;
}

/** The tapered lobe term w(φ)·L(φ) in metres: > 0 is a bay (the wall stands further out), < 0 a nose. */
export function outlineLobe(phiDeg) {
  const w = lobeTaper(phiDeg);
  if (w === 0) return 0;
  let L = OUTLINE.mean;
  for (const h of OUTLINE.lobes) L += h.amp * Math.cos(h.n * (phiDeg - h.phase) * DEG);
  return w * L;
}

/** k(φ): the rim moves by the lobe × k, so the wall run rr − rf = (rimRadius − floorRadius) + lobe·(k − 1). */
export function wallRunFactor(phiDeg) {
  let k = 1;
  for (const h of OUTLINE.run) k += h.amp * Math.cos(h.n * (phiDeg - h.phase) * DEG);
  return k;
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

/** Local ring radii at azimuth φ: rf where the wall leaves the floor, rr where it reaches the rim. */
export function ringRadii(phiDeg) {
  const j = ringJitter(phiDeg);
  const lobe = outlineLobe(phiDeg);
  return { rf: COVE.floorRadius + j + lobe, rr: COVE.rimRadius + j + lobe * wallRunFactor(phiDeg) };
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
  const { rf, rr } = ringRadii(phi);
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

/** The gully wiggle with its seeded wavelengths and phases resolved (written to the header as `gullyWiggle`). */
function resolveGullyWiggle() {
  const gw = COVE.gullyWiggle;
  const rng = mulberry32(COVE.seed + 33);
  const side = () => gw.waves.map((w) => ({ wavelength: round(w.min + (w.max - w.min) * rng(), 2), phase: round(rng() * 360, 2), weight: w.weight }));
  return { max: gw.max, left: side(), right: side() };
}
export const GULLY_WIGGLE = resolveGullyWiggle();

/**
 * How far one gully side wall stands OUTWARD of the straight channel edge at distance `along` from the Cove centre,
 * in [0, gullyWiggle.max] m. side > 0: the left wall looking out along the gully (signedLateral > 0); side < 0: the right.
 */
export function gullyWiggle(along, side) {
  const waves = side > 0 ? GULLY_WIGGLE.left : GULLY_WIGGLE.right;
  let s = 0.5;
  for (const w of waves) s += w.weight * Math.sin((2 * Math.PI * along) / w.wavelength + w.phase * DEG);
  return GULLY_WIGGLE.max * s;
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
  // the straight channel (halfW) plus this side's outward wiggle: the floor widens into it, never narrows
  const halfW = lerp(g.halfWidthIn, g.halfWidthOut, s) + gullyWiggle(along, signedLateral(x, z, g.azimuth));
  const w = smoothstep(halfW, halfW + g.blend, lateral); // 0 in the channel, 1 outside it
  if (w >= 1) return h;
  // ease-in rise: flat where it opens into the hollow (lets the low sun in), steeper farther out
  const rise = Math.pow(clamp((along - g.rStart) / (g.rEnd - g.rStart), 0, 1), g.ease);
  const floorH = lerp(floorHeight(x, z), gullyEnd, rise) + 0.3 * (fbm2(x / 9, z / 9, COVE.seed + 7, 3) - 0.5);
  const cut = lerp(Math.min(h, floorH), h, w);
  return lerp(h, cut, smoothstep(g.rStart - g.blend, g.rStart, along));
}

/**
 * Splits `total` into `n` parts in [lo, hi]: every part starts at the bound with less slack to share, and that slack
 * goes out in seeded shares (draws to the 5th power: a few clearly different steps, the rest near the bound), none past
 * the other bound. Parts are rounded to the millimetre; the part furthest from both bounds takes the rounding
 * remainder, so they sum to `total`.
 */
function splitTotal(total, n, lo, hi, rng) {
  const aboveLo = total - n * lo;
  const belowHi = n * hi - total;
  const fromLo = aboveLo <= belowHi;
  const slack = fromLo ? aboveLo : belowHi;
  const share = Array.from({ length: n }, () => rng() ** 5);
  const cap = hi - lo;
  const extra = new Array(n).fill(0);
  let left = slack;
  for (let pass = 0; pass < n && left > 1e-9; pass++) {
    let open = 0;
    for (let i = 0; i < n; i++) if (extra[i] < cap) open += share[i];
    if (open <= 0) break;
    const give = left;
    for (let i = 0; i < n; i++) {
      if (extra[i] >= cap) continue;
      const add = Math.min(cap - extra[i], (give * share[i]) / open);
      extra[i] += add;
      left -= add;
    }
  }
  const parts = extra.map((e) => round(fromLo ? lo + e : hi - e, 3));
  const room = (v) => Math.min(v - lo, hi - v);
  let k = 0;
  for (let i = 1; i < n; i++) if (room(parts[i]) > room(parts[k])) k = i;
  parts[k] = round(parts[k] + total - parts.reduce((a, b) => a + b, 0), 3);
  return parts;
}

/**
 * Route A's seeded ledge table (written to the header as `routeASteps`): per step the riser's `start` (along the
 * centreline), `tread` (distance to the next riser), `rise`, the tread's `tilt` across the route (degrees, + raises
 * the left side) and how far the ledge reaches past halfWidth on its `left` and `right` (m, outward). A riser's height
 * at lateral l is rise + (tan tilt − tan previous tilt)·l, so each tilt changes by at most what keeps that riser
 * ≤ ledges.maxRiser across both ledges' full flat width; the cant swings back and forth where it can.
 */
function resolveRouteASteps() {
  const ra = COVE.routeA;
  const L = COVE.ledges;
  const rng = mulberry32(COVE.seed + 34);
  const treads = splitTotal(ra.steps * ra.tread, ra.steps, L.tread[0], L.tread[1], rng);
  const rises = splitTotal(ra.steps * ra.rise, ra.steps, L.rise[0], L.rise[1], rng);
  const extra = () => round(L.sideExtra[0] + (L.sideExtra[1] - L.sideExtra[0]) * rng(), 2);
  const sides = rises.map(() => ({ left: extra(), right: extra() }));
  const tMax = Math.tan(L.maxTilt * DEG);
  const steps = [];
  let start = ra.rStart;
  let prevTan = 0; // the floor before the first riser is level
  let prevReach = ra.halfWidth; // ... and at least as wide as the route
  for (let i = 0; i < ra.steps; i++) {
    const reach = ra.halfWidth + Math.max(sides[i].left, sides[i].right);
    const dMax = Math.max(0, L.maxRiser - rises[i] - 0.01) / Math.max(reach, prevReach); // 1 cm: the tilt's 0.01° rounding
    const sign = prevTan > 1e-9 ? -1 : prevTan < -1e-9 ? 1 : rng() < 0.5 ? -1 : 1; // swing the cant the other way
    const target = Math.max(-tMax, Math.min(tMax, prevTan + sign * dMax * (0.6 + 0.4 * rng())));
    const tilt = round(Math.atan(target) / DEG, 2);
    prevTan = Math.tan(tilt * DEG);
    prevReach = reach;
    steps.push({ start: round(start, 3), tread: treads[i], rise: rises[i], tilt, ...sides[i] });
    start += treads[i];
  }
  return steps;
}
const ROUTE_A_STEPS = resolveRouteASteps();

/** Route A's ledge table (a fresh copy): [{ start, tread, rise, tilt, left, right }] per step, bottom to top. */
export function routeASteps() {
  return ROUTE_A_STEPS.map((s) => ({ ...s }));
}

/** Along-distance from route A's first riser at signed lateral `lateral` (< 0 before it): risers bow outward across it. */
function routeAWithin(along, lateral) {
  return along - COVE.ledges.riserBow * (lateral / COVE.routeA.halfWidth) ** 2 - COVE.routeA.rStart;
}

/**
 * The ledge under (`along`, signed `lateral`): `stair`, its surface above route A's base (null before the first riser),
 * and `reach`, how far from the centreline that ledge stays flat on this side (halfWidth + the step's left/right).
 * Both change across each riser over riserRun, the riser line bowed riserBow·(lateral/halfWidth)² m outward.
 */
function routeALedge(along, lateral) {
  const ra = COVE.routeA;
  const a = ra.rStart + routeAWithin(along, lateral);
  if (a < ra.rStart) return { stair: null, reach: ra.halfWidth };
  let below = 0; // the previous tread's surface at this lateral (the level floor before the first riser)
  let reachBelow = ra.halfWidth;
  let top = 0; // centreline height of the current tread
  for (const s of ROUTE_A_STEPS) {
    if (a < s.start) break;
    top += s.rise;
    const surface = top + Math.tan(s.tilt * DEG) * lateral;
    const reach = ra.halfWidth + (lateral >= 0 ? s.left : s.right);
    const within = a - s.start;
    if (within < ra.riserRun) {
      const t = smoothstep(0, ra.riserRun, within);
      return { stair: lerp(below, surface, t), reach: lerp(reachBelow, reach, t) };
    }
    below = surface;
    reachBelow = reach;
  }
  return { stair: below, reach: reachBelow };
}

/**
 * Route A's ledge surface above its base at (`along`, `lateral` signed as signedLateral): risers of each step's `rise`
 * over `riserRun` (> 70°), bowed riserBow·(lateral/halfWidth)² m outward across the route, between flat treads tilted
 * across it. Null before the first riser.
 */
export function routeAStair(along, lateral = 0) {
  return routeALedge(along, lateral).stair;
}

/** Route A's profile along its centreline (lateral 0): the step table's risers and flat treads. Null before the start. */
export function routeAProfile(along) {
  return routeAStair(along, 0);
}

let routeABase = null;
function shapeRouteA(h, x, z) {
  const ra = COVE.routeA;
  const { along, lateral } = rayFrame(x, z, ra.azimuth);
  const end = ra.rStart + ra.steps * ra.tread;
  const L = COVE.ledges;
  if (along < ra.rStart - 2 || along > end + 4 || lateral > ra.halfWidth + L.sideExtra[1] + ra.blend) return h;
  if (routeABase === null) {
    const [ux, uz] = azimuthDir(ra.azimuth);
    routeABase = floorHeight(ux * ra.rStart, uz * ra.rStart);
  }
  const side = signedLateral(x, z, ra.azimuth);
  const { stair, reach } = routeALedge(along, side);
  // before the first riser the floor levels out to the flight's base over 2 m, so every riser is exactly its table rise
  const landing = () => lerp(floorHeight(x, z), routeABase, smoothstep(-2, 0, routeAWithin(along, side)));
  const target = stair === null ? landing() : routeABase + stair;
  const endFade = 1 - smoothstep(end, end + 4, along);
  const w = (1 - smoothstep(reach, reach + ra.blend, lateral)) * endFade; // each ledge blends into the wall past its reach
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
  let m = r < ringRadii(azimuthDeg(x, z)).rf - 3 ? 0.3 : 1; // the floor, bays included
  const ra = rayFrame(x, z, COVE.routeA.azimuth);
  if (ra.along > COVE.routeA.rStart - 4) {
    const reach = routeALedge(ra.along, signedLateral(x, z, COVE.routeA.azimuth)).reach; // each ledge's own width
    m *= smoothstep(reach + 2, reach + COVE.routeA.blend + 4, ra.lateral);
  }
  const rb = rayFrame(x, z, COVE.routeB.azimuth);
  if (rb.along > COVE.routeB.r0 - 4) m *= smoothstep(COVE.routeB.halfWidth + 2, COVE.routeB.halfWidth + COVE.routeB.blend + 4, rb.lateral);
  const g = rayFrame(x, z, COVE.gully.azimuth);
  if (g.along > COVE.gully.rStart - 6) {
    const edge = COVE.gully.halfWidthOut + gullyWiggle(g.along, signedLateral(x, z, COVE.gully.azimuth)); // follows the wiggled wall
    m *= smoothstep(edge, edge + 6, g.lateral);
  }
  m *= smoothstep(1 + COVE.pond.bank, 1.8, pondQ(x, z));
  return m;
}

/** World (x, z) of grid sample (i, j). */
export function samplePos(i, j) {
  const g = COVE.grid;
  return [g.origin + i * g.spacing, g.origin + j * g.spacing];
}
