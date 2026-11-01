import * as THREE from 'three';
import type { CollisionSet } from '../collision';
import { geometryTriangles } from '../collision';
import type { BlastEvent, WorldEvents } from '../events';
import type { Debris } from './debris';

/**
 * A box-shaped part a structure breaks into: local centre and half extents, a tilt about local x, its colour, its role
 * and what it rests on.
 */
export interface StructurePart {
  center: THREE.Vector3;
  half: THREE.Vector3;
  tiltX?: number;
  color: THREE.Color;
  /**
   * 'wall' (the default) and 'deck' bear the structure and are solid collision while they stand; 'roof' and 'post' are
   * drawn but not collided with (as before the structure broke open).
   */
  role?: 'wall' | 'roof' | 'deck' | 'post';
  /** Parts (indices) it rests on: once every one of them is gone it falls. None: it stands on the ground. */
  rests?: number[];
}

/** A breakable structure: where it stands, how it shows damage, and the parts it is pre-fractured into. */
export interface Structure {
  key: string;
  kind: 'house' | 'hall' | 'pier';
  /** Base point and yaw: parts are placed in this frame. */
  base: THREE.Vector3;
  yaw: number;
  /** Footprint half extents (local x, z) and height, for the blast's distance. */
  halfX: number;
  halfZ: number;
  height: number;
  hp: number;
  parts: StructurePart[];
  /** Darken it by `scorch` (0…1). */
  scorch(amount: number): void;
  /** Remove it from view (it has broken open into parts, or apart). */
  hide(): void;
}

export interface StructureTuning {
  /** Damage reach as a multiple of the blast radius, and hit points a part loses to a power-1 blast at point blank. */
  reach: number;
  damage: number;
  /** Debris launch speed (m/s) at point blank per unit power, plus an upward kick (m/s), plus a random spin (rad/s). */
  throwSpeed: number;
  lift: number;
  spin: number;
  /** Hit points of each part, by the kind of structure. */
  partHp: Record<Structure['kind'], number>;
  /**
   * The structure comes down when its bearing parts' (walls', decks') strength left — each standing one's share of its
   * hit points, a broken one none — falls below this share.
   */
  collapseAt: number;
  /** How far (rad) a part leans away from the blasts and how far (m) a roof or plank sags, just before it breaks. */
  lean: number;
  sag: number;
  /** A part's share of hit points lost before the structure shows its parts (the whole mesh hides). */
  openAt: number;
}

export const DEFAULT_STRUCTURE: StructureTuning = {
  reach: 1.4, damage: 100, throwSpeed: 9, lift: 3, spin: 4,
  partHp: { house: 55, hall: 85, pier: 70 }, collapseAt: 0.3, lean: 0.14, sag: 0.25, openAt: 0.05,
};

const CHAR = new THREE.Color(0.06, 0.05, 0.045);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

interface PartState {
  hp: number;
  readonly max: number;
  standing: boolean;
  /** Where blasts have pushed it from (local, horizontal; weighted by the damage). */
  readonly push: THREE.Vector3;
  readonly slot: number;
}

interface Live {
  readonly s: Structure;
  readonly parts: PartState[];
  /** Shown as its parts (the whole mesh hidden, collision per bearing part). */
  open: boolean;
  down: boolean;
}

const bearing = (p: StructurePart) => !p.role || p.role === 'wall' || p.role === 'deck';

/**
 * Buildings that blasts break piece by piece (world-interaction plan §4, milestone 5). Every part of a structure (wall
 * panel, roof half, plank, post) has its own hit points, and a blast takes them by its distance to that part's box
 * and its power, so the nearest wall or roof half goes first and repeated blasts chew a building down:
 * - a damaged part leans away from the blasts (a roof or plank also sags) and chars; the first real damage swaps the
 *   whole mesh for its parts (drawn as one instanced mesh) and the structure's one collision box for one per wall or
 *   deck, so a broken wall leaves an opening Toothless can walk through;
 * - a part at zero breaks loose as debris thrown away from the blast; a part whose supports (`rests`) are all gone
 *   drops; deterministic, in part order;
 * - when the bearing parts' strength falls below `collapseAt` the rest comes down at once and `collapse` is published.
 */
export class StructureDamage {
  /** The standing parts of opened structures. */
  readonly root = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly live = new Map<string, Live>();
  private readonly off: () => void;
  private rngState = 7;

