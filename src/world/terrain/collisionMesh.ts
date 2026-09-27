import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/** Full 0.4 m resolution where Toothless walks and climbs; 1.6 m out to the far forest. */
export interface CollisionBands {
  fine: { radius: number; step: number };
  coarse: { radius: number; step: number };
}
export const COVE_COLLISION: CollisionBands = { fine: { radius: 80, step: 1 }, coarse: { radius: 200, step: 4 } };

/**
 * Non-indexed world-space triangles of the terrain for Plan 3's CollisionWorld. The grid is walked in coarse blocks:
 * a block whose centre lies within the fine radius is emitted as full-resolution cells (the same triangles as the
 * LOD0 render chunks), a block within the coarse radius as one coarse cell. Deciding per block makes the two bands
 * an exact partition of the ground — no holes and no doubled surfaces where they meet. Winding is CCW from +Y
 * (outward), which CollisionWorld.isInside relies on.
 */
export function terrainCollisionGeometry(hf: Heightfield, bands: CollisionBands = COVE_COLLISION): THREE.BufferGeometry {
  const tris: number[] = [];
  const last = hf.size - 1;
  const cell = (i: number, j: number, s: number) => {
    const i1 = Math.min(last, i + s);
    const j1 = Math.min(last, j + s);
    const x0 = hf.coord(i);
    const x1 = hf.coord(i1);
    const z0 = hf.coord(j);
    const z1 = hf.coord(j1);
    const h00 = hf.sample(i, j);
    const h10 = hf.sample(i1, j);
    const h01 = hf.sample(i, j1);
    const h11 = hf.sample(i1, j1);
    tris.push(x0, h00, z0, x0, h01, z1, x1, h10, z0, x1, h10, z0, x0, h01, z1, x1, h11, z1);
  };
  const C = bands.coarse.step;
  const F = bands.fine.step;
  if (C % F !== 0) throw new Error('coarse step must be a multiple of the fine step');
  for (let j = 0; j < last; j += C) {
    for (let i = 0; i < last; i += C) {
      const d = Math.hypot(hf.coord(i) + (C * hf.spacing) / 2, hf.coord(j) + (C * hf.spacing) / 2);
      if (d < bands.fine.radius) {
        for (let jj = j; jj < Math.min(j + C, last); jj += F) for (let ii = i; ii < Math.min(i + C, last); ii += F) cell(ii, jj, F);
      } else if (d < bands.coarse.radius) {
        cell(i, j, C);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  return g;
}

/** An invisible, never-rendered collision root (pass it to CollisionWorld.fromObjects, not to the scene). */
export function terrainCollisionRoot(hf: Heightfield, bands: CollisionBands = COVE_COLLISION): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'TerrainCollision';
  const mesh = new THREE.Mesh(terrainCollisionGeometry(hf, bands), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = 'terrain-collision';
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
}
