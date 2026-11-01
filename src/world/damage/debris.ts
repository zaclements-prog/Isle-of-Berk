import * as THREE from 'three';
import type { CollisionSet, CollisionWorld } from '../collision';
import { geometryTriangles } from '../collision';

export interface DebrisTuning {
  gravity: number;
  /** Bounce (0…1) and Coulomb friction at contacts. */
  restitution: number;
  friction: number;
  /** Air drag (1/s) on linear and angular velocity. */
  drag: number;
  /** A piece slower than this (m/s and rad/s) for `sleepTime` s goes to sleep and becomes static collision. */
  sleepSpeed: number;
  sleepTime: number;
  /** Most pieces moving at once (the oldest is put to sleep beyond it) and most kept in all (the oldest are removed). */
  maxActive: number;
  maxPieces: number;
  /**
   * A piece still awake after this long (s) and slower than 2 m/s is put to sleep anyway: moving pieces don't collide
   * with each other, so one can be left inside rubble that settled around it and jitter there for ever.
   */
  maxAwake: number;
  /** Moving pieces collide with each other (spatial-hash broad phase, points-against-box contacts). */
  pairs: boolean;
}

/**
 * What the debris needs of the world beyond its collision. `ground` is a floor no corner may end below, whatever the
 * contacts missed (a piece spawned inside a hill, or tunnelling a seam). `water` is the surface height at (x, z), or
 * -Infinity where there's none: wood floats there, half under, instead of sinking to the seabed.
 */
export interface DebrisWorld {
  ground?: (x: number, z: number) => number;
  water?: (x: number, z: number) => number;
  /**
   * A piece has just entered the water: where it broke the surface (at the water's level), how fast it was going
   * (m/s) and its mass (kg). For a splash.
   */
  splash?: (at: THREE.Vector3, speed: number, mass: number) => void;
}

/** Water's density (kg/m³) and its drag (1/s) on a floating piece, at rest. */
const WATER = 1000;
const WATER_DRAG = 1.6;
/** Its growth with speed (per m/s). */
const WATER_DRAG_V = 0.6;

export const DEFAULT_DEBRIS: DebrisTuning = {
  gravity: 9.81, restitution: 0.25, friction: 0.6, drag: 0.15, sleepSpeed: 0.25, sleepTime: 0.6, maxActive: 64, maxPieces: 240, maxAwake: 10, pairs: true,
};

/** One rigid box of debris. */
export interface Piece {
  readonly id: number;
  readonly pos: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly v: THREE.Vector3;
  readonly w: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly mass: number;
  /** Inverse of a scalar moment of inertia (a box's mean principal moment). */
  readonly invI: number;
  asleep: boolean;
  still: number;
  slot: number;
  /** Afloat at the last step (then it isn't added to the collision when it sleeps). */
  afloat?: boolean;
  /** Seconds awake. */
  age?: number;
  /**
   * Pieces it overlapped when it was spawned (two roof halves meeting at the ridge, say): they pass through each other
   * until they have come apart, instead of grinding their way out.
   */
  ignore?: Set<number>;
  /** Seconds since it was last in the water (a splash needs it to have been out a while, not bobbing). */
  dry?: number;
  /** Touched the world or another piece this substep. */
  touching?: boolean;
  /** Touched the world (not just other pieces) last substep: it bears what lies on it (shock propagation). */
  grounded?: boolean;
  /** Where it was when it last moved off (for the rest test by displacement) and how long it has stayed near there. */
  anchor?: { pos: THREE.Vector3; q: THREE.Quaternion; time: number };
}

