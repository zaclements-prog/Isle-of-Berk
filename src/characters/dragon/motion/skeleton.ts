import * as THREE from 'three';
import type { MotionRig } from './rigTypes';
import { isFiniteQuat, isFiniteVec3 } from './math';

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

type RigBone = MotionRig['bones'][number];

/**
 * The dragon's skeleton, built from rig metadata alone (spec §5.5: the engine never guesses bone axes).
 * World == skeleton space (the asset root stays at the origin); the root bone carries the world transform.
 * The pose is rewritten ABSOLUTELY every step (resetToBind → layers → fk), never accumulated (spec §3.4).
 */
export class RigSkeleton {
  readonly count: number;
  readonly names: readonly string[];
  readonly parent: Int16Array;
  readonly length: Float64Array;
  readonly bindLocalPos: THREE.Vector3[] = [];
  readonly bindLocalQuat: THREE.Quaternion[] = [];
  readonly bindWorldPos: THREE.Vector3[] = [];
  readonly bindWorldQuat: THREE.Quaternion[] = [];
  readonly localPos: THREE.Vector3[] = [];
  readonly localQuat: THREE.Quaternion[] = [];
  readonly worldPos: THREE.Vector3[] = [];
  readonly worldQuat: THREE.Quaternion[] = [];
  readonly prevLocalPos: THREE.Vector3[] = [];
  readonly prevLocalQuat: THREE.Quaternion[] = [];
  private readonly index = new Map<string, number>();

  constructor(rig: MotionRig) {
    const byName = new Map(rig.bones.map((b) => [b.name, b]));
    const ordered: RigBone[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (name: string): void => {
      const st = state.get(name);
      if (st === 2) return;
      if (st === 1) throw new Error(`RigSkeleton: parent cycle at '${name}'`);
      const b = byName.get(name);
      if (!b) throw new Error(`RigSkeleton: unknown bone '${name}'`);
      state.set(name, 1);
      if (b.parent) visit(b.parent);
      state.set(name, 2);
      ordered.push(b);
    };
    for (const b of rig.bones) visit(b.name);

    this.count = ordered.length;
    this.names = ordered.map((b) => b.name);
    ordered.forEach((b, i) => this.index.set(b.name, i));
    this.parent = new Int16Array(this.count);
    this.length = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const b = ordered[i];
      const head = new THREE.Vector3(...b.head);
      _y.set(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
      this.length[i] = _y.length();
      _y.normalize();
      _x.set(...b.xAxis);
      _x.addScaledVector(_y, -_x.dot(_y)).normalize();
      _z.crossVectors(_x, _y);
      const wq = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
      this.bindWorldQuat.push(wq);
      this.bindWorldPos.push(head);
      const p = b.parent ? this.index.get(b.parent)! : -1;
      this.parent[i] = p;
      if (p < 0) {
        this.bindLocalQuat.push(wq.clone());
        this.bindLocalPos.push(head.clone());
      } else {
        const inv = _q.copy(this.bindWorldQuat[p]).invert();
        this.bindLocalQuat.push(inv.clone().multiply(wq));
        this.bindLocalPos.push(head.clone().sub(this.bindWorldPos[p]).applyQuaternion(inv));
      }
      this.localQuat.push(this.bindLocalQuat[i].clone());
      this.localPos.push(this.bindLocalPos[i].clone());
      this.prevLocalQuat.push(this.bindLocalQuat[i].clone());
      this.prevLocalPos.push(this.bindLocalPos[i].clone());
      this.worldQuat.push(wq.clone());
      this.worldPos.push(head.clone());
    }
  }

  id(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`RigSkeleton: no bone '${name}'`);
    return i;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  resetToBind(): void {
    for (let i = 0; i < this.count; i++) {
      this.localQuat[i].copy(this.bindLocalQuat[i]);
      this.localPos[i].copy(this.bindLocalPos[i]);
    }
  }

  /** World transforms from local ones, parents first. */
  fk(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.parent[i];
      if (p < 0) {
        this.worldQuat[i].copy(this.localQuat[i]);
        this.worldPos[i].copy(this.localPos[i]);
      } else {
        this.worldQuat[i].multiplyQuaternions(this.worldQuat[p], this.localQuat[i]);
        this.worldPos[i].copy(this.localPos[i]).applyQuaternion(this.worldQuat[p]).add(this.worldPos[p]);
      }
    }
  }

  tail(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, this.length[i], 0).applyQuaternion(this.worldQuat[i]).add(this.worldPos[i]);
  }

  /** A point given in bone i's local frame → world (current pose). */
  toWorld(i: number, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.worldQuat[i]).add(this.worldPos[i]);
  }

  /** A bind-pose world point → bone i's local frame. */
  bindToLocal(i: number, bindPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(bindPoint, this.bindWorldPos[i]).applyQuaternion(_q.copy(this.bindWorldQuat[i]).invert());
  }

  /** Give bone i the world rotation q (its parent's world rotation must be current). Children need fk() afterwards. */
  setWorldQuat(i: number, q: THREE.Quaternion): void {
    const p = this.parent[i];
    if (p < 0) this.localQuat[i].copy(q);
    else this.localQuat[i].copy(this.worldQuat[p]).invert().multiply(q);
    this.worldQuat[i].copy(q);
  }

  /** Remember this step's starting pose (render interpolation, NaN recovery). */
  snapshot(): void {
    for (let i = 0; i < this.count; i++) {
      this.prevLocalQuat[i].copy(this.localQuat[i]);
      this.prevLocalPos[i].copy(this.localPos[i]);
    }
  }

  restorePrev(): void {
    for (let i = 0; i < this.count; i++) {
      this.localQuat[i].copy(this.prevLocalQuat[i]);
      this.localPos[i].copy(this.prevLocalPos[i]);
    }
    this.fk();
  }

  /** Rotation angle of bone i's local rotation away from bind (rad). */
  angleFromBind(i: number): number {
    return 2 * Math.acos(Math.min(1, Math.abs(this.localQuat[i].dot(this.bindLocalQuat[i]))));
  }

  isFinite(): boolean {
    for (let i = 0; i < this.count; i++) {
      if (!isFiniteQuat(this.localQuat[i]) || !isFiniteVec3(this.localPos[i])) return false;
    }
    return true;
  }

  /** Copy the pose onto three.js bones, interpolating from the previous step by alpha (spec §3.4). */
  writeTo(bones: ReadonlyMap<string, THREE.Object3D>, alpha = 1): void {
    for (let i = 0; i < this.count; i++) {
      const b = bones.get(this.names[i]);
      if (!b) continue;
      b.quaternion.slerpQuaternions(this.prevLocalQuat[i], this.localQuat[i], alpha);
      if (this.parent[i] < 0) b.position.lerpVectors(this.prevLocalPos[i], this.localPos[i], alpha);
    }
  }
}
