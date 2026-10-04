import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';
import { COVE_LAYER_TINTS } from './layers';

/** Uniform objects shared by the terrain and the rock base blend (one set per region). */
export interface SplatUniforms {
  tTerrainAlbedo: { value: THREE.DataArrayTexture | null };
  tTerrainNormal: { value: THREE.DataArrayTexture | null };
  tTerrainArmh: { value: THREE.DataArrayTexture | null };
  tTerrainSplatA: { value: THREE.Texture | null };
  tTerrainSplatB: { value: THREE.Texture | null };
  /** (x0, z0, 1/width, 1/depth): world xz → splat texel-centre uv (see heightTexture.terrainUvTransform). */
  uTerrainExtent: { value: THREE.Vector4 };
  /** Metres per texture repeat, per layer. */
  uLayerTile: { value: number[] };
  /** Height-blend band: how far below the highest layer (height + weight) a layer still shows. */
  uHeightBlend: { value: number };
  /** Camera distance where the 4.3× far-scale albedo starts fading in (anti-tiling). */
  uFarBlend: { value: number };
  /**
   * Per-layer albedo multiplier (linear RGB; channels may exceed 1), applied before the height blend. A uniform, not
   * shader text, so the 'terrainSplat' hook stays identical for every splat material (the hook-key contract).
   */
  uLayerTint: { value: THREE.Color[] };
  /** Rock macro-variation strength, 0..1: the 0.37× second scale (High only) and the ±12 % brightness noise. */
  uRockMacro: { value: number };
}

export function createSplatUniforms(): SplatUniforms {
  return {
    tTerrainAlbedo: { value: null },
    tTerrainNormal: { value: null },
    tTerrainArmh: { value: null },
    tTerrainSplatA: { value: null },
    tTerrainSplatB: { value: null },
    uTerrainExtent: { value: new THREE.Vector4() },
    uLayerTile: { value: [2, 3.15, 3, 2.35, 1.5, 3.5] },
    uHeightBlend: { value: 0.2 },
    uFarBlend: { value: 30 },
    // setRGB takes the numbers as they are (linear working space): tints are multipliers, not sRGB colours
    uLayerTint: { value: COVE_LAYER_TINTS.map(([r, g, b]) => new THREE.Color().setRGB(r, g, b)) },
    uRockMacro: { value: 1 },
  };
}

export const SPLAT_VERTEX_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
`;

export const SPLAT_VERTEX = /* glsl */ `
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

/** Shared helpers + uniforms; the rock material includes these too. */
export const SPLAT_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray tTerrainAlbedo;
uniform highp sampler2DArray tTerrainNormal;
uniform highp sampler2DArray tTerrainArmh;
uniform sampler2D tTerrainSplatA;
uniform sampler2D tTerrainSplatB;
uniform vec4 uTerrainExtent;
uniform float uLayerTile[6];
uniform float uHeightBlend;
uniform float uFarBlend;
uniform vec3 uLayerTint[6];
uniform float uRockMacro;

float berkHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float berkNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = berkHash12(i);
  float b = berkHash12(i + vec2(1.0, 0.0));
  float c = berkHash12(i + vec2(0.0, 1.0));
  float d = berkHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 berkTriBlend(vec3 n) {
  vec3 b = pow(abs(n), vec3(4.0));
  return b / (b.x + b.y + b.z);
}
// World-space value noise at frequency f on the triplanar planes (same projections and weights as berkTriSample), so
// it varies across a vertical wall as well as over the ground. Projections with a negligible weight are skipped.
float berkTriNoise(vec3 p, vec3 blend, float f) {
  float v = 0.0;
  if (blend.x > 0.01) v += berkNoise2(p.zy * f) * blend.x;
  if (blend.y > 0.01) v += berkNoise2(p.xz * f) * blend.y;
  if (blend.z > 0.01) v += berkNoise2(p.xy * f) * blend.z;
  return v / max(dot(step(vec3(0.01), blend), blend), 1e-4);
}
// Whiteout blend of a top-projected (uv = world xz) tangent-space normal onto the geometric normal n.
vec3 berkWhiteoutY(vec3 tn, vec3 n) {
  return normalize(vec3(tn.x + n.x, abs(tn.z) * n.y, tn.y + n.z));
}
// Triplanar sample: uvX = zy, uvY = xz, uvZ = xy, mirrored on the negative-facing sides.
vec4 berkTriSample(highp sampler2DArray tex, float layer, vec3 p, vec3 n, vec3 blend, float s) {
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  return texture(tex, vec3(vec2(p.z * sg.x, p.y) * s, layer)) * blend.x
       + texture(tex, vec3(vec2(p.x * sg.y, p.z) * s, layer)) * blend.y
       + texture(tex, vec3(vec2(p.x * sg.z, p.y) * s, layer)) * blend.z;
}
// Triplanar normal in Golus' whiteout form, same projections as berkTriSample.
vec3 berkTriNormal(float layer, vec3 p, vec3 n, vec3 blend, float s) {
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  vec3 tx = texture(tTerrainNormal, vec3(vec2(p.z * sg.x, p.y) * s, layer)).xyz * 2.0 - 1.0;
  vec3 ty = texture(tTerrainNormal, vec3(vec2(p.x * sg.y, p.z) * s, layer)).xyz * 2.0 - 1.0;
  vec3 tz = texture(tTerrainNormal, vec3(vec2(p.x * sg.z, p.y) * s, layer)).xyz * 2.0 - 1.0;
  tx.x *= sg.x;
  ty.x *= sg.y;
  tz.x *= sg.z;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * blend.x + ty.xzy * blend.y + tz.xyz * blend.z);
}
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
`;

/**
 * Replaces <map_fragment>: the six-layer, height-blended splat (spec §7.3). Pass 1 reads armh (AO, roughness,
 * height) for the height blend; pass 2 samples albedo + normal only for layers that survive it. Rock (layer 5) is
 * triplanar on High, with macro variation (a 0.37× second scale under a world noise mask, High only, and ±12 %
 * brightness noise). Every layer's albedo takes its uLayerTint before it joins the blend. Leaves tAlb / tNrmW / tRough /
 * tAO for the replaced chunks below.
 */
export const SPLAT_MAP_FRAGMENT = /* glsl */ `
vec3 tAlb = vec3(0.0);
vec3 tNrmW = vec3(0.0, 1.0, 0.0);
float tRough = 0.9;
float tAO = 1.0;
{
  vec3 p = vTerrainPos;
  vec3 n = normalize(vTerrainNrm);
  vec2 suv = (p.xz - uTerrainExtent.xy) * uTerrainExtent.zw;
  vec4 sa = texture(tTerrainSplatA, suv);
  vec4 sb = texture(tTerrainSplatB, suv);
  float w[6];
  w[0] = sa.r; w[1] = sa.g; w[2] = sa.b; w[3] = sa.a; w[4] = sb.r; w[5] = sb.g;
  float wet = sb.b;
  float bakedAO = sb.a;
  #ifdef TERRAIN_LOW
    float farT = 0.0;
    vec3 triB = vec3(0.0, 1.0, 0.0);
  #else
    float farT = smoothstep(uFarBlend, uFarBlend * 2.5, length(p - cameraPosition));
    vec3 triB = berkTriBlend(n);
  #endif
  vec3 armh[6];
  float hmax = -1.0;
  for (int i = 0; i < 6; i++) {
    armh[i] = vec3(1.0, 0.8, 0.5);
    if (w[i] < 0.004) continue;
    float s = 1.0 / uLayerTile[i];
    #ifndef TERRAIN_LOW
    if (i == 5) armh[i] = berkTriSample(tTerrainArmh, 5.0, p, n, triB, s).rgb;
    else
    #endif
    armh[i] = texture(tTerrainArmh, vec3(p.xz * s, float(i))).rgb;
    hmax = max(hmax, armh[i].b + w[i]);
  }
  float bw[6];
  float bsum = 0.0;
  for (int i = 0; i < 6; i++) {
    bw[i] = w[i] < 0.004 ? 0.0 : max(armh[i].b + w[i] - hmax + uHeightBlend, 0.0);
    bsum += bw[i];
  }
  vec3 nAcc = vec3(0.0);
  vec2 ar = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float b = bw[i] / max(bsum, 1e-4);
    if (b <= 0.0) continue;
    float s = 1.0 / uLayerTile[i];
    vec3 alb;
    vec3 tnW;
    #ifndef TERRAIN_LOW
    if (i == 5) {
      // macro variation against tiling at 20–80 m: the same rock at 0.37× blended in under a low-frequency world-space
      // mask, never fully one scale or the other (two incommensurate lattices hide each other's repeat), both at the
      // near tile and at the far 0.23× one; then ±12 % brightness from a second noise. uRockMacro = 0 is the plain rock.
      float macroMask = berkTriNoise(p, triB, 1.0 / 19.0) * 0.7 + berkTriNoise(p, triB, 1.0 / 7.3) * 0.3;
      float second = clamp(uRockMacro, 0.0, 1.0) * mix(0.2, 0.8, smoothstep(0.3, 0.7, macroMask));
      vec3 rockBroad = berkTriSample(tTerrainAlbedo, 5.0, p, n, triB, s * 0.37).rgb;
      alb = mix(berkTriSample(tTerrainAlbedo, 5.0, p, n, triB, s).rgb, rockBroad, second);
      if (farT > 0.0) alb = mix(alb, mix(berkTriSample(tTerrainAlbedo, 5.0, p, n, triB, s * 0.23).rgb, rockBroad, second), farT);
      float shade = berkTriNoise(p + vec3(37.0, 11.0, 23.0), triB, 1.0 / 23.0) * 0.6 + berkTriNoise(p + vec3(5.0, 71.0, 13.0), triB, 1.0 / 9.0) * 0.4;
      alb *= 1.0 + 0.12 * uRockMacro * (2.0 * shade - 1.0);
      tnW = berkTriNormal(5.0, p, n, triB, s);
    } else
    #endif
    {
      vec2 uv = p.xz * s;
      alb = texture(tTerrainAlbedo, vec3(uv, float(i))).rgb;
      if (farT > 0.0) alb = mix(alb, texture(tTerrainAlbedo, vec3(uv * 0.23, float(i))).rgb, farT);
      #ifdef TERRAIN_LOW
      // Low keeps the rock's brightness variation but skips the second scale
      if (i == 5) {
        float shade = berkNoise2((p.xz + vec2(37.0, 23.0)) / 23.0) * 0.6 + berkNoise2((p.xz + vec2(5.0, 13.0)) / 9.0) * 0.4;
        alb *= 1.0 + 0.12 * uRockMacro * (2.0 * shade - 1.0);
      }
      #endif
      vec3 tn = texture(tTerrainNormal, vec3(uv, float(i))).xyz * 2.0 - 1.0;
      tn.xy *= 1.0 - 0.7 * farT;
      tnW = berkWhiteoutY(tn, n);
    }
    alb *= uLayerTint[i];
    tAlb += alb * b;
    nAcc += tnW * b;
    ar += armh[i].rg * b;
  }
  tNrmW = normalize(nAcc + n * 1e-4);
  float macro = berkNoise2(p.xz / 38.0) * 0.6 + berkNoise2(p.xz / 11.0) * 0.4;
  tAlb *= mix(vec3(0.86, 0.9, 0.84), vec3(1.1, 1.06, 1.0), macro);
  tAlb *= mix(1.0, 0.55, wet);
  tRough = mix(ar.y, 0.22, wet * 0.8);
  tAO = ar.x * mix(1.0, bakedAO, 0.85);
  diffuseColor.rgb = tAlb * diffuse;
}
`;

export const SPLAT_ROUGHNESS = /* glsl */ `float roughnessFactor = tRough;`;
export const SPLAT_METALNESS = /* glsl */ `float metalnessFactor = 0.0;`;
export const SPLAT_NORMAL = /* glsl */ `normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);`;
export const SPLAT_AO = /* glsl */ `
{
  float ambientOcclusion = tAO;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
`;

const VERTEX_ANCHORS = ['#include <common>', '#include <begin_vertex>'];
const FRAGMENT_ANCHORS = [
  '#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>',
  '#include <normal_fragment_maps>', '#include <aomap_fragment>',
];

/** Patches a MeshStandardMaterial program with the terrain splat. Throws if three's chunk anchors moved. */
export function patchSplatShader(shader: ShaderParams, uniforms: SplatUniforms): void {
  for (const a of VERTEX_ANCHORS) if (!shader.vertexShader.includes(a)) throw new Error(`terrain splat: vertex anchor missing: ${a}`);
  for (const a of FRAGMENT_ANCHORS) if (!shader.fragmentShader.includes(a)) throw new Error(`terrain splat: fragment anchor missing: ${a}`);
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', () => `#include <begin_vertex>\n${SPLAT_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_FRAGMENT_PARS}\n${TERRAIN_FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', () => SPLAT_MAP_FRAGMENT)
    .replace('#include <roughnessmap_fragment>', () => SPLAT_ROUGHNESS)
    .replace('#include <metalnessmap_fragment>', () => SPLAT_METALNESS)
    .replace('#include <normal_fragment_maps>', () => SPLAT_NORMAL)
    .replace('#include <aomap_fragment>', () => SPLAT_AO);
}

/** The terrain material: MeshStandardMaterial + the splat hook. `low` drops triplanar rock and far-scale blending. */
export function createSplatMaterial(uniforms: SplatUniforms, low: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'terrain', color: 0xffffff, roughness: 1, metalness: 0 });
  if (low) m.defines = { ...(m.defines ?? {}), TERRAIN_LOW: '' };
  addCompileHook(m, 'terrainSplat', (shader) => patchSplatShader(shader, uniforms));
  return m;
}
