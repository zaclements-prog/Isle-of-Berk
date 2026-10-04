// Terrain splat layers: which Poly Haven textures, and how their maps are packed for the runtime arrays.

/** Splat order is fixed by the terrain bake: grass, forest, moss, mud, pebbles, rock. */
export const TERRAIN_LAYER_IDS = ['sparse_grass', 'forest_ground_04', 'mossy_rock', 'mud_forest', 'pebble_ground_01', 'rock_wall_02'];

/** Poly Haven file-name token of each source map (`<id>_<token>_<res>.<ext>`). */
export const LAYER_TOKENS = { diff: 'diff', nor: 'nor_gl', arm: 'arm', disp: 'disp' };

/**
 * The 'armh' map: R = ambient occlusion (arm.r), G = roughness (arm.g), B = height (displacement). Terrain
 * metalness is always 0, so its channel carries the height the splat height-blend needs — and the map stays
 * opaque, so browser canvas decoding returns exact values.
 * @param {Uint8Array} arm interleaved RGB, `pixels` × 3 bytes
 * @param {Uint8Array} disp single channel, `pixels` bytes
 */
export function packArmh(arm, disp, pixels) {
  if (arm.length < pixels * 3 || disp.length < pixels) throw new Error('packArmh: buffers shorter than the pixel count');
  const out = Buffer.alloc(pixels * 3);
  for (let k = 0; k < pixels; k++) {
    out[k * 3] = arm[k * 3];
    out[k * 3 + 1] = arm[k * 3 + 1];
    out[k * 3 + 2] = disp[k];
  }
  return out;
}
