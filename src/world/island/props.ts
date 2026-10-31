import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/rng';

/** A placement from the bake: [x, y, z, scale, variant, yaw]. */
export type Placement = readonly [number, number, number, number, number, number];
type GroundFn = (x: number, z: number) => number;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function colored(g: THREE.BufferGeometry, c: THREE.Color, jitter: number, rnd: () => number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v += 3) {
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let w = 0; w < 3 && v + w < n; w++) {
      col[(v + w) * 3] = c.r * k;
      col[(v + w) * 3 + 1] = c.g * k;
      col[(v + w) * 3 + 2] = c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * A stylised northern pine (variant 0…2): a tapering trunk under stacked, slightly drooping cone tiers, about 9 m
 * at scale 1, base at the origin. Flat-shaded faceted cones with per-face shade jitter read as needle clumps.
 */
export function pineGeometry(variant: number): THREE.BufferGeometry {
  const rnd = mulberry32(101 + variant);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.32, 3.2, 6, 1).translate(0, 1.6, 0);
  parts.push(colored(trunk, new THREE.Color(0.09, 0.06, 0.04), 0.25, rnd));
  const tiers = [[2.6, 3.0, 2.1], [2.2, 2.9, 2.0], [2.4, 2.7, 2.3]][variant] ?? [2.4, 2.8, 2.1];
  const count = 4 + variant % 2;
  let y = 2.0;
  for (let k = 0; k < count; k++) {
    const f = 1 - k / (count + 0.6);
    const r = tiers[0] * f + 0.35;
    const h = tiers[1] * (0.75 + 0.25 * f);
    const cone = new THREE.ConeGeometry(r, h, 7 + (k % 2), 1).translate(0, y + h / 2, 0).rotateY(rnd() * Math.PI);
    const shade = new THREE.Color().setHSL(0.33 + (rnd() - 0.5) * 0.04, 0.32, 0.055 + 0.02 * k / count);
    parts.push(colored(cone, shade, 0.35, rnd));
    y += h * 0.52;
  }
  const out = mergeGeometries(parts, false)!;
  out.computeVertexNormals();
  return out;
}

/** A boulder (variant 0…3): an icosphere pushed about by seeded lobes, squashed, ~1 m across at scale 1. */
export function boulderGeometry(variant: number, detail = 2): THREE.BufferGeometry {
  const rnd = mulberry32(211 + variant);
  const g = new THREE.IcosahedronGeometry(0.55, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const lobes = Array.from({ length: 6 }, () => ({ d: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), a: 0.08 + rnd() * 0.18 }));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let r = 1;
    for (const l of lobes) r += l.a * Math.max(0, n.dot(l.d)) ** 2;
    // facets: a coarse quantised bump so the faces read as split stone
    r *= 1 + 0.05 * Math.sin(n.x * 9 + variant) * Math.sin(n.z * 7);
    v.multiplyScalar(r);
    v.y *= 0.68;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = colored(g, new THREE.Color(0.13, 0.125, 0.115), 0.35, rnd);
  flat.computeVertexNormals();
  return flat;
}

export interface Props {
  root: THREE.Group;
  /** World-space collision meshes: trunk cylinders and boulder hulls. */
  collision: THREE.Object3D[];
  dispose(): void;
}

/**
 * The island's pines and boulders as instanced meshes (one per variant), set on the ground the terrain runtime
 * reports (the bake's y can sit a few cm off after quantisation). Pines collide by their trunks only (the canopy is
 * open to a dragon), boulders by a low-detail hull.
 */
export function buildProps(trees: readonly Placement[], rocks: readonly Placement[], ground: GroundFn): Props {
  const root = new THREE.Group();
  root.name = 'IslandProps';
  const disposables: Array<{ dispose(): void }> = [];
  const pineMat = new THREE.MeshStandardMaterial({ name: 'pine', vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ name: 'boulder', vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
  disposables.push(pineMat, rockMat);
  const trunkParts: THREE.BufferGeometry[] = [];
  const rockParts: THREE.BufferGeometry[] = [];
  const place = (list: readonly Placement[], geoOf: (v: number) => THREE.BufferGeometry, variants: number, mat: THREE.Material, name: string,
    sink: number, squashY: number, hull: (p: Placement, y: number) => THREE.BufferGeometry | null) => {
    for (let v = 0; v < variants; v++) {
      const mine = list.filter((p) => p[4] === v);
      if (!mine.length) continue;
      const geo = geoOf(v);
      disposables.push(geo);
      const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
      mesh.name = `${name}_${v}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mine.forEach((p, k) => {
        const y = ground(p[0], p[2]) - sink * p[3];
        _q.setFromAxisAngle(UP, p[5]);
        _s.set(p[3], p[3] * squashY, p[3]);
        _m.compose(_p.set(p[0], y, p[2]), _q, _s);
        mesh.setMatrixAt(k, _m);
        const h = hull(p, y);
        if (h) (name === 'pine' ? trunkParts : rockParts).push(h);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  };
  place(trees, pineGeometry, 3, pineMat, 'pine', 0.15, 1, (p, y) => new THREE.CylinderGeometry(0.35 * p[3], 0.4 * p[3], 4 * p[3], 6, 1)
    .translate(p[0], y + 2 * p[3], p[2]));
  place(rocks, boulderGeometry, 4, rockMat, 'boulder', 0.12, 1, (p, y) => {
    const g = boulderGeometry(p[4], 1);
    _m.compose(_p.set(p[0], y, p[2]), _q.setFromAxisAngle(UP, p[5]), _s.set(p[3], p[3], p[3]));
    g.applyMatrix4(_m);
    g.deleteAttribute('color');
    return g;
  });
  const collision: THREE.Object3D[] = [];
  for (const [parts, name] of [[trunkParts, 'trunks'], [rockParts, 'boulders']] as const) {
    if (!parts.length) continue;
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    for (const g of parts) g.dispose();
    const m = new THREE.Mesh(merged);
    m.name = `${name}_collision`;
    m.updateMatrixWorld(true);
    collision.push(m);
    disposables.push(merged);
  }
  return {
    root,
    collision,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
