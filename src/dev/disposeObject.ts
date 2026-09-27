import * as THREE from 'three';

type Drawable = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

/**
 * Frees GPU resources under `root`:
 * - the geometry and materials of every Mesh (incl. SkinnedMesh/InstancedMesh), Points, Line and
 *   LineSegments; a Sprite's material only (every sprite shares one module-level geometry);
 * - each SkinnedMesh's skeleton (its bone texture);
 * - every texture found among a material's own property values (maps, envMap, etc.), and the
 *   decoded ImageBitmap behind it — GLTFLoader decodes to ImageBitmaps in the browser, and
 *   texture.dispose() frees only the GPU copy, so the bitmap is closed right after.
 * Each resource is freed once, however many objects under root share it. Call this before dropping a
 * subtree that was ever added through the app (loaded glTFs, generated meshes) — three never does
 * this for you when an object is merely removed from the scene. Everything under root must be owned
 * by it: a resource shared with a live object elsewhere is freed too. (App.remove does this plus the
 * CSM release; prefer it for anything added with App.add.)
 */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const d = o as Drawable;
    const isSprite = (o as THREE.Sprite).isSprite === true;
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || isSprite) {
      if (d.geometry && !isSprite) geometries.add(d.geometry);
      for (const m of Array.isArray(d.material) ? d.material : [d.material]) if (m) materials.add(m);
    }
    const skeleton = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : undefined;
    if (skeleton) skeletons.add(skeleton);
  });

  const textures = new Set<THREE.Texture>();
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
  }
  for (const g of geometries) g.dispose();
  for (const t of textures) {
    t.dispose();
    const data = t.source?.data as { close?: unknown } | null | undefined;
    if (data && typeof data.close === 'function') (data as ImageBitmap).close();
  }
  for (const m of materials) m.dispose();
  for (const s of skeletons) s.dispose();
}
