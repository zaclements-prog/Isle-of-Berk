import * as THREE from 'three';

/** One splat layer: its Poly Haven id (folder under assets/textures/terrain/) and metres per texture repeat. */
export interface TerrainLayer {
  id: string;
  tile: number;
}

/** Splat order is fixed by the bake: grass, forest, moss, mud, pebbles, rock (splatA rgba, splatB rg). */
export const COVE_LAYERS: readonly TerrainLayer[] = [
  { id: 'sparse_grass', tile: 2.0 },
  { id: 'forest_ground_04', tile: 3.15 },
  { id: 'mossy_rock', tile: 3.0 },
  { id: 'mud_forest', tile: 2.35 },
  { id: 'pebble_ground_01', tile: 1.5 },
  { id: 'rock_wall_02', tile: 3.5 }, // cliffs: 1.75× the scan's scale, so the big walls don't stripe
];

/** A per-layer albedo multiplier in linear RGB (channels may exceed 1: they shift a scan's hue, not just darken it). */
export type LayerTint = readonly [number, number, number];

/**
 * The Cove's default layer tints (splat order), multiplied into each layer's albedo (`uLayerTint`). The scans are
 * dry and warm, and the 14° golden sun warms them further, so the tints move them to the film Cove's palette
 * under GOLDEN_HOUR: olive-green grass, dark brown-green forest floor, green moss, dark brown mud, grey pebbles and
 * cool grey-brown rock that sits with the scanned mossy rocks (not orange).
 */
export const COVE_LAYER_TINTS: readonly LayerTint[] = [
  [0.72, 1.9, 2.3], // grass
  [0.32, 0.48, 0.3], // forest
  [0.34, 0.74, 0.3], // moss
  [0.9, 1.0, 1.1], // mud
  [0.52, 0.66, 0.86], // pebbles
  [0.62, 1.0, 2.25], // rock
];

export interface LayerArrays {
  /** sRGB albedo. */
  albedo: THREE.DataArrayTexture;
  /** OpenGL tangent-space normals. */
  normal: THREE.DataArrayTexture;
  /** R = ambient occlusion, G = roughness, B = blend height (terrain metalness is always 0). */
  armh: THREE.DataArrayTexture;
  dispose(): void;
}

/**
 * Copies `height` rows of RGBA pixels into `dst` at `offset` bytes, bottom row first, so v = 0 is the image's
 * bottom row (the OpenGL convention the normal maps are authored in).
 */
export function flipRowsInto(src: Uint8ClampedArray | Uint8Array, dst: Uint8Array, offset: number, width: number, height: number): void {
  const row = width * 4;
  for (let y = 0; y < height; y++) dst.set(src.subarray((height - 1 - y) * row, (height - y) * row), offset + y * row);
}

function makeArray(data: Uint8Array, size: number, depth: number, srgb: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, size, size, depth);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Decodes an opaque WebP at `size`² with no colour management (exact data for normal/armh maps). */
async function decodeRgba(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain layer ${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('terrain layers: no 2D context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * Loads every layer's albedo.webp, nor.webp and armh.webp (written by `npm run cc0:terrain`) into three
 * DataArrayTextures of `size`² (1024 on High, 512 on Low).
 */
export async function loadLayerArrays(baseUrl: string, layers: readonly TerrainLayer[], size: number): Promise<LayerArrays> {
  const bytes = size * size * 4;
  const albedo = new Uint8Array(bytes * layers.length);
  const normal = new Uint8Array(bytes * layers.length);
  const armh = new Uint8Array(bytes * layers.length);
  await Promise.all(layers.map(async (layer, l) => {
    const dir = `${baseUrl}${layer.id}/`;
    const [a, n, h] = await Promise.all([
      decodeRgba(`${dir}albedo.webp`, size), decodeRgba(`${dir}nor.webp`, size), decodeRgba(`${dir}armh.webp`, size),
    ]);
    flipRowsInto(a, albedo, l * bytes, size, size);
    flipRowsInto(n, normal, l * bytes, size, size);
    flipRowsInto(h, armh, l * bytes, size, size);
  }));
  const arrays = {
    albedo: makeArray(albedo, size, layers.length, true),
    normal: makeArray(normal, size, layers.length, false),
    armh: makeArray(armh, size, layers.length, false),
  };
  return {
    ...arrays,
    dispose() {
      arrays.albedo.dispose();
      arrays.normal.dispose();
      arrays.armh.dispose();
    },
  };
}

/**
 * Splat maps as textures that keep their exact channel values: an ImageBitmap decoded with premultiplyAlpha
 * 'none' (a plain <img> upload would premultiply and zero the RGB weights wherever the mud weight in alpha is 0).
 * Row j of the PNG is z, so no flip.
 */
export async function loadSplatTexture(url: string): Promise<THREE.Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`splat ${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