  constructor(
    readonly structures: readonly Structure[],
    private readonly set: CollisionSet | null,
    private readonly debris: Debris | null,
    private readonly events: WorldEvents | null,
    private readonly t: StructureTuning = DEFAULT_STRUCTURE,
  ) {
    let slot = 0;
    for (const s of structures) {
      const max = t.partHp[s.kind];
      this.live.set(s.key, { s, open: false, down: false, parts: s.parts.map(() => ({ hp: max, max, standing: true, push: new THREE.Vector3(), slot: slot++ })) });
    }
    this.root.name = 'StructureParts';
    const mat = new THREE.MeshStandardMaterial({ name: 'structureParts', vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(partGeometry(), mat, Math.max(1, slot));
    this.mesh.name = 'structureParts';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let k = 0; k < Math.max(1, slot); k++) {
      this.mesh.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(k, _col.setRGB(1, 1, 1));
    }
    this.root.add(this.mesh);
    this.off = events?.on('blast', (e) => this.blast(e)) ?? (() => {});
  }

  /** Hit points left: the structure's, scaled by its bearing parts' strength left (0 once it has come down). */
  health(key: string): number {
    const L = this.live.get(key);
    if (!L || L.down) return 0;
    return L.s.hp * this.integrity(L);
  }

  /** Parts still standing (of a structure that hasn't come down). */
  standing(key: string): number {
    const L = this.live.get(key);
    return L && !L.down ? L.parts.filter((p) => p.standing).length : 0;
  }

  /** Whether a part is standing, and its hit points left. */
  part(key: string, i: number): { standing: boolean; hp: number } | null {
    const p = this.live.get(key)?.parts[i];
    return p ? { standing: p.standing && !this.live.get(key)!.down, hp: p.hp } : null;
  }

  get broken(): number {
    let n = 0;
    for (const L of this.live.values()) if (L.down) n++;
    return n;
  }

  private integrity(L: Live): number {
    let sum = 0;
    let n = 0;
    L.s.parts.forEach((part, i) => {
      if (!bearing(part)) return;
      n++;
      const p = L.parts[i];
      if (p.standing) sum += Math.max(0, p.hp) / p.max;
    });
    return n ? sum / n : 1;
  }

  private rnd(): number {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return this.rngState / 2147483647;
  }

  blast(e: BlastEvent): void {
    const reach = e.radius * this.t.reach;
    // the rubble already lying about is thrown about again (and lifted out of the crater's lip it may now be under)
    this.debris?.blast(e.point, e.radius, this.t.throwSpeed * 0.6 * e.power);
    for (const L of this.live.values()) {
      if (L.down) continue;
      const s = L.s;
      // a quick reject on the footprint's bounding circle
      const span = Math.hypot(s.halfX, s.halfZ) * 2 + s.height + reach;
      if (_p.subVectors(e.point, s.base).length() > span) continue;
      _qt.setFromAxisAngle(UP, -s.yaw);
      const local = _a.copy(e.point).sub(s.base).applyQuaternion(_qt);
      let hitAny = false;
      const breaking: number[] = [];
      s.parts.forEach((part, i) => {
        const st = L.parts[i];
        if (!st.standing) return;
        const d = partDistance(part, local);
        if (d > reach) return;
        const hit = this.t.damage * e.power * (1 - d / reach) ** 2;
        if (hit <= 0) return;
        hitAny = true;
        st.hp -= hit;
        _v.subVectors(part.center, local).setY(0);
        if (_v.lengthSq() > 1e-6) st.push.addScaledVector(_v.normalize(), hit);
        if (st.hp <= 0) breaking.push(i);
      });
      if (!hitAny) continue;
      s.scorch(Math.min(1, 1 - this.integrity(L)));
      if (!L.open && (breaking.length || L.parts.some((p) => 1 - p.hp / p.max >= this.t.openAt))) this.open(L);
      for (const i of breaking) this.breakPart(L, i, e, true);
      this.dropUnsupported(L, e);
      if (this.integrity(L) < this.t.collapseAt) this.collapse(L, e);
      else if (L.open) this.refresh(L);
    }
  }

  /** Swap the whole mesh and its collision box for its parts. */
  private open(L: Live): void {
    L.open = true;
    L.s.hide();
    this.set?.remove(L.s.key);
    this.refresh(L);
  }

  /** Redraw the standing parts at their damaged poses, and their collision with them. */
  private refresh(L: Live): void {
    L.s.parts.forEach((part, i) => {
      const st = L.parts[i];
      if (!st.standing) return;
      this.pose(L, i, _p, _q);
      this.mesh.setMatrixAt(st.slot, _m.compose(_p, _q, _s.copy(part.half).multiplyScalar(2)));
      const frac = Math.min(1, Math.max(0, 1 - st.hp / st.max));
      this.mesh.setColorAt(st.slot, _col.copy(part.color).lerp(CHAR, frac * 0.7));
      if (this.set && bearing(part)) {
        const g = new THREE.BoxGeometry(part.half.x * 2, part.half.y * 2, part.half.z * 2);
        g.applyMatrix4(_m.compose(_p, _q, _s.set(1, 1, 1)));
        this.set.add(partKey(L.s.key, i), geometryTriangles(g));
        g.dispose();
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * A part's world pose: its place in the structure, leaned away from the blasts that hit it about its foot (and
   * sagged down, for a roof or a plank) by how damaged it is.
   */
  private pose(L: Live, i: number, pos: THREE.Vector3, q: THREE.Quaternion): void {
    const s = L.s;
    const part = s.parts[i];
    const st = L.parts[i];
    const frac = Math.min(1, Math.max(0, 1 - st.hp / st.max));
    const tilt = part.tiltX ? new THREE.Quaternion().setFromAxisAngle(X, part.tiltX) : new THREE.Quaternion();
    const lean = new THREE.Quaternion();
    pos.copy(part.center);
    if (frac > 0 && st.push.lengthSq() > 1e-9) {
      const d = _w.copy(st.push).normalize();
      lean.setFromAxisAngle(_v.set(d.z, 0, -d.x), this.t.lean * frac);
      // about its foot: the bottom of its vertical extent under its centre
      const ext = Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(tilt).y * part.half.y) + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(tilt).y * part.half.z);
      const pivot = _v.set(part.center.x, part.center.y - ext, part.center.z);
      pos.sub(pivot).applyQuaternion(lean).add(pivot);
    }
    if (part.role === 'roof' || part.role === 'deck') pos.y -= this.t.sag * frac * frac;
    _qt.setFromAxisAngle(UP, s.yaw);
    pos.applyQuaternion(_qt).add(s.base);
    q.copy(_qt).multiply(lean).multiply(tilt);
  }

  /** A part leaves the structure as debris: thrown away from the blast, or (no blast push) dropping where it was. */
  private breakPart(L: Live, i: number, e: BlastEvent, thrown: boolean): void {
    const st = L.parts[i];
    if (!st.standing) return;
    const part = L.s.parts[i];
    this.pose(L, i, _p, _q);
    st.standing = false;
    this.set?.remove(partKey(L.s.key, i));
    this.mesh.setMatrixAt(st.slot, _m.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    const reach = e.radius * this.t.reach;
    if (thrown) {
      _v.subVectors(_p, e.point);
      const d = Math.max(0.5, _v.length());
      const speed = this.t.throwSpeed * e.power * Math.max(0.15, 1 - d / (reach * 1.5));
      _v.divideScalar(d).multiplyScalar(speed);
      _v.y += this.t.lift * (0.5 + this.rnd()) * e.power;
      _w.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(2 * this.t.spin * Math.min(1, e.power));
    } else {
      // it lost what held it up: it drops, tipping a little the way it leaned
      _v.copy(st.push).normalize().applyAxisAngle(UP, L.s.yaw).multiplyScalar(0.6);
      _v.y = -0.5;
      _w.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(0.8);
    }
    _col.copy(part.color).lerp(CHAR, Math.min(1, Math.max(0.3, 1 - st.hp / st.max)) * 0.7);
    this.debris?.spawn(_p, _q, part.half, _col, _v, _w);
  }

  /** Drop every standing part whose supports are all gone (repeatedly: what rested on it goes next). */
  private dropUnsupported(L: Live, e: BlastEvent): void {
    for (let changed = true; changed;) {
      changed = false;
      L.s.parts.forEach((part, i) => {
        if (!L.parts[i].standing || !part.rests?.length) return;
        if (part.rests.some((k) => L.parts[k]?.standing)) return;
        this.breakPart(L, i, e, false);
        changed = true;
      });
    }
  }

  private collapse(L: Live, e: BlastEvent): void {
    const s = L.s;
    L.down = true;
    this.set?.remove(s.key);
    s.hide();
    for (let i = 0; i < s.parts.length; i++) this.breakPart(L, i, e, true);
    s.scorch(1);
    this.events?.emit({ type: 'collapse', key: s.key, point: s.base.clone(), time: e.time });
  }

  dispose(): void {
    this.off();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

const partKey = (key: string, i: number) => `${key}#${i}`;

/** Distance from a point (structure-local) to a part's box (tilted about x). */
function partDistance(part: StructurePart, local: THREE.Vector3): number {
  const l = _w.subVectors(local, part.center);
  if (part.tiltX) l.applyAxisAngle(X, -part.tiltX);
  const dx = Math.max(0, Math.abs(l.x) - part.half.x);
  const dy = Math.max(0, Math.abs(l.y) - part.half.y);
  const dz = Math.max(0, Math.abs(l.z) - part.half.z);
  return Math.hypot(dx, dy, dz);
}

/** A unit box with a little per-face shade (the village's flat-shaded, hand-painted look), white for instance colour. */
function partGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  let seed = 11;
  for (let v = 0; v < n; v += 6) {
    seed = (seed * 16807) % 2147483647;
    const k = 0.88 + 0.24 * (seed / 2147483647);
    for (let w = 0; w < 6 * 3; w++) col[v * 3 + w] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * A longhouse's pre-fractured parts in its own frame (x along its length, z across, y up from the floor): wall panels
 * (each long wall in `segs` pieces), the two end walls and the roof in halves along each slope, `segs` pieces each,
 * every roof piece resting on the long-wall panels under its eave. `sy` stretches it up (the Great Hall); the sizes
 * follow longhouseGeometry.
 */
export function longhouseParts(len: number, wid: number, sy: number, wall: THREE.Color, roof: THREE.Color, segs = 2): StructurePart[] {
  const parts: StructurePart[] = [];
  const h = 3 * sy;
  const t = 0.18 + 0.02 * sy;
  const longWalls = new Map<number, { i: number; x0: number; x1: number }[]>();
  for (const side of [-1, 1]) {
    const mine: { i: number; x0: number; x1: number }[] = [];
    for (let k = 0; k < segs; k++) {
      const x = -len / 2 + (k + 0.5) * (len / segs);
      mine.push({ i: parts.length, x0: x - len / segs / 2, x1: x + len / segs / 2 });
      parts.push({ center: new THREE.Vector3(x, h / 2, side * (wid / 2 - t)), half: new THREE.Vector3(len / segs / 2, h / 2, t), color: wall, role: 'wall' });
    }
    longWalls.set(side, mine);
    parts.push({ center: new THREE.Vector3(side * (len / 2 - t), h / 2, 0), half: new THREE.Vector3(t, h / 2, wid / 2 - 2 * t), color: wall, role: 'wall' });
  }
  // the roof: from the wall tops (2.9) to the ridge 4.8 higher, over 0.56 of the width each side
  const rise = 4.8 * sy;
  const run = 0.56 * wid;
  const slope = Math.hypot(rise, run);
  const tilt = Math.atan2(rise, run);
  for (const side of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const w = (len * 1.06) / segs;
      const x = -len * 0.53 + (k + 0.5) * w;
      const rests = longWalls.get(side)!.filter((lw) => Math.min(lw.x1, x + w / 2) - Math.max(lw.x0, x - w / 2) > 0.25 * w).map((lw) => lw.i);
      parts.push({
        center: new THREE.Vector3(x, 2.9 * sy + rise / 2, side * run / 2), half: new THREE.Vector3(w / 2, 0.12 + 0.03 * sy, slope / 2),
        tiltX: side * tilt, color: roof, role: 'roof', rests,
      });
    }
  }
  return parts;
}

/**
 * A pier's parts in its frame (z along its length from the shore end, y the deck top): deck planks about 2 m long,
 * each resting on the posts within reach of it, and the posts in two rows (as pierGeometry) standing 6 m down.
 */
export function pierParts(len: number, width: number, wood: THREE.Color, post = wood.clone().multiplyScalar(0.65)): StructurePart[] {
  const n = Math.max(1, Math.round(len / 2));
  const seg = len / n;
  const posts: StructurePart[] = [];
  for (let z = 0.4; z < len; z += 3.2) {
    for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) posts.push({ center: new THREE.Vector3(x, -3, z), half: new THREE.Vector3(0.17, 3, 0.17), color: post, role: 'post' });
  }
  const planks: StructurePart[] = Array.from({ length: n }, (_, k) => {
    const z = (k + 0.5) * seg;
    const rests = posts.flatMap((p, j) => (Math.abs(p.center.z - z) <= seg / 2 + 1.7 ? [n + j] : []));
    return { center: new THREE.Vector3(0, -0.1, z), half: new THREE.Vector3(width / 2, 0.1, seg / 2), color: wood, role: 'deck' as const, rests };
  });
  return [...planks, ...posts];
}
