import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';
import { SPLAT_VERTEX, SPLAT_VERTEX_PARS } from '../terrain/splatShader';

/**
 * The island's stylised palette (sRGB hex), per splat layer: grass, forest floor, moss, mud, pebbles (shingle beach),
 * rock. Plus the second grass tone the meadows drift toward, and the rock's lighter strata.
 */
export const STYLE_PALETTE = {
  grass: 0x6c9a3b,
  grassAlt: 0x8bb04a,
  forest: 0x3d5a2c,
  moss: 0x5f8236,
  mud: 0x6e573b,
  pebbles: 0xc4b28c,
  rock: 0x6d6d6c,
  rockLight: 0x82827f,
};

export interface StylizedTerrainUniforms {
  tTerrainSplatA: { value: THREE.Texture | null };
  tTerrainSplatB: { value: THREE.Texture | null };
  uTerrainExtent: { value: THREE.Vector4 };
  uStyleColors: { value: THREE.Color[] };
  /** 0…1: how faceted (low-poly) the shading is on gentle ground; rock always takes more. */
  uFacet: { value: number };
  /** The burn mask (damage/burnMask): R scorch darkens the ground to char. Same mapping as uTerrainExtent. */
  tTerrainBurn: { value: THREE.Texture | null };
}

function blankBurn(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

export function createStylizedUniforms(): StylizedTerrainUniforms {
  const P = STYLE_PALETTE;
  return {
    tTerrainSplatA: { value: null },
    tTerrainSplatB: { value: null },
    uTerrainExtent: { value: new THREE.Vector4() },
    uStyleColors: { value: [P.grass, P.forest, P.moss, P.mud, P.pebbles, P.rock, P.grassAlt, P.rockLight].map((c) => new THREE.Color(c)) },
    uFacet: { value: 0.35 },
    tTerrainBurn: { value: blankBurn() },
  };
}

const PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
uniform sampler2D tTerrainSplatA;
uniform sampler2D tTerrainSplatB;
uniform vec4 uTerrainExtent;
uniform vec3 uStyleColors[8];
uniform float uFacet;
uniform sampler2D tTerrainBurn;
float styHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float styNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(styHash(i), styHash(i + vec2(1.0, 0.0)), u.x), mix(styHash(i + vec2(0.0, 1.0)), styHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Replaces <map_fragment>: flat palette colours blended by the splat weights (no photo textures), drifting between two
 * grass tones over tens of metres, mottled a little at a few metres, darkened where wet; rock gets horizontal strata
 * and a faceted (flat-shaded) normal so cliffs read as chunky low-poly stone. Leaves sNrmW / sRough / sAO.
 */
const MAP = /* glsl */ `
vec3 sNrmW;
float sRough;
float sAO;
{
  vec3 p = vTerrainPos;
  vec3 n = normalize(vTerrainNrm);
  vec2 suv = (p.xz - uTerrainExtent.xy) * uTerrainExtent.zw;
  vec4 sa = texture(tTerrainSplatA, suv);
  vec4 sb = texture(tTerrainSplatB, suv);
  float w[6];
  w[0] = sa.r; w[1] = sa.g; w[2] = sa.b; w[3] = sa.a; w[4] = sb.r; w[5] = sb.g;
  float broad = styNoise(p.xz / 34.0) * 0.65 + styNoise(p.xz / 13.0) * 0.35;
  float mottle = styNoise(p.xz / 3.1);
  vec3 grass = mix(uStyleColors[0], uStyleColors[6], smoothstep(0.35, 0.75, broad));
  float strata = smoothstep(0.35, 0.65, fract(p.y * 0.42 + styNoise(p.xz / 9.0) * 0.8));
  vec3 rock = mix(uStyleColors[5], uStyleColors[7], strata * 0.55);
  vec3 col = grass * w[0] + uStyleColors[1] * w[1] + uStyleColors[2] * w[2] + uStyleColors[3] * w[3] + uStyleColors[4] * w[4] + rock * w[5];
  col /= max(w[0] + w[1] + w[2] + w[3] + w[4] + w[5], 1e-3);
  col *= 0.92 + 0.16 * mottle;
  // shingle: a coarse speckle of light and dark stones
  col *= 1.0 + w[4] * (0.28 * styNoise(p.xz / 0.7) + 0.14 * styNoise(p.xz / 0.23) - 0.21);
  float wet = sb.b;
  col *= mix(1.0, 0.62, wet);
  // scorched by blasts: char, mottled with ash, browner toward the edge
  float scorch = texture(tTerrainBurn, suv).r;
  vec3 ash = mix(vec3(0.045, 0.04, 0.035), vec3(0.16, 0.13, 0.1), styNoise(p.xz / 0.9) * 0.7 + (1.0 - scorch) * 0.5);
  col = mix(col, ash, smoothstep(0.02, 0.6, scorch));
  // faceted normal from the screen-space derivatives of the world position: the terrain triangles show as facets
  vec3 fn = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(fn, n) < 0.0) fn = -fn;
  float facet = clamp(uFacet + 0.55 * w[5], 0.0, 0.95);
  sNrmW = normalize(mix(n, fn, facet));
  sRough = mix(0.95, 0.35, wet);
  sAO = mix(1.0, sb.a, 0.8);
  diffuseColor.rgb = col * diffuse;
}
`;

function patch(shader: ShaderParams, u: StylizedTerrainUniforms): void {
  for (const a of ['#include <common>', '#include <begin_vertex>']) if (!shader.vertexShader.includes(a)) throw new Error(`stylised terrain: vertex anchor missing: ${a}`);
  for (const a of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <aomap_fragment>']) {
    if (!shader.fragmentShader.includes(a)) throw new Error(`stylised terrain: fragment anchor missing: ${a}`);
  }
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', () => `#include <begin_vertex>\n${SPLAT_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${PARS}`)
    .replace('#include <map_fragment>', () => MAP)
    .replace('#include <roughnessmap_fragment>', () => 'float roughnessFactor = sRough;')
    .replace('#include <metalnessmap_fragment>', () => 'float metalnessFactor = 0.0;')
    .replace('#include <normal_fragment_maps>', () => 'normal = normalize((viewMatrix * vec4(sNrmW, 0.0)).xyz);')
    .replace('#include <aomap_fragment>', () => '{ reflectedLight.indirectDiffuse *= sAO; }');
}

/** The island terrain's stylised material: MeshStandardMaterial (CSM shadows, sky light and fog still apply). */
export function createStylizedTerrainMaterial(u: StylizedTerrainUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'terrain-stylised', color: 0xffffff, roughness: 1, metalness: 0 });
  addCompileHook(m, 'terrainStylised', (shader) => patch(shader, u));
  return m;
}
