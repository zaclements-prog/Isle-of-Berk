import * as THREE from 'three';
import { geometryTriangles } from '../collision';
import { longhouseParts, pierParts, type Structure } from '../damage/structures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/rng';
import type { Heightfield } from '../terrain/heightfield';

/** A house from the bake: centre on its terrace, ground height, yaw (its long axis), length and width (m). */
export interface HousePlacement { x: number; z: number; y: number; yaw: number; len: number; wid: number; terrace: number }
export interface DockPlacement { x: number; z: number; yaw: number; len: number; width: number; deck: number }
export interface BerkSites {
  houses: HousePlacement[];
  docks: DockPlacement[];
  hall: { x: number; z: number; height: number; yaw: number };
  killRing: { x: number; z: number; r: number; depth: number; rim: number };
  harbour: { inner: { x: number; z: number } };
}

const WOOD = new THREE.Color(0x8a6440);
const WOOD_DARK = new THREE.Color(0x5a3e28);
const ROOF = new THREE.Color(0x6e3b26);
const ROOF_ALT = new THREE.Color(0x4f5d34);
const STONE = new THREE.Color(0x6f6c66);
const IRON = new THREE.Color(0x2b2a2a);

function paint(g: THREE.BufferGeometry, c: THREE.Color, jitter: number, rnd: () => number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v += 3) {
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let w = 0; w < 3; w++) {
      col[(v + w) * 3] = c.r * k;
      col[(v + w) * 3 + 1] = c.g * k;
      col[(v + w) * 3 + 2] = c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * A Viking longhouse of unit footprint (length 1 along x, width 1 along z) standing on y = 0: plank walls 3 m high, a
 * steep roof overhanging the walls with its ridge 4.8 m above them, crossed gable boards (the carved dragon-head ends)
 * and a dark door in one gable. Scaled by (length, 1, width) per house; `roofColor` picks turf or shingle.
 */
export function longhouseGeometry(roofColor: THREE.Color, seed = 5): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.BoxGeometry(1, 3, 1).translate(0, 1.5, 0), WOOD, 0.25, rnd));
  // the roof: a prism over the walls (two sloping slabs), overhanging the long sides and the gables
  const ridge = 4.8;
  const shape = new THREE.Shape();
  shape.moveTo(-0.62, 0);
  shape.lineTo(0, ridge);
  shape.lineTo(0.62, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, ridge - 0.5);
  shape.lineTo(-0.5, 0);
  shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: 1.12, bevelEnabled: false }).translate(0, 0, -0.56).rotateY(Math.PI / 2).translate(0, 2.9, 0);
  parts.push(paint(roof, roofColor, 0.3, rnd));
  // gable infill under the roof (the triangle above the end walls)
  const gable = new THREE.Shape();
  gable.moveTo(-0.5, 0);
  gable.lineTo(0, ridge - 0.5);
  gable.lineTo(0.5, 0);
  gable.closePath();
  for (const end of [-0.5, 0.5]) {
    const g = new THREE.ShapeGeometry(gable).rotateY(Math.PI / 2).translate(end, 2.95, 0);
    parts.push(paint(g, WOOD_DARK, 0.2, rnd));
    // crossed gable boards rising past the ridge
    for (const s of [-1, 1]) {
      const board = new THREE.BoxGeometry(0.06, 1.6, 0.06).rotateX(s * 0.55).translate(end * 1.06, 2.9 + ridge + 0.35, s * 0.06);
      parts.push(paint(board, WOOD_DARK, 0.1, rnd));
    }
  }
  parts.push(paint(new THREE.BoxGeometry(0.02, 2.0, 0.22).translate(0.505, 1.0, 0), new THREE.Color(0x231710), 0.05, rnd));
  const out = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  out.computeVertexNormals();
  return out;
}

/** A pier: a plank deck on two rows of posts, length along +z from its root, width along x, deck top at y = 0. */
export function pierGeometry(len: number, width: number, seed = 9): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let z = 0; z < len; z += 1.1) {
    parts.push(paint(new THREE.BoxGeometry(width, 0.18, 1.0).translate(0, -0.09, z + 0.55), WOOD, 0.3, rnd));
  }
  for (let z = 0.4; z < len; z += 3.2) {
    for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) parts.push(paint(new THREE.CylinderGeometry(0.16, 0.18, 6, 6).translate(x, -3, z), WOOD_DARK, 0.2, rnd));
  }
  const out = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  out.computeVertexNormals();
  return out;
}

