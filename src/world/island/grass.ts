import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCompileHook } from '../../render/materials';
import { mulberry32 } from '../../core/rng';
import { FORCE_PARS, ForceField, MAX_CONTACTS, type ForceUniforms } from '../forceField';

/** Where grass may grow: the ground height, its up-normal component, and a 0…1 density at (x, z). */
export interface GrassField {
  height(x: number, z: number): number;
  upness(x: number, z: number): number;
  density(x: number, z: number): number;
  /** 0…1: how flowery the ground is (the meadow). */
  flowers(x: number, z: number): number;
}

export interface GrassOptions {
  /** Radius (m) of the ring of grass kept around the camera, and the grid cell (m) a tuft may grow in. */
  radius: number;
  cell: number;
  seed?: number;
}

/** Hash of an integer cell → [0, 1), stable: the same cell always grows the same tuft. */
function cellHash(i: number, j: number, k: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A tuft of stylised grass: a fan of tapered blades (one triangle each) leaning outward, about 0.5 m tall, coloured
 * from a dark base to a sunlit tip (vertex colours). y runs 0…1 up a blade in the `bend` attribute for the wind.
 */
export function tuftGeometry(blades = 9, seed = 3): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const bend: number[] = [];
  // the base matches the ground's grass so a tuft grows out of it; the tips catch the light
  const base = new THREE.Color(0x5e8a33);
  const tip = new THREE.Color(0xa6c95c);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.05 + rnd() * 0.08;
    const lean = 0.08 + rnd() * 0.12;
    const h = 0.2 + rnd() * 0.22;
    const w = 0.035 + rnd() * 0.02;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    const t = tip.clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.06);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, t.r, t.g, t.b);
    bend.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('bend', new THREE.Float32BufferAttribute(bend, 1));
  g.computeVertexNormals();
  // grass lit like the ground beneath it: every normal straight up (blades would otherwise flicker light/dark)
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** A little flower: a stem blade and a three-petal star on top, tinted per instance (instanceColor). */
export function flowerGeometry(): THREE.BufferGeometry {
  const stem = new THREE.BufferGeometry();
  stem.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, 0, 0, 0.012, 0, 0, 0, 0.32, 0.02], 3));
  stem.setAttribute('color', new THREE.Float32BufferAttribute([0.2, 0.35, 0.12, 0.2, 0.35, 0.12, 0.3, 0.5, 0.2], 3));
  stem.setAttribute('bend', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  const petals: number[] = [];
  const pc: number[] = [];
  const pb: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    petals.push(0, 0.32, 0.02, Math.cos(a) * 0.07, 0.33, 0.02 + Math.sin(a) * 0.07, Math.cos(a + 0.6) * 0.07, 0.33, 0.02 + Math.sin(a + 0.6) * 0.07);
    pc.push(1, 0.85, 0.3, 1, 1, 1, 1, 1, 1);
    pb.push(1, 1, 1);
  }
  const flower = new THREE.BufferGeometry();
  flower.setAttribute('position', new THREE.Float32BufferAttribute(petals, 3));
  flower.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  flower.setAttribute('bend', new THREE.Float32BufferAttribute(pb, 1));
  const g = mergeGeometries([stem, flower], false)!;
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Most interaction spheres the grass reacts to at once (paws, belly, hips, tail). */
export const MAX_PUSH = MAX_CONTACTS;

const FLOWER_COLORS = [0xf4f1e6, 0xf2d24b, 0xb48ad8, 0xe98a6b].map((c) => new THREE.Color(c));

/**
 * Stylised grass and meadow flowers in a ring around the camera. Every tuft lives in a fixed world grid cell (hashed,
 * so it is always the same tuft in the same place); the ring is rebuilt from the grid when the camera has moved a few
 * metres. Tufts shrink away toward the ring's edge and sway in a travelling wind in the vertex shader.
 */
export class Grass {
  readonly root = new THREE.Group();
  readonly tufts: THREE.InstancedMesh;
  readonly flowers: THREE.InstancedMesh;
  private readonly uniforms = {
    uGrassTime: { value: 0 },
    uGrassCam: { value: new THREE.Vector3() },
    uGrassRadius: { value: 40 },
  };
  /** The shared force field (contacts, downwash, shocks); the grass owns one when none is passed in. */
  readonly force: ForceUniforms;
  private readonly ownField: ForceField | null;
  private readonly center = new THREE.Vector3(Infinity, 0, Infinity);
  private readonly material: THREE.MeshStandardMaterial;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;

