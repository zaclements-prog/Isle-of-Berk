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
const _rayBoxHit = new THREE.Vector3();

/** World-space, non-indexed triangle positions (9 floats per triangle) of every mesh under the given roots. */
export function trianglesOf(objects: readonly THREE.Object3D[]): Float32Array {
  const chunks: Float32Array[] = [];
  let total = 0;
  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.geometry?.attributes.position) return;
      chunks.push(geometryTriangles(mesh.geometry, mesh.matrixWorld));
      total += chunks[chunks.length - 1].length;
    });
  }
  return concat(chunks, total);
}

/** A geometry's triangles as world-space non-indexed positions (through `matrix` when given). */
export function geometryTriangles(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): Float32Array {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const arr = new Float32Array(g.attributes.position.array as ArrayLike<number>);
  g.dispose();
  return arr;
}

function concat(chunks: readonly Float32Array[], total = chunks.reduce((n, c) => n + c.length, 0)): Float32Array {
  const pos = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    pos.set(c, off);
    off += c.length;
  }
  return pos;
}

/**
 * One BVH over a fixed set of triangles: a static tile of terrain, or one tile of a dynamic set. Rebuilt whole when its
 * triangles change (a crater, a felled tree), so layers are kept small (a 64 m tile).
 */
export class CollisionLayer {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH | null = null;
  readonly box = new THREE.Box3();
  enabled = true;
  /** Query dedupe stamp (internal). */
  stamp = 0;
  /** Grid cells this layer is filed under (internal). */
  cells: number[] = [];

  constructor(readonly id: number, readonly name: string, positions: Float32Array) {
    this.geometry = new THREE.BufferGeometry();
    this.set(positions);
  }

  get triangles(): number {
    return (this.geometry.attributes.position?.count ?? 0) / 3;
  }

  /** Replace the triangles and rebuild the BVH. */
  set(positions: Float32Array): void {
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.box.makeEmpty();
    if (positions.length >= 9) {
      this.bvh = new MeshBVH(this.geometry); // builds (and reorders) an index buffer for the triangles
      this.geometry.computeBoundingBox();
      this.box.copy(this.geometry.boundingBox!);
    } else {
      this.bvh = null;
    }
  }

  /**
   * Move vertices in place (the triangles stay the same) and refit the BVH's bounds instead of rebuilding it: a
   * crater only lowers heights, and a refit costs a fraction of a rebuild. `mutate` gets the live position array and
   * returns whether it changed anything.
   */
  refit(mutate: (positions: Float32Array) => boolean): boolean {
    const attr = this.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!attr || !this.bvh || !mutate(attr.array as Float32Array)) return false;
    attr.needsUpdate = true;
    this.bvh.refit();
    this.bvh.getBoundingBox(this.box); // the refit root's bounds: no second pass over the vertices
    this.geometry.boundingBox = this.box.clone();
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.bvh = null;
  }
}

/**
 * A set of separately removable collision members (trees, houses, debris), filed into tiles: each tile is one layer,
 * and adding, moving or removing a member rebuilds only its tile's BVH, lazily, before the next query.
 */
export class CollisionSet {
  private readonly members = new Map<string, { tile: string; positions: Float32Array }>();
  private readonly tiles = new Map<string, { layer: CollisionLayer | null; keys: Set<string>; dirty: boolean }>();
  dirty = false;

  constructor(private readonly world: CollisionWorld, readonly name: string, readonly tile = 64) {}

  get size(): number {
    return this.members.size;
  }

  has(key: string): boolean {
    return this.members.has(key);
  }