/** The Kill Ring's furniture: a stone kerb round the pit's rim and a dome of iron chain arcs over it (y = rim). */
export function killRingGeometry(r: number, seed = 13): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const blocks = Math.round((2 * Math.PI * r) / 2.2);
  for (let k = 0; k < blocks; k++) {
    const a = (k / blocks) * Math.PI * 2;
    const b = new THREE.BoxGeometry(2.0, 1.1 + rnd() * 0.4, 1.2).translate(0, 0.5, 0).rotateY(-a).translate(Math.cos(a) * (r + 0.6), 0, Math.sin(a) * (r + 0.6));
    parts.push(paint(b, STONE, 0.3, rnd));
  }
  // the chain dome: half-arcs from rim to rim through the crown, and two rings round it
  const H = r * 0.55;
  const arc = (a: number) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 24; k++) {
      const t = (k / 24) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(t) * r * Math.cos(a), Math.sin(t) * H, Math.cos(t) * r * Math.sin(a)));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.12, 4, false);
  };
  for (let k = 0; k < 6; k++) parts.push(paint(arc((k / 6) * Math.PI), IRON, 0.1, rnd));
  for (const f of [0.45, 0.8]) {
    const rr = r * Math.cos(Math.asin(f));
    parts.push(paint(new THREE.TorusGeometry(rr, 0.11, 4, 64).rotateX(Math.PI / 2).translate(0, f * H, 0), IRON, 0.1, rnd));
  }
  const out = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  out.computeVertexNormals();
  return out;
}

export interface BerkLandmarks {
  root: THREE.Group;
  collision: THREE.Object3D[];
  /** Each house, the hall and each pier deck on its own (world-space triangles), for a dynamic collision set. */
  structures: { key: string; positions: Float32Array }[];
  /** The same structures as breakable ones (hit points, pre-fractured parts, how they show damage). */
  breakables: Structure[];
  dispose(): void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const CHAR = new THREE.Color(0.18, 0.15, 0.13);

/** A house's padded footprint as a 2-D box (centre, unit axes, half extents), for overlap tests. */
function footprint(h: HousePlacement, margin: number) {
  const c = Math.cos(h.yaw);
  const sn = Math.sin(h.yaw);
  return { x: h.x, z: h.z, ax: [c, -sn], az: [sn, c], hx: h.len / 2 + margin, hz: h.wid / 2 + margin };
}

/** Do two oriented boxes overlap (separating axes)? */
function overlaps(a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>): boolean {
  const d = [b.x - a.x, b.z - a.z];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1];
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const ra = a.hx * Math.abs(dot(a.ax, axis)) + a.hz * Math.abs(dot(a.az, axis));
    const rb = b.hx * Math.abs(dot(b.ax, axis)) + b.hz * Math.abs(dot(b.az, axis));
    if (Math.abs(dot(d, axis)) > ra + rb) return false;
  }
  return true;
}

/** Each house's pad height: the ground under its centre, or the mean of those over a group whose walls overlap. */
function sharedPadHeights(hf: Heightfield, houses: HousePlacement[]): number[] {
  const parent = houses.map((_, k) => k);
  const root = (k: number): number => (parent[k] === k ? k : (parent[k] = root(parent[k])));
  const boxes = houses.map((h) => footprint(h, 0));
  for (let a = 0; a < houses.length; a++) {
    for (let b = a + 1; b < houses.length; b++) if (overlaps(boxes[a], boxes[b])) parent[root(b)] = root(a);
  }
  const sum = new Map<number, [number, number]>();
  const ground = houses.map((h) => hf.heightAt(h.x, h.z));
  ground.forEach((y, k) => {
    const s = sum.get(root(k)) ?? [0, 0];
    sum.set(root(k), [s[0] + y, s[1] + 1]);
  });
  return houses.map((_, k) => {
    const [y, n] = sum.get(root(k))!;
    return y / n;
  });
}

/**
 * Level a pad under each house before anything reads the ground (terrain, collision, grass, trees, water). The bake's
 * house heights can sit metres off the eroded slope: houses half buried uphill and floating downhill, and wall debris
 * spawned inside the hill fell through it. Each pad is flat at the ground under the house's centre over its footprint
 * plus `margin`, then eases back to the slope over a skirt that widens with the cut or fill. Sets each house's `y` to
 * its pad. Returns the largest cut or fill (m), for the log.
 */
