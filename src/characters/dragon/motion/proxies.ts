import * as THREE from 'three';
import type { CollisionWorld, SphereContact } from '../../../world/collision';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';

export interface BodyProxy {
  readonly name: string;
  readonly bone: number;
  /** Centre in the bone's local frame. */
  readonly local: THREE.Vector3;
  readonly radius: number;
}

/** Spec §6.14: head, chest, belly, hips (+ muzzle, neck) collide; feet and tail only use rays. */
export const BODY_PROXY_NAMES: readonly string[] = ['head', 'muzzle', 'neck', 'chest', 'belly', 'hips'];

const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _contact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

export class BodyProxies {
  readonly items: BodyProxy[] = [];
  readonly centers: THREE.Vector3[] = [];
  blocked = false;
  readonly wallNormal = new THREE.Vector3();

  constructor(rig: MotionRig, skeleton: RigSkeleton, names: readonly string[] = BODY_PROXY_NAMES) {
    for (const p of rig.proxies) {
      if (!names.includes(p.name)) continue;
      const bone = skeleton.id(p.bone);
      const local = skeleton.bindToLocal(bone, new THREE.Vector3(...p.center), new THREE.Vector3());
      this.items.push({ name: p.name, bone, local, radius: p.radius });
      this.centers.push(new THREE.Vector3());
    }
  }

  /** World centres from the skeleton's current FK. */
  update(skeleton: RigSkeleton): void {
    this.items.forEach((p, k) => skeleton.toWorld(p.bone, p.local, this.centers[k]));
  }

  /**
   * Slide-resolve a body displacement against steep geometry: each proxy moved by `delta` is pushed out along the
   * horizontal part of its contact normal (moving s along n_h removes s·|n_h| of depth, so s = depth / |n_h|).
   * Ground-like contacts (normal.y ≥ maxNormalY) are left to the body solver, so slopes and steps never block.
   * `maxNormalY` is a hand-set motion constant (spec §6.16) and must come from live tuning — callers pass
   * `tuning.body.wallNormalY`, never a literal, so no call site can silently drift from the one typed config.
   */
  resolveMove(world: CollisionWorld, delta: THREE.Vector3, maxNormalY: number): THREE.Vector3 {
    this.blocked = false;
    let deepest = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < this.items.length; k++) {
        _c.copy(this.centers[k]).add(delta);
        const c = world.sphereContact(_c, this.items[k].radius, _contact);
        if (!c || Math.abs(c.normal.y) >= maxNormalY) continue; // walls only: floors/ceilings belong to the body solver
        _n.set(c.normal.x, 0, c.normal.z);
        const h = _n.length();
        if (h < 1e-6) continue;
        _n.divideScalar(h);
        delta.addScaledVector(_n, Math.min(c.depth / h, this.items[k].radius) + 1e-5);
        if (c.depth > deepest) {
          deepest = c.depth;
          this.wallNormal.copy(_n);
          this.blocked = true;
        }
      }
    }
    return delta;
  }
}
