import * as THREE from 'three';

export interface GradeParams {
  /** 1 = unchanged. */
  saturation: number;
  /** 1 = unchanged; pivots around mid grey (display space). */
  contrast: number;
  /** Display-space RGB offsets added to shadows. */
  shadowTint: [number, number, number];
  /** Display-space RGB offsets added to highlights. */
  highlightTint: [number, number, number];
  /** Extra warm push in highlights (red up, blue down). */
  warmth: number;
  /** 0..1 corner darkening. */
  vignette: number;
}

export const NEUTRAL_GRADE: GradeParams = {
  saturation: 1, contrast: 1, shadowTint: [0, 0, 0], highlightTint: [0, 0, 0], warmth: 0, vignette: 0,
};

/** Starting film look (HTTYD 2/3 golden hour): gentle contrast, richer colour, cool shadows, warm highlights. */
export const FILM_GRADE: GradeParams = {
  saturation: 1.12, contrast: 1.05, shadowTint: [-0.012, 0.0, 0.02], highlightTint: [0.018, 0.008, -0.01], warmth: 0.015, vignette: 0.16,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** The grade as a pure display-space colour transform (baked into the LUT; also used by tests). */
export function gradeColor(r: number, g: number, b: number, p: GradeParams): [number, number, number] {
  let R = (r - 0.5) * p.contrast + 0.5;
  let G = (g - 0.5) * p.contrast + 0.5;
  let B = (b - 0.5) * p.contrast + 0.5;
  const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  R = l + (R - l) * p.saturation;
  G = l + (G - l) * p.saturation;
  B = l + (B - l) * p.saturation;
  const ws = 1 - smoothstep(0.0, 0.55, l);
  const wh = smoothstep(0.45, 1.0, l);
  R += p.shadowTint[0] * ws + (p.highlightTint[0] + p.warmth) * wh;
  G += p.shadowTint[1] * ws + p.highlightTint[1] * wh;
  B += p.shadowTint[2] * ws + (p.highlightTint[2] - p.warmth) * wh;
  return [clamp01(R), clamp01(G), clamp01(B)];
}

/** RGBA8 3D LUT data: red fastest, then green, then blue (Data3DTexture layout). */
export function bakeLutData(p: GradeParams, size = 32): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        const [r, g, b] = gradeColor(rx / (size - 1), gy / (size - 1), bz / (size - 1), p);
        data[i++] = Math.round(r * 255);
        data[i++] = Math.round(g * 255);
        data[i++] = Math.round(b * 255);
        data[i++] = 255;
      }
    }
  }
  return data;
}

export function bakeLut(p: GradeParams, size = 32): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(bakeLutData(p, size), size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
