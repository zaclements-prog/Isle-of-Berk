import * as THREE from 'three';

/**
 * Frees GPU resources under `root`: every mesh's geometry, each of its materials, and every
 * texture found among each material's own property values (maps, envMap, etc.). Call this before
 * dropping a subtree that was ever added through the app (loaded glTFs, generated meshes) — three
 * never does this for you when an object is merely removed from the scene.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
}