const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _l = new THREE.Vector3();
const _cl = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ra = new THREE.Vector3();
const _rb = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _push = new THREE.Vector3();
const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x, y, z))));
/** A box's 26 sample points for piece-on-piece contacts: corners, edge midpoints, face centres (unit, ±1/0). */
const SAMPLES = [-1, 0, 1].flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => new THREE.Vector3(x, y, z)))).filter((v) => v.lengthSq() > 0);
/** Broad-phase cell (m), the overlap left alone (m) and the most a contact pushes pieces apart per substep (m). */
const PAIR_CELL = 3;
const PAIR_SLOP = 0.01;
const PAIR_MAX_PUSH = 0.005;
/** Contact sphere radius of a box: its thinnest half extent (the corner spheres fill it). */
const cornerRadius = (p: Piece) => Math.max(0.05, Math.min(p.half.x, p.half.y, p.half.z) * 0.95);

/**
 * Debris (world-interaction plan §4): rigid boxes thrown by blasts — broken walls, roof panels, planks — falling under
 * gravity and bouncing, sliding and tumbling against the collision world (each box is eight spheres tucked into its
 * corners). A piece that comes to rest falls asleep: it stops simulating and joins the world's `debris` collision set,
 * so later pieces pile on it and Toothless can walk over the rubble. Drawn as one instanced, vertex-coloured box mesh.
 */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  readonly pieces: Piece[] = [];
  private nextId = 1;
  private readonly free: number[] = [];
  private readonly pairList: Piece[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly seen = new Set<number>();

  constructor(
    private readonly world: CollisionWorld,
    private readonly set: CollisionSet | null,
    private readonly t: DebrisTuning = DEFAULT_DEBRIS,
    private readonly env: DebrisWorld = {},
  ) {
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const mat = new THREE.MeshStandardMaterial({ name: 'debris', flatShading: true, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, t.maxPieces);
    this.mesh.name = 'debris';
    this.mesh.count = 0;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let k = t.maxPieces - 1; k >= 0; k--) this.free.push(k);
    for (let k = 0; k < t.maxPieces; k++) {
      this.mesh.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(k, new THREE.Color(1, 1, 1));
    }
  }

  get active(): number {
    return this.pieces.filter((p) => !p.asleep).length;
  }

  /** Throw a box of the given half extents in, at a pose with a velocity and a spin. */
  spawn(pos: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, color: THREE.Color, v: THREE.Vector3, w: THREE.Vector3, density = 500): Piece {
    if (!this.free.length) this.remove(this.pieces[0]);
    const awake = this.pieces.filter((p) => !p.asleep);
    if (awake.length >= this.t.maxActive) this.sleep(awake[0]);
    const mass = density * 8 * half.x * half.y * half.z;
    const I = (mass / 3) * ((half.y ** 2 + half.z ** 2) + (half.x ** 2 + half.z ** 2) + (half.x ** 2 + half.y ** 2)) / 3;
    const p: Piece = {
      id: this.nextId++, pos: pos.clone(), q: q.clone(), v: v.clone(), w: w.clone(), half: half.clone(), mass, invI: 1 / I,
      asleep: false, still: 0, slot: this.free.pop()!,
    };
    this.mesh.setColorAt(p.slot, color);
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.t.pairs) {
      for (const o of this.pieces) {
        if (o.asleep && !o.afloat) continue;
        const rr = o.half.length() + p.half.length();
        if (o.pos.distanceToSquared(p.pos) > rr * rr) continue;
        if (!this.pointsAgainstBox(p, o, true) && !this.pointsAgainstBox(o, p, true)) continue;
        (p.ignore ??= new Set()).add(o.id);
        (o.ignore ??= new Set()).add(p.id);
      }
    }
    this.pieces.push(p);
    this.draw(p);
    this.mesh.count = this.t.maxPieces;
    return p;
  }

  /** Wall-clock milliseconds the last update() took (for the frame budget). */
  lastMs = 0;

  update(dt: number): void {
    const t0 = performance.now();
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const p of this.pieces) if (!p.asleep) this.move(p, h);
      // piece against piece first, then the world: the world has the last word (nothing ends up pushed into it)
      if (this.t.pairs) this.collidePairs();
      for (const p of this.pieces) if (!p.asleep) this.contacts(p, h);
      for (const p of this.pieces) if (!p.asleep) this.settle(p, h);
    }
    for (const p of this.pieces) if (!p.asleep) this.draw(p);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lastMs = performance.now() - t0;
  }

  /** Gravity, drag, motion. */
  private move(p: Piece, h: number): void {
    const t = this.t;
    p.touching = false;
    p.v.y -= t.gravity * h;
    const damp = Math.exp(-t.drag * h);
    p.v.multiplyScalar(damp);
    p.w.multiplyScalar(damp);
    p.pos.addScaledVector(p.v, h);
    const wl = p.w.length();
    if (wl > 1e-6) {
      _dq.setFromAxisAngle(_t.copy(p.w).divideScalar(wl), wl * h);
      p.q.premultiply(_dq).normalize();
    }
  }

  /** Contacts with the world (static, settled rubble), the ground and the water. */
  private contacts(p: Piece, h: number): void {
    const t = this.t;
    // eight spheres in the corners
    const r = cornerRadius(p);
    let worldTouch = false;
    for (const k of CORNERS) {
      _c.set(k.x * Math.max(0, p.half.x - r), k.y * Math.max(0, p.half.y - r), k.z * Math.max(0, p.half.z - r)).applyQuaternion(p.q).add(p.pos);
      const hit = this.world.sphereContact(_c, r);
      if (!hit) continue;
      worldTouch = true;
      const n = hit.normal;
      p.pos.addScaledVector(n, hit.depth * 0.8);
      _r.subVectors(_c, p.pos).addScaledVector(n, -r);
      _vp.crossVectors(p.w, _r).add(p.v);
      const vn = _vp.dot(n);
      if (vn >= 0) continue;
      const rn = _t.crossVectors(_r, n);
      const kN = 1 / p.mass + p.invI * rn.lengthSq();
      const jn = (-(1 + (vn < -1 ? t.restitution : 0)) * vn) / kN;
      _j.copy(n).multiplyScalar(jn);
      // friction against the sliding velocity at the contact, capped by the cone
      _t.copy(_vp).addScaledVector(n, -vn);
      const vt = _t.length();
      if (vt > 1e-6) {
        _t.divideScalar(vt);
        const rt = _s.crossVectors(_r, _t);
        const kT = 1 / p.mass + p.invI * rt.lengthSq();
        const jt = Math.min(vt / kT, t.friction * jn);
        _j.addScaledVector(_t, -jt);
      }
      p.v.addScaledVector(_j, 1 / p.mass);
      p.w.addScaledVector(_s.crossVectors(_r, _j), p.invI);
    }
    if (this.env.ground && this.keepAboveGround(p, this.env.ground, h)) worldTouch = true;
    const wasAfloat = p.afloat ?? false;
    const dryBefore = p.dry;
    const vy = p.v.y;
    const level = this.env.water ? this.env.water(p.pos.x, p.pos.z) : -Infinity;
    p.afloat = this.env.water ? this.float(p, level, h) : false;
    p.dry = p.afloat ? 0 : (p.dry ?? 1) + h;
    if (p.afloat && !wasAfloat && vy < -1 && (dryBefore ?? 1) > 0.4 && this.env.splash) {
      const speed = Math.hypot(p.v.x, vy, p.v.z);
      this.env.splash(_c.set(p.pos.x, level, p.pos.z), speed, p.mass);
    }
    p.touching = (p.touching ?? false) || worldTouch;
    p.grounded = worldTouch;
  }

  /** Sleep: a piece slow enough while it rests on something (or floats) for long enough. */
  private settle(p: Piece, h: number): void {
    const t = this.t;
    const slow = p.v.length() < t.sleepSpeed && p.w.length() < t.sleepSpeed * 2;
    p.still = (p.touching || p.afloat) && slow ? p.still + h : 0;
    p.age = (p.age ?? 0) + h;
    // at rest by displacement: in a pile the contacts leave a little velocity noise on a piece that isn't going
    // anywhere; one that stays within 2 cm and ~2° of where it was, touching, for twice the sleep time is at rest too
    const a = (p.anchor ??= { pos: p.pos.clone(), q: p.q.clone(), time: 0 });
    if (p.touching && !p.afloat && a.pos.distanceToSquared(p.pos) < 0.02 ** 2 && Math.abs(a.q.dot(p.q)) > Math.cos(0.015)) a.time += h;
    else {
      a.pos.copy(p.pos);
      a.q.copy(p.q);
      a.time = 0;
    }
    const stuck = p.age > t.maxAwake && p.v.length() < 2;
    if (p.still > t.sleepTime || a.time > t.sleepTime * 2 || stuck || p.pos.y < -60) this.sleep(p);
  }

  /**
   * Moving pieces against each other. Broad phase: a 2D spatial hash (cells of `PAIR_CELL` m) of each piece's bounding
   * circle; pairs whose bounding spheres overlap go to the narrow phase: 26 sample spheres of each box (its corners,
   * edge midpoints and face centres, tucked in by the corner radius) against the other's box, both ways, each contact
   * resolved by a sequential impulse with friction and a capped position correction (no velocity bias, so overlapping
   * pieces ease apart instead of exploding). Floating pieces asleep on the water take part as fixed obstacles.
   */
  private collidePairs(): void {
    const list = this.pairList;
    list.length = 0;
    for (const p of this.pieces) if (!p.asleep || p.afloat) list.push(p);
    if (list.length < 2 || !list.some((p) => !p.asleep)) return;
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const rad = p.half.length();
      const x0 = Math.floor((p.pos.x - rad) / PAIR_CELL);
      const x1 = Math.floor((p.pos.x + rad) / PAIR_CELL);
      const z0 = Math.floor((p.pos.z - rad) / PAIR_CELL);
      const z1 = Math.floor((p.pos.z + rad) / PAIR_CELL);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = (x + 32768) * 65536 + (z + 32768);
          const cell = grid.get(key);
          if (cell) cell.push(i);
          else grid.set(key, [i]);
        }
      }
    }
    const seen = this.seen;
    seen.clear();
    const n = list.length;
    for (const cell of grid.values()) {
      for (let a = 0; a < cell.length; a++) {
        for (let b = a + 1; b < cell.length; b++) {
          const i = Math.min(cell[a], cell[b]);
          const j = Math.max(cell[a], cell[b]);
          const pk = i * n + j;
          if (seen.has(pk)) continue;
          seen.add(pk);
          const A = list[i];
          const B = list[j];
          if (A.asleep && B.asleep) continue;
          const rr = A.half.length() + B.half.length();
          const apart = A.pos.distanceToSquared(B.pos) > rr * rr;
          if (A.ignore?.has(B.id)) {
            // overlapping since they were spawned: leave them be until they no longer touch at all
            if (apart || (!this.pointsAgainstBox(A, B, true) && !this.pointsAgainstBox(B, A, true))) {
              A.ignore.delete(B.id);
              B.ignore?.delete(A.id);
            }
            continue;
          }
          if (apart) continue;
          const hitA = this.pointsAgainstBox(A, B);
          const hitB = this.pointsAgainstBox(B, A);
          if (hitA || hitB) {
            A.touching = true;
            B.touching = true;
          }
        }
      }
    }
  }

  /**
   * A's sample spheres against B's box; contacts push A out of B (and B away). Returns whether any touched (`probe`:
   * only that, changing nothing).
   */
  private pointsAgainstBox(A: Piece, B: Piece, probe = false): boolean {
    const t = this.t;
    const r = cornerRadius(A);
    const wa = A.asleep ? 0 : 1 / A.mass;
    const wb = B.asleep ? 0 : 1 / B.mass;
    const ia = A.asleep ? 0 : A.invI;
    const ib = B.asleep ? 0 : B.invI;
    if (wa + wb === 0 && !probe) return false;
    _qi.copy(B.q).invert();
    let any = false;
    let deepest = 0;
    for (const k of SAMPLES) {
      _c.set(k.x * Math.max(0, A.half.x - r), k.y * Math.max(0, A.half.y - r), k.z * Math.max(0, A.half.z - r)).applyQuaternion(A.q).add(A.pos);
      // the sphere's centre in B's frame, the closest point of B's box to it
      _l.subVectors(_c, B.pos).applyQuaternion(_qi);
      const hx = B.half.x;
      const hy = B.half.y;
      const hz = B.half.z;
      const inside = Math.abs(_l.x) < hx && Math.abs(_l.y) < hy && Math.abs(_l.z) < hz;
      let depth: number;
      if (!inside) {
        _cl.set(THREE.MathUtils.clamp(_l.x, -hx, hx), THREE.MathUtils.clamp(_l.y, -hy, hy), THREE.MathUtils.clamp(_l.z, -hz, hz));
        _n.subVectors(_l, _cl);
        const d = _n.length();
        if (d >= r || d < 1e-9) continue;
        _n.divideScalar(d);
        depth = r - d;
      } else {
        // the centre is inside: out along the face it is nearest
        const ex = hx - Math.abs(_l.x);
        const ey = hy - Math.abs(_l.y);
        const ez = hz - Math.abs(_l.z);
        if (ex <= ey && ex <= ez) _n.set(Math.sign(_l.x) || 1, 0, 0);
        else if (ey <= ez) _n.set(0, Math.sign(_l.y) || 1, 0);
        else _n.set(0, 0, Math.sign(_l.z) || 1);
        depth = r + Math.min(ex, ey, ez);
        _cl.copy(_l).addScaledVector(_n, Math.min(ex, ey, ez));
      }
      any = true;
      if (probe) return true;
      _n.applyQuaternion(B.q);                                   // world normal, from B towards A
      _cl.applyQuaternion(B.q).add(B.pos);                       // contact point (on B's surface)
      if (depth > deepest) {
        deepest = depth;
        _push.copy(_n);
      }
      // shock propagation: a piece lying on one that rests on the world meets it as if it were the world (one pass
      // of contacts can't carry a stack's weight down to the ground otherwise, and the top piece never comes to rest)
      let wA = wa;
      let wB = wb;
      let iA = ia;
      let iB = ib;
      if (_n.y > 0.5 && B.grounded && wa > 0) wB = iB = 0;
      else if (_n.y < -0.5 && A.grounded && wb > 0) wA = iA = 0;
      _ra.subVectors(_cl, A.pos);
      _rb.subVectors(_cl, B.pos);
      _vp.crossVectors(A.w, _ra).add(A.v);
      _vb.crossVectors(B.w, _rb).add(B.v);
      _vp.sub(_vb);
      const vn = _vp.dot(_n);
      if (vn >= 0) continue;
      const e = vn < -1 ? t.restitution : 0;                     // no bounce at resting speeds: no jitter in piles
      const kN = wA + wB + iA * _t.crossVectors(_ra, _n).lengthSq() + iB * _t.crossVectors(_rb, _n).lengthSq();
      const jn = (-(1 + e) * vn) / kN;
      _j.copy(_n).multiplyScalar(jn);
      _t.copy(_vp).addScaledVector(_n, -vn);
      const vt = _t.length();
      if (vt > 1e-6) {
        _t.divideScalar(vt);
        const kT = wA + wB + iA * _s.crossVectors(_ra, _t).lengthSq() + iB * _s.crossVectors(_rb, _t).lengthSq();
        _j.addScaledVector(_t, -Math.min(vt / kT, t.friction * jn));
      }
      A.v.addScaledVector(_j, wA);
      A.w.addScaledVector(_s.crossVectors(_ra, _j), iA);
      B.v.addScaledVector(_j, -wB);
      B.w.addScaledVector(_s.crossVectors(_rb, _j), -iB);
    }
    // position: one correction for the pair, along its deepest contact, split by inverse mass and capped per substep
    // (no velocity added, so overlapping pieces ease apart instead of flying apart)
    const corr = Math.min(Math.max(0, deepest - PAIR_SLOP) * 0.5, PAIR_MAX_PUSH);
    if (corr > 0) {
      let pa = wa;
      let pb = wb;
      if (_push.y > 0.5 && B.grounded && wa > 0) pb = 0;
      else if (_push.y < -0.5 && A.grounded && wb > 0) pa = 0;
      A.pos.addScaledVector(_push, (corr * pa) / (pa + pb));
      B.pos.addScaledVector(_push, (-corr * pb) / (pa + pb));
    }
    return any;
  }

  /**
   * Lift a piece whose lowest corner is under the ground there and stop it sinking further, as a contact with friction
   * (the heightfield is smoother than the collision's triangles: small gaps are left to the contacts, and a lifted piece
   * must still be able to come to rest). Returns whether it lifted.
   */
  private keepAboveGround(p: Piece, ground: (x: number, z: number) => number, h: number): boolean {
    let deficit = 0;
    for (const k of CORNERS) {
      _c.set(k.x * p.half.x, k.y * p.half.y, k.z * p.half.z).applyQuaternion(p.q).add(p.pos);
      deficit = Math.max(deficit, ground(_c.x, _c.z) - _c.y);
    }
    if (deficit <= 0.1) return false;
    p.pos.y += deficit;
    if (p.v.y < 0) p.v.y = 0;
    const grip = Math.exp(-this.t.friction * 8 * h);
    p.v.x *= grip;
    p.v.z *= grip;
    p.w.multiplyScalar(grip);
    return true;
  }

  /**
   * Buoyancy and drag from water whose surface is at `level`: lift by the submerged share of the box (its vertical
   * extent under the surface), so wood (500 kg/m³) rides half under. Returns whether it is in the water.
   */
  private float(p: Piece, level: number, h: number): boolean {
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of CORNERS) {
      const y = _c.set(k.x * p.half.x, k.y * p.half.y, k.z * p.half.z).applyQuaternion(p.q).y + p.pos.y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (!(level > lo)) return false;
    const under = Math.min(1, (level - lo) / Math.max(1e-3, hi - lo));
    const volume = 8 * p.half.x * p.half.y * p.half.z;
    p.v.y += ((WATER * volume * under) / p.mass) * this.t.gravity * h;
    // drag grows with speed (a plunging plank is stopped quickly and doesn't leap back out like a cork)
    const damp = Math.exp(-WATER_DRAG * (1 + p.v.length() * WATER_DRAG_V) * under * h);
    p.v.multiplyScalar(damp);
    p.w.multiplyScalar(damp);
    return true;
  }

  private sleep(p: Piece): void {
    p.asleep = true;
    p.v.set(0, 0, 0);
    p.w.set(0, 0, 0);
    this.draw(p);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.set || p.pos.y < -50 || p.afloat) return;
    const g = new THREE.BoxGeometry(p.half.x * 2, p.half.y * 2, p.half.z * 2);
    g.applyMatrix4(_m.compose(p.pos, p.q, _s.set(1, 1, 1)));
    this.set.add(`debris:${p.id}`, geometryTriangles(g));
    g.dispose();
  }

  private remove(p: Piece): void {
    const k = this.pieces.indexOf(p);
    if (k < 0) return;
    this.pieces.splice(k, 1);
    this.set?.remove(`debris:${p.id}`);
    this.mesh.setMatrixAt(p.slot, _m.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(p.slot);
  }

  private draw(p: Piece): void {
    this.mesh.setMatrixAt(p.slot, _m.compose(p.pos, p.q, _s.copy(p.half).multiplyScalar(2)));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