export function levelHousePads(hf: Heightfield, houses: HousePlacement[], margin = 0.8): number {
  // two passes so neighbours' skirts never bend each other's pads: first each sample's strongest pad (1…2 on a
  // footprint), then one blend
  const weight = new Map<number, number>();
  const target = new Map<number, number>();
  // houses whose walls overlap (the bake can crowd a steep terrace) share one pad at their mean ground height: two
  // pads can't both hold the same ground (houses merely close split the margin between them, below)
  const padY = sharedPadHeights(hf, houses);
  let worst = 0;
  for (const [n, h] of houses.entries()) {
    const y = padY[n];
    const c = Math.cos(h.yaw);
    const sn = Math.sin(h.yaw);
    const hx = h.len / 2 + margin;
    const hz = h.wid / 2 + margin;
    let drop = 0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = sx * hx;
      const lz = sz * hz;
      drop = Math.max(drop, Math.abs(hf.heightAt(h.x + lx * c + lz * sn, h.z - lx * sn + lz * c) - y));
    }
    worst = Math.max(worst, drop);
    const skirt = Math.max(4, drop * 3); // banks under about 45° on terrace ground
    const reach = Math.hypot(hx, hz) + skirt;
    const i0 = Math.max(0, Math.floor((h.x - reach - hf.origin) / hf.spacing));
    const i1 = Math.min(hf.size - 1, Math.ceil((h.x + reach - hf.origin) / hf.spacing));
    const j0 = Math.max(0, Math.floor((h.z - reach - hf.origin) / hf.spacing));
    const j1 = Math.min(hf.size - 1, Math.ceil((h.z + reach - hf.origin) / hf.spacing));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // the sample in the house's frame (its local x runs along the yaw, as the instance matrix turns it)
        const dx = hf.coord(i) - h.x;
        const dz = hf.coord(j) - h.z;
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        const out = Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz)); // 0 on the pad
        if (out >= skirt) continue;
        // on a footprint, rank by how central the sample is (1…2), so where two padded footprints overlap each house
        // keeps the ground under its own walls and the step between them falls on the midline
        const w = out > 0 ? 1 - THREE.MathUtils.smoothstep(out, 0, skirt) : 2 - Math.max(Math.abs(lx) / hx, Math.abs(lz) / hz);
        const k = j * hf.size + i;
        if (w > (weight.get(k) ?? 0)) {
          weight.set(k, w);
          target.set(k, y);
        }
      }
    }
    h.y = y;
  }
  for (const [k, w] of weight) hf.heights[k] += (target.get(k)! - hf.heights[k]) * Math.min(1, w);
  return worst;
}

/**
 * The village and its landmarks: longhouses on the terraces (two roof colours, instanced), the Great Hall on its
 * terrace (a great longhouse with a stair), piers at the harbour's head and the Kill Ring's kerb and chain dome. The
 * houses, the hall and the pier decks collide (boxes); the dome is open to a dragon.
 */
