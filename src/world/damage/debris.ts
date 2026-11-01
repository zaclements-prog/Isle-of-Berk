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
}

/**
 * What the debris needs of the world beyond its collision. `ground` is a floor no corner may end below, whatever the
 * contacts missed (a piece spawned inside a hill, or tunnelling a seam). `water` is the surface height at (x, z), or
 * -Infinity where there's none: wood floats there, half under, instead of sinking to the seabed.
 */
export interface DebrisWorld {
  ground?: (x: number, z: number) => number;
  water?: (x: number, z: number) => number;
}

/** Water's density (kg/m³) and its drag (1/s) on a floating piece. */
const WATER = 1000;
const WATER_DRAG = 1.6;

export const DEFAULT_DEBRIS: DebrisTuning = {
  gravity: 9.81, restitution: 0.25, friction: 0.6, drag: 0.15, sleepSpeed: 0.25, sleepTime: 0.6, maxActive: 64, maxPieces: 240, maxAwake: 10,
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
}

const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x, y, z))));

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
    this.pieces.push(p);
    this.draw(p);
    this.mesh.count = this.t.maxPieces;
    return p;
  }

  update(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) for (const p of this.pieces) if (!p.asleep) this.step(p, h);
    for (const p of this.pieces) if (!p.asleep) this.draw(p);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private step(p: Piece, h: number): void {
    const t = this.t;
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
    // contacts: eight spheres in the corners
    const r = Math.max(0.05, Math.min(p.half.x, p.half.y, p.half.z) * 0.95);
    let touching = false;
    for (const k of CORNERS) {
      _c.set(k.x * Math.max(0, p.half.x - r), k.y * Math.max(0, p.half.y - r), k.z * Math.max(0, p.half.z - r)).applyQuaternion(p.q).add(p.pos);
      const hit = this.world.sphereContact(_c, r);
      if (!hit) continue;
      touching = true;
      const n = hit.normal;
      p.pos.addScaledVector(n, hit.depth * 0.8);
      _r.subVectors(_c, p.pos).addScaledVector(n, -r);
      _vp.crossVectors(p.w, _r).add(p.v);
      const vn = _vp.dot(n);
      if (vn >= 0) continue;
      const rn = _t.crossVectors(_r, n);
      const kN = 1 / p.mass + p.invI * rn.lengthSq();
      const jn = (-(1 + t.restitution) * vn) / kN;
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
    if (this.env.ground && this.keepAboveGround(p, this.env.ground, h)) touching = true;
    p.afloat = this.env.water ? this.float(p, this.env.water(p.pos.x, p.pos.z), h) : false;
    const slow = p.v.length() < t.sleepSpeed && p.w.length() < t.sleepSpeed * 2;
    p.still = (touching || p.afloat) && slow ? p.still + h : 0;
    p.age = (p.age ?? 0) + h;
    const stuck = p.age > t.maxAwake && p.v.length() < 2;
    if (p.still > t.sleepTime || stuck || p.pos.y < -60) this.sleep(p);
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
    const damp = Math.exp(-WATER_DRAG * under * h);
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
