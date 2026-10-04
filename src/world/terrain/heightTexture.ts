import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/**
 * The heightfield as a half-float red texture (one texel per sample), for shaders that need the ground height:
 * the rock base blend (M7a) and grass placement (M7b). Row j is z; no flip. Half floats keep ~1 cm precision
 * below 16 m and ~3 cm on the tallest rims — fine for blending and grass roots.
 */
export function createHeightTexture(hf: Heightfield): THREE.DataTexture {
  const data = new Uint16Array(hf.heights.length);
  for (let k = 0; k < data.length; k++) data[k] = THREE.DataUtils.toHalfFloat(hf.heights[k]);
  const tex = new THREE.DataTexture(data, hf.size, hf.size, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * (x0, z0, 1/width, 1/depth) mapping world xz to texel-centre UVs of any per-sample terrain texture
 * (height, splat): uv = (xz − (origin − spacing/2)) / (size · spacing).
 */
export function terrainUvTransform(hf: Heightfield, out = new THREE.Vector4()): THREE.Vector4 {
  const start = hf.origin - hf.spacing / 2;
  const inv = 1 / (hf.size * hf.spacing);
  return out.set(start, start, inv, inv);
}