  /** Add (or replace) a member: its world-space triangles. */
  add(key: string, positions: Float32Array): void {
    if (this.members.has(key)) this.remove(key);
    let cx = 0;
    let cz = 0;
    const n = positions.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      cx += positions[i];
      cz += positions[i + 2];
    }
    const tile = `${Math.floor(cx / n / this.tile)},${Math.floor(cz / n / this.tile)}`;
    this.members.set(key, { tile, positions });
    const t = this.tiles.get(tile) ?? { layer: null, keys: new Set<string>(), dirty: false };
    t.keys.add(key);
    t.dirty = true;
    this.tiles.set(tile, t);
    this.markDirty();
  }

  remove(key: string): boolean {
    const m = this.members.get(key);
    if (!m) return false;
    this.members.delete(key);
    const t = this.tiles.get(m.tile)!;
    t.keys.delete(key);
    t.dirty = true;
    this.markDirty();
    return true;
  }

  private markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.world.markDirty(this);
    }
  }

  /** Rebuild the tiles that changed (the world calls this before a query). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const [key, t] of this.tiles) {
      if (!t.dirty) continue;
      t.dirty = false;
      const pos = concat([...t.keys].map((k) => this.members.get(k)!.positions));
      if (!t.layer) {
        if (!pos.length) continue;
        t.layer = this.world.addLayer(`${this.name}:${key}`, pos);
      } else if (!pos.length) {
        this.world.removeLayer(t.layer);
        t.layer = null;
      } else {
        this.world.replaceLayer(t.layer, pos);
      }
    }
  }
}

/** Grid cell (m) layers are filed under for queries. */
const CELL = 64;
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/**
 * The collision world (spec §6.14, world-interaction plan §3): a composite of layers, each its own BVH, filed in a
 * 64 m grid so a query only visits the layers near it. Static geometry is one layer, or split into tiles (so a crater
 * rebuilds one or two); dynamic sets (trees, buildings, debris) add and remove members. Every query answers as if the
 * layers were one mesh. Instanced meshes are ignored.
 */
export class CollisionWorld {
  readonly layers: CollisionLayer[] = [];
  private readonly grid = new Map<number, CollisionLayer[]>();
  private readonly dirtySets = new Set<CollisionSet>();
  private readonly tileLayers = new Map<string, CollisionLayer>();
  private nextId = 1;
  private stamp = 0;
  private readonly cand: CollisionLayer[] = [];
  private readonly ray = new THREE.Ray();
  private readonly cpTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  private readonly tri = new THREE.Triangle();
  private readonly scratchSurface: SurfacePoint = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly scratchContact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

  /**
   * Every mesh under the roots, baked in world space. One layer by default; with `tile` (m) the triangles are split
   * into square tiles by centroid, each its own layer (`tileLayer(i, j)`), for rebuilding one tile at a time.
   */
  static fromObjects(objects: readonly THREE.Object3D[], opts: { tile?: number } = {}): CollisionWorld {
    const w = new CollisionWorld();
    const pos = trianglesOf(objects);
    if (opts.tile) w.addTiled('static', pos, opts.tile);
    else w.addLayer('static', pos);
    return w;
  }

  constructor(geometry?: THREE.BufferGeometry) {
    if (geometry) this.addLayer('static', geometryTriangles(geometry));
  }

  /** Total triangles across the enabled layers. */
  get triangles(): number {
    this.flush();
    let n = 0;
    for (const l of this.layers) if (l.enabled) n += l.triangles;
    return n;
  }

  addLayer(name: string, positions: Float32Array): CollisionLayer {
    const l = new CollisionLayer(this.nextId++, name, positions);
    this.layers.push(l);
    this.file(l);
    return l;
  }

  removeLayer(l: CollisionLayer): void {
    const k = this.layers.indexOf(l);
    if (k < 0) return;
    this.unfile(l);
    this.layers.splice(k, 1);
    for (const [key, t] of this.tileLayers) if (t === l) this.tileLayers.delete(key);
    l.dispose();
  }

  replaceLayer(l: CollisionLayer, positions: Float32Array): void {
    this.unfile(l);
    l.set(positions);
    this.file(l);
  }

  /** Move a layer's vertices in place and refit its BVH (same triangles); see `CollisionLayer.refit`. */
  refitLayer(l: CollisionLayer, mutate: (positions: Float32Array) => boolean): boolean {
    this.unfile(l);
    const changed = l.refit(mutate);
    this.file(l);
    return changed;
  }