export function buildBerk(sites: BerkSites): BerkLandmarks {
  const root = new THREE.Group();
  root.name = 'Berk';
  const mat = new THREE.MeshStandardMaterial({ name: 'berk', vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
  const disposables: Array<{ dispose(): void }> = [mat];
  const boxes: THREE.BufferGeometry[] = [];
  const structures: BerkLandmarks['structures'] = [];
  const breakables: Structure[] = [];
  const tint = (m: THREE.InstancedMesh, k: number, a: number) => {
    m.setColorAt(k, _c.setRGB(1, 1, 1).lerp(CHAR, a));
    m.instanceColor!.needsUpdate = true;
  };
  const box = (key: string, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0).rotateY(yaw).translate(x, y, z);
    boxes.push(g);
    structures.push({ key, positions: geometryTriangles(g) });
  };
  for (const [v, roof] of [[0, ROOF], [1, ROOF_ALT]] as const) {
    const ids = sites.houses.flatMap((_, k) => (k % 2 === v ? [k] : []));
    const mine = ids.map((k) => sites.houses[k]);
    if (!mine.length) continue;
    const geo = longhouseGeometry(roof, 5 + v);
    disposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
    mesh.name = `houses_${v}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mine.forEach((h, k) => {
      _m.compose(_p.set(h.x, h.y - 0.2, h.z), _q.setFromAxisAngle(UP, h.yaw), _s.set(h.len, 1, h.wid));
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, _c.setRGB(1, 1, 1));
      box(`house:${ids[k]}`, h.x, h.y - 0.2, h.z, h.yaw, h.len, 3.2, h.wid);
      breakables.push({
        key: `house:${ids[k]}`, kind: 'house', base: new THREE.Vector3(h.x, h.y - 0.2, h.z), yaw: h.yaw, halfX: h.len / 2, halfZ: h.wid / 2,
        height: 7.5, hp: 100, parts: longhouseParts(h.len, h.wid, 1, WOOD, roof, h.len > 9 ? 3 : 2),
        scorch: (a) => tint(mesh, k, a * 0.8),
        hide: () => {
          mesh.setMatrixAt(k, _m.makeScale(0, 0, 0));
          mesh.instanceMatrix.needsUpdate = true;
        },
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  // the Great Hall: a great longhouse, end-on to the village, with a broad stair to its door
  const hall = sites.hall;
  const toVillage = Math.atan2(sites.harbour.inner.x - hall.x, sites.harbour.inner.z - hall.z);
  const hallGeo = longhouseGeometry(new THREE.Color(0x5b3324), 17);
  disposables.push(hallGeo);
  const hallMesh = new THREE.Mesh(hallGeo, mat);
  hallMesh.name = 'GreatHall';
  hallMesh.position.set(hall.x, hall.height - 0.3, hall.z);
  hallMesh.rotation.y = toVillage - Math.PI / 2;
  hallMesh.scale.set(30, 2.4, 15);
  hallMesh.castShadow = hallMesh.receiveShadow = true;
  root.add(hallMesh);
  box('hall', hall.x, hall.height - 0.3, hall.z, toVillage - Math.PI / 2, 30, 7.4, 15);
  const hallMat = mat.clone();
  hallMesh.material = hallMat;
  disposables.push(hallMat);
  breakables.push({
    key: 'hall', kind: 'hall', base: hallMesh.position.clone(), yaw: hallMesh.rotation.y, halfX: 15, halfZ: 7.5, height: 18, hp: 600,
    parts: longhouseParts(30, 15, 2.4, WOOD, new THREE.Color(0x5b3324), 5),
    scorch: (a) => hallMat.color.setRGB(1, 1, 1).lerp(CHAR, a * 0.8),
    hide: () => { hallMesh.visible = false; },
  });
  // piers at the harbour's head
  for (const [di, d] of sites.docks.entries()) {
    const g = pierGeometry(d.len, d.width, 9 + Math.round(d.x));
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(d.x, d.deck, d.z);
    m.rotation.y = d.yaw;
    m.castShadow = m.receiveShadow = true;
    m.name = 'pier';
    root.add(m);
    const deck = new THREE.BoxGeometry(d.width, 0.2, d.len).translate(0, -0.1, d.len / 2).rotateY(d.yaw).translate(d.x, d.deck, d.z);
    boxes.push(deck);
    structures.push({ key: `pier:${di}`, positions: geometryTriangles(deck) });
    const pierMat = mat.clone();
    m.material = pierMat;
    disposables.push(pierMat);
    breakables.push({
      key: `pier:${di}`, kind: 'pier', base: new THREE.Vector3(d.x, d.deck, d.z), yaw: d.yaw, halfX: d.width / 2, halfZ: d.len / 2,
      height: 1, hp: 120, parts: pierParts(d.len, d.width, WOOD),
      scorch: (a) => pierMat.color.setRGB(1, 1, 1).lerp(CHAR, a * 0.8),
      hide: () => { m.visible = false; },
    });
  }
  // the Kill Ring
  const kr = sites.killRing;
  const ringGeo = killRingGeometry(kr.r);
  disposables.push(ringGeo);
  const ring = new THREE.Mesh(ringGeo, mat);
  ring.name = 'KillRing';
  ring.position.set(kr.x, kr.rim, kr.z);
  ring.castShadow = ring.receiveShadow = true;
  root.add(ring);
  const collision: THREE.Object3D[] = [];
  if (boxes.length) {
    const merged = mergeGeometries(boxes.map((g) => g.toNonIndexed()), false)!;
    for (const g of boxes) g.dispose();
    const m = new THREE.Mesh(merged);
    m.name = 'berk_collision';
    m.updateMatrixWorld(true);
    collision.push(m);
    disposables.push(merged);
  }
  return {
    root,
    collision,
    structures,
    breakables,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
