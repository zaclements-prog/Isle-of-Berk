import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * The dragon's look (visual identity, 2026-11-01): 'faceted' is the game's default, a low-poly body in planes that
 * match the island's faceted terrain; 'film' is the original smooth sculpt with procedural scales. `?look=film` on
 * any page brings the film look back.
 */
export type DragonLook = 'faceted' | 'film';

export function dragonLook(search: string): DragonLook {
  return new URLSearchParams(search).get('look') === 'film' ? 'film' : 'faceted';
}

/**
 * Share of each mesh's triangles the faceted look keeps: the 70k-triangle body and wings keep 4% (~2.8k), the small
 * parts (eyes, teeth, claws, tack) at least 18% so they still read. `error` is meshoptimizer's relative error bound:
 * generous on purpose, so the sculpt's curves flatten into planes (that IS the look).
 */
export const FACET = { body: 0.04, part: 0.18, error: 0.08 };

/**
 * Re-index each mesh at the faceted density, in place. meshoptimizer returns a new index buffer over the SAME
 * vertices, so skin weights, the face morphs and the `_mask` attribute all stay valid; only which vertices the
 * triangles join changes. Borders are not locked, so the mouth, eye and membrane edges simplify too. Pass each
 * mesh's part name (its GLB material name). Returns the triangles kept.
 *
 * Runtime stand-in: the plan is to author the low-poly mesh in the Blender build (weighted and QA'd like the sculpt).
 */
export async function facetMeshes(meshes: readonly { mesh: THREE.Mesh; part: string }[], f = FACET): Promise<number> {
  await MeshoptSimplifier.ready;
  let tris = 0;
  for (const { mesh, part } of meshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position.array as Float32Array;
    const idx = g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const ratio = part === 'skin' || part === 'membrane' ? f.body : Math.max(f.body, f.part);
    const target = Math.max(12, Math.floor((idx.length * ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, f.error, ['Prune']);
    g.setIndex(new THREE.BufferAttribute(out, 1));
    tris += out.length / 3;
  }
  return tris;
}
