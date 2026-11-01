import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CollisionSet } from '../collision';
import { geometryTriangles } from '../collision';
import type { BlastEvent, WorldEvents } from '../events';

export type TreeState = 'standing' | 'scorched' | 'burning' | 'burnt' | 'falling' | 'felled' | 'stump';

export interface TreeDamageTuning {
  /** Of a blast's radius (× power): felled inside `fell`, scorched inside `scorch`. */
  fell: number;
  scorch: number;
  /** Seconds a felled tree lies before it crumbles to a stump, and how long the crumbling takes. */
  lie: number;
  crumble: number;
  /** Rad/s the blast throws a felled tree over with (× power). */
  kick: number;
  /** Seconds a tree burns once fire catches it (damage/fire), before it stands burnt out. */
  burn: number;
}

export const DEFAULT_TREE_DAMAGE: TreeDamageTuning = { fell: 0.75, scorch: 1.6, lie: 45, crumble: 2.5, kick: 0.9, burn: 14 };

/** What the tree damage needs of each tree: its instance, where it stands, its size and its trunk's collision key. */
export interface TreeRecord {
  mesh: THREE.InstancedMesh;
  k: number;
  key: string;
}

interface Tree {
  rec: TreeRecord;
  state: TreeState;
  base: THREE.Vector3;
  scale: number;
  yaw: number;
  scorch: number;
  /** Fall: direction (yaw), angle from upright, angular speed, the angle it comes to rest at, time lying. */
  fallYaw: number;
  angle: number;
  omega: number;
  rest: number;
  lying: number;
  /** Seconds it has been burning. */
  burnT: number;
}

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const CHAR = new THREE.Color(0.2, 0.17, 0.15);
/** A burnt-out tree: near black, a little ash-grey. */
const BURNT = new THREE.Color(0.075, 0.066, 0.06);
const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** A stump: a short charred trunk with a splintered top. */
export function stumpGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 7, 1).translate(0, 0.4, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0.7;
    if (top) p.setY(i, 0.8 + 0.25 * Math.sin(i * 2.3));
    const c = top ? [0.12, 0.09, 0.07] : [0.3, 0.22, 0.16];
    col.push(..._c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).toArray()); // vertex colours are linear
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A felled trunk: a charred log 6.3 m long (unit tree scale) lying along +y from its foot, with snapped branch stubs. */
export function logGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.22, 0.36, 6.3, 7, 4).translate(0, 3.15, 0)];
  for (const [y, a, l] of [[2.1, 0.4, 0.7], [3.3, 2.6, 0.55], [4.4, 4.5, 0.6], [5.3, 1.3, 0.45]]) {
    parts.push(new THREE.CylinderGeometry(0.05, 0.09, l, 5, 1).translate(0, l / 2, 0).rotateZ(1.1).rotateY(a).translate(0, y, 0));
  }
  const g = mergeGeometries(parts.map((q) => q.toNonIndexed()))!;
  parts.forEach((q) => q.dispose());
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    // bark charred in patches along the trunk, the snapped crown end raw and pale
    const y = p.getY(i);
    const burnt = 0.5 + 0.5 * Math.sin(y * 2.7 + Math.atan2(p.getZ(i), p.getX(i)) * 2.0);
    const bark = [0.27, 0.19, 0.13].map((v, k) => v + ([0.09, 0.075, 0.065][k] - v) * burnt);
    const c = y > 6.2 ? [0.62, 0.5, 0.34] : bark;
    col.push(..._c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).toArray()); // vertex colours are linear
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Trees that blasts damage (world-interaction plan §4): each tree is standing, scorched (its crown charred by a
 * near blast), falling (a close blast throws it over away from the impact, hinged at its base like a falling rod),
 * felled (lying on the ground, colliding where it lies) or a stump (after a while the felled tree crumbles away).
 * Collision follows the state: the trunk leaves the tree set as it falls and comes back lying where it fell.
 */
export class TreeDamage {
  readonly root = new THREE.Group();
  readonly stumps: THREE.InstancedMesh;
  /** Felled trunks: when a falling tree hits the ground its crown breaks off and the trunk lies as a log. */
  readonly logs: THREE.InstancedMesh;
  private readonly logSlot = new Map<Tree, number>();
  private readonly freeLogs: number[] = [];
  private readonly trees: Tree[];
  private readonly moving = new Set<Tree>();
  private stumpCount = 0;
  private readonly off: () => void;

