import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { buildChunkGeometry, chunkBounds, chunkGrid, LOD_STEPS, selectLod, type ChunkCoord } from './chunks';
import { terrainCollisionRoot } from './collisionMesh';

/** LOD k is used up to lodDistances[k] metres (× the preset's lodDistanceScale); beyond the last, the coarsest. */
export const TERRAIN_LOD_DISTANCES = [70, 140, 240] as const;

interface ChunkState {
  coord: ChunkCoord;
  mesh: THREE.Mesh;
  box: THREE.Box3;
  lod: number;
  geos: (THREE.BufferGeometry | null)[];
}

/**
 * The rendered terrain: 7 × 7 chunk meshes sharing one splat material, each swapping between four LOD geometries
 * (built lazily and cached) by camera distance, plus the invisible collision root.
 */
export class Terrain {
  readonly root = new THREE.Group();
  readonly collisionRoot: THREE.Object3D;
  private readonly chunks: ChunkState[] = [];
  private readonly thresholds: number[];
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly hf: Heightfield,
    readonly material: THREE.Material,
    lodDistanceScale = 1,
    readonly skirtDepth = 1.5,
  ) {
    this.root.name = 'Terrain';
    this.thresholds = TERRAIN_LOD_DISTANCES.map((d) => d * lodDistanceScale);
    for (const coord of chunkGrid(hf.size)) {
      const box = chunkBounds(hf, coord);
      // start every chunk at the coarsest LOD (cheap), so no mesh ever has an empty geometry
      const coarsest = LOD_STEPS.length - 1;
      const geos: (THREE.BufferGeometry | null)[] = LOD_STEPS.map(() => null);
      geos[coarsest] = buildChunkGeometry(hf, coord, LOD_STEPS[coarsest], skirtDepth * LOD_STEPS[coarsest]);
      const mesh = new THREE.Mesh(geos[coarsest]!, material);
      mesh.name = `terrain_${coord.cx}_${coord.cz}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.chunks.push({ coord, mesh, box, lod: coarsest, geos });
    }
    this.collisionRoot = terrainCollisionRoot(hf);
  }

  /** Picks each chunk's LOD from the camera distance to its bounds (hysteresis inside selectLod). */
  update(camera: THREE.Camera): void {
    const cam = camera.getWorldPosition(this.tmp);
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(cam);
      const lod = selectLod(d, c.lod, this.thresholds);
      if (lod === c.lod) continue;
      let g = c.geos[lod];
      if (!g) {
        g = buildChunkGeometry(this.hf, c.coord, LOD_STEPS[lod], this.skirtDepth * LOD_STEPS[lod]);
        c.geos[lod] = g;
      }
      c.mesh.geometry = g;
      c.lod = lod;
    }
  }

  /** Enables render `layer` on every chunk whose bounds overlap the world rectangle [x0, z0, x1, z1]. */
  enableLayerIn(layer: number, rect: readonly [number, number, number, number]): number {
    let n = 0;
    for (const c of this.chunks) {
      if (c.box.max.x < rect[0] || c.box.min.x > rect[2] || c.box.max.z < rect[1] || c.box.min.z > rect[3]) continue;
      c.mesh.layers.enable(layer);
      n++;
    }
    return n;
  }

  /** Current LOD per chunk and the triangles they draw (for perf readouts and tests). */
  stats(): { lods: number[]; triangles: number } {
    let triangles = 0;
    for (const c of this.chunks) {
      const idx = c.mesh.geometry.index;
      if (idx) triangles += idx.count / 3;
    }
    return { lods: this.chunks.map((c) => c.lod), triangles };
  }

  dispose(): void {
    for (const c of this.chunks) for (const g of c.geos) g?.dispose();
    this.root.removeFromParent();
    this.collisionRoot.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