  constructor(readonly field: GrassField, private readonly o: GrassOptions, force?: ForceUniforms) {
    this.ownField = force ? null : new ForceField();
    this.force = force ?? this.ownField!.uniforms;
    this.root.name = 'Grass';
    this.uniforms.uGrassRadius.value = o.radius;
    const cap = Math.ceil((Math.PI * o.radius * o.radius) / (o.cell * o.cell) * 1.05);
    this.material = this.windMaterial('grass', false);
    this.flowerMaterial = this.windMaterial('flower', true);
    this.tufts = new THREE.InstancedMesh(tuftGeometry(), this.material, cap);
    this.flowers = new THREE.InstancedMesh(flowerGeometry(), this.flowerMaterial, Math.ceil(cap / 6));
    for (const m of [this.tufts, this.flowers]) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
      m.count = 0;
      this.root.add(m);
    }
    this.tufts.name = 'GrassTufts';
    this.flowers.name = 'Flowers';
  }

  private windMaterial(name: string, instanceColors: boolean): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const u = this.uniforms;
    const f = this.force;
    addCompileHook(m, `grassWind${instanceColors ? 'F' : ''}`, (shader) => {
      Object.assign(shader.uniforms, u, f);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float bend;
uniform float uGrassTime;
uniform vec3 uGrassCam;
uniform float uGrassRadius;
${FORCE_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // shrink toward the ring's edge so it never shows as a hard circle
  float keep = 1.0 - smoothstep(uGrassRadius * 0.6, uGrassRadius, distance(root.xz, uGrassCam.xz));
  transformed *= keep;
  // a travelling gust plus a fast flutter, bending the tips (bend = 0 at the root, 1 at the tip)
  float gust = sin(uGrassTime * 1.3 + root.x * 0.17 + root.z * 0.11) * 0.5 + 0.5;
  float flutter = sin(uGrassTime * 4.1 + root.x * 1.7 + root.z * 1.3);
  vec2 wind = vec2(0.8, 0.45) * (0.12 + 0.18 * gust) + vec2(0.05, 0.08) * flutter;
  transformed.xz += wind * bend * bend * keep;
  // parting: every sphere touching the ground near a tuft pushes it outward and flattens it, more at the tip; a sphere
  // lifted off the ground (a paw in swing, a body in flight) lets it spring back
  vec3 push = vec3(0.0);
  float flat_ = 0.0;
  for (int k = 0; k < ${MAX_CONTACTS}; k++) {
    if (k >= uForceContactsN) break;
    vec4 s = uForceContacts[k];
    vec2 d = root.xz - s.xz;
    float dist = length(d);
    float near = 1.0 - smoothstep(s.w * 0.6, s.w + 0.55, dist);
    float low = 1.0 - smoothstep(0.05, 0.9, (s.y - s.w) - root.y);
    float f = near * low;
    push.xz += (dist > 1e-3 ? d / dist : vec2(1.0, 0.0)) * f * 0.42;
    flat_ = max(flat_, f);
  }
  // the air: downwash under a low-flying dragon and blast shockwaves
  vec3 fa = forceAt(root);
  push.xz += fa.xz * 0.5;
  flat_ = max(flat_, fa.y);
  // burnt and flattened by blasts: scorched tufts shrink to blackened stubble, flattened ones lie down
  vec2 bw = worldBurn(root.xz);
  flat_ = max(flat_, bw.g);
  transformed *= 1.0 - 0.85 * smoothstep(0.15, 0.7, bw.r);
#ifdef USE_COLOR
  vColor.rgb *= mix(1.0, 0.18, smoothstep(0.05, 0.5, bw.r));
#endif
  // the push is in world space: into the tuft's own (yawed, scaled) frame
  transformed += inverse(mat3(instanceMatrix)) * push * bend;
  transformed.y *= 1.0 - 0.65 * flat_ * bend;
}`);
    });
    return m;
  }

  /** Rebuild the ring when the camera has moved more than a quarter of a cell-row; animate the wind. */
  update(dt: number, camera: THREE.Camera, interactions: readonly { center: THREE.Vector3; radius: number }[] = []): void {
    this.uniforms.uGrassTime.value += dt;
    // a grass with its own field takes the contact spheres directly; a shared field is updated by its owner
    if (this.ownField) {
      this.ownField.contacts.length = 0;
      this.ownField.contacts.push(...interactions);
      this.ownField.update(this.uniforms.uGrassTime.value, dt);
    }
    const c = camera.position;
    this.uniforms.uGrassCam.value.copy(c);
    if (Math.hypot(c.x - this.center.x, c.z - this.center.z) < this.o.radius * 0.12) return;
    this.center.copy(c);
    this.rebuild(c.x, c.z);
  }

  /** The ground changed (a crater): regrow the ring from the field on the next update. */
  invalidate(): void {
    this.center.set(Infinity, 0, Infinity);
  }

  private rebuild(cx: number, cz: number): void {
    const { radius: R, cell, seed = 1 } = this.o;
    const f = this.field;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let nt = 0;
    let nf = 0;
    const i0 = Math.floor((cx - R) / cell);
    const i1 = Math.ceil((cx + R) / cell);
    const j0 = Math.floor((cz - R) / cell);
    const j1 = Math.ceil((cz + R) / cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + cellHash(i, j, seed)) * cell;
        const z = (j + cellHash(i, j, seed + 1)) * cell;
        if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
        const d = f.density(x, z);
        if (d <= 0 || cellHash(i, j, seed + 2) > d) continue;
        const up_ = f.upness(x, z);
        if (up_ < 0.85) continue;
        const y = f.height(x, z);
        const sc = 0.65 + cellHash(i, j, seed + 3) * 0.55;
        q.setFromAxisAngle(up, cellHash(i, j, seed + 4) * Math.PI * 2);
        if (cellHash(i, j, seed + 5) < f.flowers(x, z) * 0.22 && nf < this.flowers.instanceMatrix.count) {
          m.compose(p.set(x, y, z), q, s.set(sc, sc, sc));
          this.flowers.setMatrixAt(nf, m);
          this.flowers.setColorAt(nf, FLOWER_COLORS[Math.floor(cellHash(i, j, seed + 6) * FLOWER_COLORS.length)]);
          nf++;
          continue;
        }
        if (nt >= this.tufts.instanceMatrix.count) continue;
        m.compose(p.set(x, y - 0.02, z), q, s.set(sc, sc * (0.8 + d * 0.5), sc));
        this.tufts.setMatrixAt(nt++, m);
      }
    }
    this.tufts.count = nt;
    this.flowers.count = nf;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.flowers.instanceMatrix.needsUpdate = true;
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.tufts.geometry.dispose();
    this.flowers.geometry.dispose();
    this.material.dispose();
    this.flowerMaterial.dispose();
    this.tufts.dispose();
    this.flowers.dispose();
  }
}