  constructor(
    records: readonly TreeRecord[],
    private readonly set: CollisionSet | null,
    private readonly ground: (x: number, z: number) => number,
    private readonly events: WorldEvents | null,
    private readonly t: TreeDamageTuning = DEFAULT_TREE_DAMAGE,
    maxStumps = 256,
  ) {
    this.root.name = 'TreeDamage';
    this.trees = records.map((rec) => {
      rec.mesh.getMatrixAt(rec.k, _m);
      const base = new THREE.Vector3();
      _m.decompose(base, _q, _s);
      const e = new THREE.Euler().setFromQuaternion(_q, 'YXZ');
      return { rec, state: 'standing' as TreeState, base, scale: _s.x, yaw: e.y, scorch: 0, fallYaw: 0, angle: 0, omega: 0, rest: Math.PI / 2, lying: 0, burnT: 0 };
    });
    const mat = new THREE.MeshStandardMaterial({ name: 'stump', vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    this.stumps = new THREE.InstancedMesh(stumpGeometry(), mat, maxStumps);
    this.stumps.count = 0;
    this.stumps.castShadow = this.stumps.receiveShadow = true;
    this.stumps.frustumCulled = false;
    this.stumps.name = 'stumps';
    this.root.add(this.stumps);
    this.logs = new THREE.InstancedMesh(logGeometry(), mat, maxStumps);
    this.logs.count = maxStumps;
    this.logs.castShadow = this.logs.receiveShadow = true;
    this.logs.frustumCulled = false;
    this.logs.name = 'logs';
    for (let k = maxStumps - 1; k >= 0; k--) {
      this.logs.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.freeLogs.push(k);
    }
    this.root.add(this.logs);
    this.off = events?.on('blast', (e) => this.blast(e)) ?? (() => {});
  }

  get count(): number {
    return this.trees.length;
  }

  state(i: number): TreeState {
    return this.trees[i].state;
  }

  /** Where tree i stands (its base, on the ground), and its height (m). */
  base(i: number): THREE.Vector3 {
    return this.trees[i].base;
  }

  height(i: number): number {
    return 9 * this.trees[i].scale;
  }

  /** How charred tree i is (0 green … 1 burnt black). */
  scorchOf(i: number): number {
    return this.trees[i].scorch;
  }

  /** 0…1 through its burn, while it's burning (0 otherwise). */
  burnProgress(i: number): number {
    const tr = this.trees[i];
    return tr.state === 'burning' ? Math.min(1, tr.burnT / this.t.burn) : 0;
  }

  /** The collision key of tree i (`tree:<i>` on the island). */
  key(i: number): string {
    return this.trees[i].rec.key;
  }

  /**
   * Fire catches tree i (damage/fire): a standing or scorched tree burns for `burn` s, its crown charring as it goes,
   * then stands burnt out. False if it can't (already burning or burnt, or down).
   */
  ignite(i: number): boolean {
    const tr = this.trees[i];
    if (tr.state !== 'standing' && tr.state !== 'scorched') return false;
    tr.state = 'burning';
    tr.burnT = 0;
    this.moving.add(tr);
    return true;
  }

  /** How many trees are in each state (for tests and the HUD). */
  census(): Record<TreeState, number> {
    const out: Record<TreeState, number> = { standing: 0, scorched: 0, burning: 0, burnt: 0, falling: 0, felled: 0, stump: 0 };
    for (const t of this.trees) out[t.state]++;
    return out;
  }

  blast(e: BlastEvent): void {
    const fellR = e.radius * this.t.fell;
    const scorchR = e.radius * this.t.scorch;
    for (const tr of this.trees) {
      if (tr.state === 'stump' || tr.state === 'felled') continue;
      const dx = tr.base.x - e.point.x;
      const dz = tr.base.z - e.point.z;
      const h = 9 * tr.scale;
      // distance from the blast to the nearest point of the trunk's axis (base to crown)
      const dy = Math.min(Math.max(e.point.y - tr.base.y, 0), h);
      const d = Math.hypot(dx, dz, e.point.y - tr.base.y - dy);
      if (d > scorchR) continue;
      const s = 1 - d / scorchR;
      if (tr.scorch < 1) tr.scorch = Math.min(1, tr.scorch + s * 1.2);
      this.paint(tr);
      if (tr.state === 'standing' && tr.scorch > 0.05) tr.state = 'scorched';
      if (d < fellR && tr.state !== 'falling') this.fell(tr, Math.atan2(dx, dz) + (d < 0.3 ? Math.random() : 0), e.power * (1.2 - d / fellR), e.time);
    }
  }

  private paint(tr: Tree): void {
    _c.setRGB(1, 1, 1).lerp(CHAR, Math.min(1, tr.scorch));
    // past a full scorch, a fire chars it on toward black
    if (tr.scorch > 1) _c.lerp(BURNT, Math.min(1, tr.scorch - 1));
    tr.rec.mesh.setColorAt(tr.rec.k, _c);
    tr.rec.mesh.instanceColor!.needsUpdate = true;
  }

  private fell(tr: Tree, yaw: number, strength: number, time: number): void {
    tr.state = 'falling';
    // a crater may just have been dug under it: it falls from the ground as it is now, not from the air
    tr.base.y = this.ground(tr.base.x, tr.base.z);
    tr.fallYaw = yaw;
    tr.angle = 0.06;
    tr.omega = this.t.kick * Math.max(0.3, strength);
    // it comes to rest where its crown meets the ground: on a downslope it goes past level, on an upslope short of it
    const L = 9 * tr.scale * 0.7;
    const gx = tr.base.x + Math.sin(yaw) * L;
    const gz = tr.base.z + Math.cos(yaw) * L;
    const rise = this.ground(gx, gz) - tr.base.y + 0.4 * tr.scale;
    tr.rest = THREE.MathUtils.clamp(Math.atan2(L, rise), 0.9, 2.0);
    this.set?.remove(tr.rec.key);
    this.moving.add(tr);
    this.events?.emit({ type: 'fell', key: tr.rec.key, point: tr.base.clone(), yaw, time });
  }

  /** Pose the tree (or, felled, its log in `slot`) tipped `angle` toward its fall, from its base. */
  private place(tr: Tree, scale = 1, slot = -1): void {
    _a.set(Math.cos(tr.fallYaw), 0, -Math.sin(tr.fallYaw)); // up × fall direction
    _r.makeRotationAxis(_a, tr.angle);
    _m.compose(tr.base, _q.setFromAxisAngle(UP, tr.yaw), _s.setScalar(tr.scale * scale));
    _m.premultiply(_r.setPosition(0, 0, 0)).setPosition(tr.base);
    const mesh = slot >= 0 ? this.logs : tr.rec.mesh;
    mesh.setMatrixAt(slot >= 0 ? slot : tr.rec.k, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const tr of this.moving) {
      if (tr.state === 'burning') {
        // the crown chars through as it burns, to black at the end
        tr.burnT += dt;
        const k = Math.min(1, tr.burnT / this.t.burn);
        tr.scorch = Math.max(tr.scorch, Math.min(1, k * 1.6) + Math.max(0, k * 2 - 1));
        this.paint(tr);
        if (k >= 1) {
          tr.state = 'burnt';
          tr.scorch = 2;
          this.paint(tr);
          this.moving.delete(tr);
        }
      } else if (tr.state === 'falling') {
        // a rod falling about its foot: θ'' = (3g / 2L) sin θ
        const L = 9 * tr.scale;
        tr.omega += (3 * G / (2 * L)) * Math.sin(tr.angle) * dt;
        tr.angle += tr.omega * dt;
        if (tr.angle >= tr.rest) {
          tr.angle = tr.rest;
          tr.omega = -tr.omega * 0.18;
          if (Math.abs(tr.omega) < 0.12) this.lieDown(tr);
        }
        if (tr.state === 'falling') this.place(tr); // once it lies, the log has taken its place
      } else if (tr.state === 'felled') {
        tr.lying += dt;
        const k = (tr.lying - this.t.lie) / this.t.crumble;
        if (k > 0) {
          const slot = this.logSlot.get(tr) ?? -1;
          // the log crumbles: it thins and sinks away (the tree itself is already gone)
          if (slot >= 0) this.place(tr, Math.max(0, 1 - k), slot);
          if (k >= 1) this.toStump(tr);
        }
      }
    }
  }

  private lieDown(tr: Tree): void {
    tr.state = 'felled';
    tr.lying = 0;
    // the crown breaks off on impact: the tree goes, its trunk lies as a log, a splintered stump stays at its foot
    const slot = this.freeLogs.pop();
    if (slot !== undefined) {
      this.hide(tr);
      this.logSlot.set(tr, slot);
      this.place(tr, 1, slot);
      this.addStump(tr);
    }
    // its trunk collides where it lies
    if (this.set) {
      const g = new THREE.CylinderGeometry(0.35 * tr.scale, 0.4 * tr.scale, 4 * tr.scale, 6, 1).translate(0, 2 * tr.scale, 0);
      _a.set(Math.cos(tr.fallYaw), 0, -Math.sin(tr.fallYaw));
      g.applyMatrix4(_m.makeRotationAxis(_a, tr.angle).setPosition(tr.base));
      this.set.add(tr.rec.key, geometryTriangles(g));
      g.dispose();
    }
  }

  private toStump(tr: Tree): void {
    tr.state = 'stump';
    this.moving.delete(tr);
    this.set?.remove(tr.rec.key);
    const slot = this.logSlot.get(tr);
    if (slot !== undefined) {
      // the stump went in when it fell; the log is done
      this.logs.setMatrixAt(slot, _m.makeScale(0, 0, 0));
      this.logs.instanceMatrix.needsUpdate = true;
      this.logSlot.delete(tr);
      this.freeLogs.push(slot);
      return;
    }
    this.hide(tr);
    this.addStump(tr);
  }

  private hide(tr: Tree): void {
    tr.rec.mesh.setMatrixAt(tr.rec.k, _m.makeScale(0, 0, 0));
    tr.rec.mesh.instanceMatrix.needsUpdate = true;
  }

  private addStump(tr: Tree): void {
    if (this.stumpCount >= this.stumps.instanceMatrix.count) return;
    _m.compose(tr.base, _q.setFromAxisAngle(UP, tr.yaw), _s.setScalar(tr.scale));
    this.stumps.setMatrixAt(this.stumpCount++, _m);
    this.stumps.count = this.stumpCount;
    this.stumps.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.off();
    this.stumps.geometry.dispose();
    this.logs.geometry.dispose();
    this.logs.dispose();
    (this.stumps.material as THREE.Material).dispose();
    this.stumps.dispose();
  }
}
