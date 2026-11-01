import * as THREE from 'three';
import { addCompileHook } from '../../render/materials';
import { mulberry32 } from '../../core/rng';
import { FORCE_PARS, ForceField, MAX_SHOCKS, RIPPLE_PARS, type ForceUniforms } from '../forceField';

export interface OceanOptions {
  seaLevel: number;
  /** The terrain's height texture and its UV transform (terrainUvTransform): the water reads the depth beneath. */
  heightTexture: THREE.Texture;
  extent: THREE.Vector4;
  size?: number;
  /** Centre of the water plane (default the origin): a pond is a small one at its own level. */
  center?: { x: number; z: number };
  /** The shared force field: the downwash ripples and sprays the water, blast shocks run across it as rings. */
  force?: ForceUniforms;
}

/**
 * A tileable normal map of travelling ripples: a sum of a few seeded plane waves of different directions and
 * wavelengths that all fit the tile exactly (integer wave numbers), so it repeats seamlessly.
 */
export function rippleNormalTexture(size = 256, seed = 7): THREE.DataTexture {
  const rnd = mulberry32(seed);
  const waves = Array.from({ length: 9 }, (_, k) => ({
    kx: Math.round((rnd() * 2 - 1) * (2 + k * 1.5)),
    ky: Math.round((rnd() * 2 - 1) * (2 + k * 1.5)) || 1,
    a: 1 / (1 + k * 0.6),
    p: rnd() * Math.PI * 2,
  }));
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const ph = (2 * Math.PI * (w.kx * i + w.ky * j)) / size + w.p;
        const c = Math.cos(ph) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const s = 0.035;
      const nx = -dx * s;
      const ny = -dy * s;
      const l = Math.hypot(nx, ny, 1);
      const k = (j * size + i) * 4;
      data[k] = Math.round((nx / l * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * The open sea around the island: one large plane at sea level, MeshStandardMaterial (so CSM shadows, the sky's
 * environment and Berk fog all apply) with a scrolling ripple normal map, tinted by the depth to the terrain beneath
 * (turquoise over the shallows, deep blue-green offshore) and a breaking foam band along the shore.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms = {
    tOceanHeight: { value: null as THREE.Texture | null },
    uOceanExtent: { value: new THREE.Vector4() },
    uSeaLevel: { value: 0 },
    uOceanTime: { value: 0 },
    uShallow: { value: new THREE.Color(0.1, 0.36, 0.36) },
    uDeep: { value: new THREE.Color(0.012, 0.06, 0.085) },
    uFoam: { value: new THREE.Color(0.78, 0.82, 0.82) },
  };
  private readonly normal: THREE.DataTexture;
  private t = 0;

  constructor(o: OceanOptions) {
    const size = o.size ?? 6000;
    this.uniforms.tOceanHeight.value = o.heightTexture;
    this.uniforms.uOceanExtent.value.copy(o.extent);
    this.uniforms.uSeaLevel.value = o.seaLevel;
    this.normal = rippleNormalTexture();
    this.normal.repeat.set(size / 28, size / 28);
    this.material = new THREE.MeshStandardMaterial({
      name: 'ocean', color: 0xffffff, roughness: 0.16, metalness: 0, normalMap: this.normal, normalScale: new THREE.Vector2(0.45, 0.45),
    });
    const u = this.uniforms;
    const f = o.force ?? new ForceField().uniforms;
    addCompileHook(this.material, 'ocean', (shader) => {
      Object.assign(shader.uniforms, u, f);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vOceanXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOceanXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vOceanXZ;
uniform sampler2D tOceanHeight;
uniform vec4 uOceanExtent;
uniform float uSeaLevel;
uniform float uOceanTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
${FORCE_PARS}
${RIPPLE_PARS}
// value noise for the churned spray: hashed lattice, smooth cells, two rotated octaves (no axis grid shows)
float oceanHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float oceanNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(oceanHash(i), oceanHash(i + vec2(1.0, 0.0)), f.x), mix(oceanHash(i + vec2(0.0, 1.0)), oceanHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float oceanChurn(vec2 p) {
  const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  return 0.62 * oceanNoise(R * p) + 0.38 * oceanNoise(R * R * p * 2.3 + 17.0);
}
// the air on the water: (foam 0…1, ripple slope x, z)
vec3 oceanForce(vec2 xz) {
  float foam = 0.0;
  vec2 slope = vec2(0.0);
  if (uForceDownS > 0.0) {
    vec2 d = xz - uForceDown.xz;
    float dist = length(d);
    vec2 dir = dist > 1e-3 ? d / dist : vec2(1.0, 0.0);
    float f = uForceDownS * (1.0 - smoothstep(0.0, uForceDown.w * 1.3, dist)) * (1.0 - smoothstep(0.0, 6.0, abs(uSeaLevel - uForceDown.y)));
    // rings spreading out from under him, each downstroke a new one, plus a churned spray patch right below
    float ph = dist * 1.4 - uForceTime * 9.0;
    slope += dir * cos(ph) * f * 0.55;
    // spray blown outward from under him: noise streaming along the radial direction, as two phases half a cycle
    // apart crossfaded (a flow map), so the offset never grows and the pattern never shears
    float fp = fract(uForceTime * 0.7);
    float fq = fract(fp + 0.5);
    float fw = 1.0 - abs(1.0 - 2.0 * fp);
    float churn = smoothstep(0.35, 0.8, mix(oceanChurn(xz * 1.3 - dir * fq * 2.5 + 31.0), oceanChurn(xz * 1.3 - dir * fp * 2.5), fw));
    foam = max(foam, f * (smoothstep(0.55, 1.0, sin(ph)) * 0.6 + (1.0 - smoothstep(0.0, uForceDown.w * 0.45, dist)) * churn * 0.9));
  }
  for (int k = 0; k < ${MAX_SHOCKS}; k++) {
    float s = uForceShockS[k].x;
    if (s <= 0.0) continue;
    vec2 d = xz - uForceShock[k].xz;
    float dist = length(d);
    float band = exp(-sq((dist - uForceShock[k].w) / max(uForceShockS[k].y, 0.1))) * min(s, 1.5);
    slope += (dist > 1e-3 ? d / dist : vec2(1.0, 0.0)) * band * 0.8;
    foam = max(foam, band * 0.8);
  }
  // splashes: debris going in
  vec3 rp = rippleAt(xz, uSeaLevel);
  slope += rp.yz;
  foam = max(foam, rp.x);
  return vec3(clamp(foam, 0.0, 1.0), slope);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 ouv = (vOceanXZ - uOceanExtent.xy) * uOceanExtent.zw;
  float inside = step(0.0, ouv.x) * step(ouv.x, 1.0) * step(0.0, ouv.y) * step(ouv.y, 1.0);
  float ground = mix(-40.0, texture2D(tOceanHeight, clamp(ouv, 0.0, 1.0)).r, inside);
  float depth = uSeaLevel - ground;
  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 10.0, depth));
  // foam: a band along the waterline that breathes with a slow swell, broken up by a travelling pattern
  float swell = 0.5 + 0.5 * sin(uOceanTime * 0.9 + vOceanXZ.x * 0.05 + vOceanXZ.y * 0.04);
  float band = 1.0 - smoothstep(0.0, 0.35 + 0.45 * swell, depth);
  float breakup = 0.55 + 0.45 * sin(vOceanXZ.x * 0.9 + uOceanTime * 1.7) * sin(vOceanXZ.y * 0.8 - uOceanTime * 1.3);
  diffuseColor.rgb = mix(water, uFoam, clamp(band * breakup, 0.0, 1.0) * step(-0.3, depth));
  diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, oceanForce(vOceanXZ).x);
}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 sl = oceanForce(vOceanXZ).yz;
  normal = normalize(normal + (viewMatrix * vec4(-sl.x, 0.0, -sl.y, 0.0)).xyz);
}`);
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), this.material);
    this.mesh.name = 'Ocean';
    this.mesh.position.set(o.center?.x ?? 0, o.seaLevel, o.center?.z ?? 0);
    this.mesh.receiveShadow = true;
  }

  update(dt: number): void {
    this.t += dt;
    this.uniforms.uOceanTime.value = this.t;
    // the ripples drift with the wind
    this.normal.offset.set(this.t * 0.012, this.t * 0.007);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.normal.dispose();
  }
}
