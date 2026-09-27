import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface RayHit {
  readonly point: THREE.Vector3;
  /** Face normal, flipped to face the ray's origin. */
  readonly normal: THREE.Vector3;
  distance: number;
}

export interface SurfacePoint {
  readonly point: THREE.Vector3;
  /** Outward face normal of the closest triangle. */
  readonly normal: THREE.Vector3;
  distance: number;
}

export interface SphereContact {
  readonly point: THREE.Vector3;
  /** Direction to push the sphere out. */
  readonly normal: THREE.Vector3;
  depth: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Static collision geometry: every mesh under the given roots is baked in world space into one BVH (spec §6.14).
 * Instanced meshes are ignored (trees get capsules in the region code).
 */
export class CollisionWorld {
  readonly bvh: MeshBVH;
  private readonly ray = new THREE.Ray();
  private readonly cpTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  private readonly tri = new THREE.Triangle();
  private readonly scratchSurface: SurfacePoint = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly scratchContact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

  static fromObjects(objects: readonly THREE.Object3D[]): CollisionWorld {
    const chunks: Float32Array[] = [];
    let total = 0;
    for (const root of objects) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.geometry?.attributes.position) return;
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        const arr = new Float32Array(g.attributes.position.array as ArrayLike<number>);
        chunks.push(arr);
        total += arr.length;
        g.dispose();
      });
    }
    const pos = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      pos.set(c, off);
      off += c.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new CollisionWorld(geometry);
  }

  constructor(readonly geometry: THREE.BufferGeometry) {
    this.bvh = new MeshBVH(geometry); // builds (and reorders) an index buffer for the triangles
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, out?: RayHit): RayHit | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far);
    if (!hit || !hit.face) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    r.point.copy(hit.point);
    r.distance = hit.distance;
    r.normal.copy(hit.face.normal);
    if (r.normal.dot(this.ray.direction) > 0) r.normal.negate();
    return r;
  }

  /**
   * True when `p` is inside a solid: the first surface straight above it is seen from behind (its outward face
   * normal points up). Needs outward-wound closed meshes or terrain surfaces (no mirrored transforms).
   */
  isInside(p: THREE.Vector3, maxUp = 50): boolean {
    this.ray.origin.copy(p);
    this.ray.direction.set(0, 1, 0);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, maxUp);
    return !!hit?.face && hit.face.normal.y > 0;
  }

  /** Ground straight below (x, top, z), searching `depth` metres down. */
  groundAt(x: number, z: number, top: number, depth: number, out?: RayHit): RayHit | null {
    return this.raycast(_o.set(x, top, z), DOWN, depth, out);
  }

  closestPoint(p: THREE.Vector3, maxDist: number, out?: SurfacePoint): SurfacePoint | null {
    const hit = this.bvh.closestPointToPoint(p, this.cpTarget, 0, maxDist);
    if (!hit) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    r.point.copy(hit.point);
    r.distance = hit.distance;
    const index = this.geometry.index!.array;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const f = hit.faceIndex * 3;
    this.tri.a.fromBufferAttribute(pos, index[f]);
    this.tri.b.fromBufferAttribute(pos, index[f + 1]);
    this.tri.c.fromBufferAttribute(pos, index[f + 2]);
    this.tri.getNormal(r.normal);
    return r;
  }

  /** Deepest-point contact of a sphere with the world, or null. Centres behind a face (inside a solid) push out along its normal. */
  sphereContact(center: THREE.Vector3, radius: number, out?: SphereContact): SphereContact | null {
    const s = this.closestPoint(center, radius, this.scratchSurface);
    if (!s) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };
    r.point.copy(s.point);
    _v.subVectors(center, s.point);
    const dist = _v.length();
    if (dist < 1e-9 || _v.dot(s.normal) < 0) {
      r.normal.copy(s.normal);
      r.depth = radius + dist;
    } else {
      r.normal.copy(_v).divideScalar(dist);
      r.depth = radius - dist;
    }
    return r.depth > 0 ? r : null;
  }

  /** Push `center` out of the world (a few passes for corners). Returns the total push distance. */
  resolveSphere(center: THREE.Vector3, radius: number, iterations = 4): number {
    let total = 0;
    for (let k = 0; k < iterations; k++) {
      const c = this.sphereContact(center, radius, this.scratchContact);
      if (!c || c.depth < 1e-6) break;
      center.addScaledVector(c.normal, c.depth + 1e-5);
      total += c.depth;
    }
    return total;
  }

  /**
   * Fraction t ∈ [0, 1] of the segment a sphere can travel from `from` toward `to` before touching the world.
   * Samples every radius/2 (no tunnelling through walls thinner than the step), then bisects the first hit.
   */
  sphereCast(from: THREE.Vector3, to: THREE.Vector3, radius: number): number {
    if (this.closestPoint(from, radius, this.scratchSurface)) return 0;
    const len = from.distanceTo(to);
    if (len < 1e-9) return 1;
    const n = Math.max(1, Math.ceil(len / Math.max(radius * 0.5, 0.02)));
    let prev = 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this.closestPoint(_p.lerpVectors(from, to, t), radius, this.scratchSurface)) {
        let lo = prev;
        let hi = t;
        for (let b = 0; b < 10; b++) {
          const mid = (lo + hi) / 2;
          if (this.closestPoint(_p.lerpVectors(from, to, mid), radius, this.scratchSurface)) hi = mid;
          else lo = mid;
        }
        return lo;
      }
      prev = t;
    }
    return 1;
  }
}