  /** Split triangles into `tile`-metre square layers by centroid (named `${name}:i,j`). */
  addTiled(name: string, positions: Float32Array, tile: number): CollisionLayer[] {
    const buckets = new Map<string, number[]>();
    for (let t = 0; t < positions.length; t += 9) {
      const cx = (positions[t] + positions[t + 3] + positions[t + 6]) / 3;
      const cz = (positions[t + 2] + positions[t + 5] + positions[t + 8]) / 3;
      const key = `${Math.floor(cx / tile)},${Math.floor(cz / tile)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      for (let k = 0; k < 9; k++) b.push(positions[t + k]);
    }
    const out: CollisionLayer[] = [];
    for (const [key, b] of buckets) {
      const l = this.addLayer(`${name}:${key}`, new Float32Array(b));
      this.tileLayers.set(key, l);
      out.push(l);
    }
    return out;
  }

  /** The static tile layer at grid (i, j) from fromObjects({ tile }) / addTiled. */
  tileLayer(i: number, j: number): CollisionLayer | undefined {
    return this.tileLayers.get(`${i},${j}`);
  }

  /** A dynamic set of removable members (trees, buildings, debris). */
  createSet(name: string, tile = 64): CollisionSet {
    return new CollisionSet(this, name, tile);
  }

  /** Internal: a set has pending changes; it is flushed before the next query. */
  markDirty(s: CollisionSet): void {
    this.dirtySets.add(s);
  }

  /** Apply every pending set change now (queries do this themselves). */
  flush(): void {
    if (!this.dirtySets.size) return;
    const sets = [...this.dirtySets];
    this.dirtySets.clear();
    for (const s of sets) s.flush();
  }

  private file(l: CollisionLayer): void {
    if (!l.bvh) return;
    const i0 = Math.floor(l.box.min.x / CELL);
    const i1 = Math.floor(l.box.max.x / CELL);
    const j0 = Math.floor(l.box.min.z / CELL);
    const j1 = Math.floor(l.box.max.z / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = cellKey(i, j);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(l);
        l.cells.push(k);
      }
    }
  }

  private unfile(l: CollisionLayer): void {
    for (const k of l.cells) {
      const list = this.grid.get(k)!;
      const at = list.indexOf(l);
      if (at >= 0) list.splice(at, 1);
      if (!list.length) this.grid.delete(k);
    }
    l.cells = [];
  }

  /** The enabled layers whose grid cells overlap the xz rectangle (each once), into this.cand. */
  private gather(minX: number, minZ: number, maxX: number, maxZ: number): CollisionLayer[] {
    this.flush();
    const c = this.cand;
    c.length = 0;
    const i0 = Math.floor(minX / CELL);
    const i1 = Math.floor(maxX / CELL);
    const j0 = Math.floor(minZ / CELL);
    const j1 = Math.floor(maxZ / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.grid.size) {
      for (const l of this.layers) if (l.enabled && l.bvh) c.push(l);
      return c;
    }
    const s = ++this.stamp;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.grid.get(cellKey(i, j));
        if (!list) continue;
        for (const l of list) {
          if (l.stamp === s || !l.enabled) continue;
          l.stamp = s;
          c.push(l);
        }
      }
    }
    return c;
  }

  /** First hit along the ray within `far`, over every layer: the hit and the face normal it was found with. */
  private castFirst(origin: THREE.Vector3, dir: THREE.Vector3, far: number): { hit: THREE.Intersection; layer: CollisionLayer } | null {
    const r = this.ray;
    r.origin.copy(origin);
    r.direction.copy(dir).normalize();
    const ex = r.origin.x + r.direction.x * far;
    const ez = r.origin.z + r.direction.z * far;
    const layers = this.gather(Math.min(r.origin.x, ex), Math.min(r.origin.z, ez), Math.max(r.origin.x, ex), Math.max(r.origin.z, ez));
    let best: THREE.Intersection | null = null;
    let bestLayer: CollisionLayer | null = null;
    let lim = far;
    for (const l of layers) {
      if (!l.box.containsPoint(r.origin)) {
        const b = r.intersectBox(l.box, _rayBoxHit);
        if (!b || b.distanceTo(r.origin) > lim) continue;
      }
      const hit = l.bvh!.raycastFirst(r, THREE.DoubleSide, 0, lim);
      if (hit && hit.face && hit.distance <= lim) {
        best = hit;
        bestLayer = l;
        lim = hit.distance;
      }
    }
    return best && bestLayer ? { hit: best, layer: bestLayer } : null;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, out?: RayHit): RayHit | null {
    const found = this.castFirst(origin, dir, far);
    if (!found) return null;
    const { hit } = found;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    r.point.copy(hit.point);
    r.distance = hit.distance;
    r.normal.copy(hit.face!.normal);
    if (r.normal.dot(this.ray.direction) > 0) r.normal.negate();
    return r;
  }

  /**
   * True when `p` is inside a solid: the first surface straight above it is seen from behind (its outward face
   * normal points up). Needs outward-wound closed meshes or terrain surfaces (no mirrored transforms).
   */
  isInside(p: THREE.Vector3, maxUp = 50): boolean {
    return this.depthInside(p, maxUp) >= 0;
  }

  /** How far (m) `p` lies inside a solid, measured up to the surface above it (see isInside); −1 when outside. */
  depthInside(p: THREE.Vector3, maxUp = 50): number {
    const found = this.castFirst(p, _o.set(0, 1, 0), maxUp);
    return found && found.hit.face!.normal.y > 0 ? found.hit.distance : -1;
  }

  /** Ground straight below (x, top, z), searching `depth` metres down. */
  groundAt(x: number, z: number, top: number, depth: number, out?: RayHit): RayHit | null {
    return this.raycast(_p.set(x, top, z), DOWN, depth, out);
  }

  /**
   * Closest surface point within `maxDist` of `p`, or null. three-mesh-bvh prunes by bounding box, not by triangle,
   * so its result can lie beyond maxDist when a leaf's box is nearer than its triangles; that result is discarded.
   */
  closestPoint(p: THREE.Vector3, maxDist: number, out?: SurfacePoint): SurfacePoint | null {
    const layers = this.gather(p.x - maxDist, p.z - maxDist, p.x + maxDist, p.z + maxDist);
    let lim = maxDist;
    let bestLayer: CollisionLayer | null = null;
    let bestFace = 0;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    for (const l of layers) {
      if (l.box.distanceToPoint(p) > lim) continue;
      const hit = l.bvh!.closestPointToPoint(p, this.cpTarget, 0, lim);
      if (!hit || hit.distance > lim) continue;
      lim = hit.distance;
      bestLayer = l;
      bestFace = hit.faceIndex;
      r.point.copy(hit.point);
      r.distance = hit.distance;
    }
    if (!bestLayer) return null;
    const index = bestLayer.geometry.index!.array;
    const pos = bestLayer.geometry.attributes.position as THREE.BufferAttribute;
    const f = bestFace * 3;
    this.tri.a.fromBufferAttribute(pos, index[f]);
    this.tri.b.fromBufferAttribute(pos, index[f + 1]);
    this.tri.c.fromBufferAttribute(pos, index[f + 2]);
    this.tri.getNormal(r.normal);
    return r;
  }

  /** Deepest-point contact of a sphere with the world, or null. Centres behind a face (inside a solid) push out along its normal. Contacts are searched within one radius; a centre embedded deeper is not resolved. */
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
   * Uses conservative advancement: at each step, queries the clearance to the nearest surface and advances by that distance.
   * The returned t is always non-contacting by construction (with a 1e-6 safety margin for floating-point error). Caps at 64 iterations.
   */
  sphereCast(from: THREE.Vector3, to: THREE.Vector3, radius: number, stats?: { queries: number }): number {
    if (stats) stats.queries++;
    // a real contact only: a nearest surface merely found nearby does not stop the cast at its start (that stopped
    // every cast starting inside a far surface's bounds, and the camera fell into him)
    if (this.sphereContact(from, radius, this.scratchContact)) return 0;
    const len = from.distanceTo(to);
    if (len < 1e-9) return 1;
    const dir = _v.subVectors(to, from).normalize();
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    let t = 0;
    for (let iter = 0; iter < 64; iter++) {
      const remainingLen = len * (1 - t);
      const q = _p.set(from.x + dx * len * t, from.y + dy * len * t, from.z + dz * len * t);
      const hit = this.closestPoint(q, remainingLen + radius, this.scratchSurface);
      if (stats) stats.queries++;
      if (!hit) return 1; // Rest of path is clear
      const clearance = hit.distance - radius;
      if (clearance <= 1e-4) return t; // Close enough to stop; t is still clear by construction
      // Advance with 1e-6 safety margin to avoid floating-point penetration
      t += Math.max(0, clearance - 1e-6) / len;
      if (t >= 1) return 1;
    }
    return t;
  }

  /** Up to `maxTris` world-space triangles touching the box, appended to `out` as 9 floats each. */
  trianglesInBox(box: THREE.Box3, maxTris: number, out: number[]): number[] {
    const layers = this.gather(box.min.x, box.min.z, box.max.x, box.max.z);
    for (const l of layers) {
      if (!l.box.intersectsBox(box)) continue;
      l.bvh!.shapecast({
        intersectsBounds: (b) => b.intersectsBox(box),
        intersectsTriangle: (tri) => {
          if (tri.intersectsBox(box)) out.push(tri.a.x, tri.a.y, tri.a.z, tri.b.x, tri.b.y, tri.b.z, tri.c.x, tri.c.y, tri.c.z);
          return out.length >= maxTris * 9;
        },
      });
      if (out.length >= maxTris * 9) break;
    }
    return out;
  }
}
