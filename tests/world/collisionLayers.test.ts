import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld, geometryTriangles, trianglesOf } from '../../src/world/collision';
import { mulberry32 } from '../../src/core/rng';

/** A bumpy 300 m ground (1.5 m grid) with a scatter of boxes standing on it. */
function scene(): { ground: THREE.Mesh; blocks: THREE.Mesh[] } {
  const g = new THREE.PlaneGeometry(300, 300, 200, 200).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, 3 * Math.sin(p.getX(i) * 0.05) * Math.cos(p.getZ(i) * 0.04) + Math.sin(p.getX(i) * 0.3));
  const ground = new THREE.Mesh(g);
  const rnd = mulberry32(5);
  const blocks: THREE.Mesh[] = [];
  for (let k = 0; k < 60; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2 + rnd() * 4, 2 + rnd() * 6, 2 + rnd() * 4));
    b.position.set((rnd() - 0.5) * 260, 1 + rnd() * 2, (rnd() - 0.5) * 260);
    b.rotation.y = rnd() * Math.PI;
    b.updateMatrixWorld(true);
    blocks.push(b);
  }
  return { ground, blocks };
}

describe('layered collision world', () => {
  const { ground, blocks } = scene();
  const one = CollisionWorld.fromObjects([ground, ...blocks]);
  const tiled = CollisionWorld.fromObjects([ground], { tile: 64 });
  const set = tiled.createSet('blocks', 64);
  blocks.forEach((b, k) => set.add(`b${k}`, trianglesOf([b])));

  it('splits into tiles and sets, with every triangle kept', () => {
    expect(tiled.layers.length).toBeGreaterThan(20);
    expect(tiled.triangles).toBe(one.triangles);
    expect(tiled.tileLayer(0, 0)).toBeDefined();
  });

  it('answers every query as the single BVH does', () => {
    const rnd = mulberry32(11);
    const v = () => (rnd() - 0.5) * 280;
    const hitA = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    const hitB = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    for (let k = 0; k < 400; k++) {
      const o = new THREE.Vector3(v(), 2 + rnd() * 12, v());
      const d = new THREE.Vector3(rnd() - 0.5, rnd() - 0.8, rnd() - 0.5).normalize();
      const far = 5 + rnd() * 120;
      const a = one.raycast(o, d, far, hitA);
      const b = tiled.raycast(o, d, far, hitB);
      expect(!!b).toBe(!!a);
      if (a && b) {
        expect(b.distance).toBeCloseTo(a.distance, 4);
        expect(b.normal.dot(a.normal)).toBeGreaterThan(0.999);
      }
      const ga = one.groundAt(o.x, o.z, 20, 40);
      const gb = tiled.groundAt(o.x, o.z, 20, 40);
      expect(gb!.point.y).toBeCloseTo(ga!.point.y, 4);
      const r = 0.3 + rnd() * 3;
      const ca = one.closestPoint(o, r * 3);
      const cb = tiled.closestPoint(o, r * 3);
      expect(!!cb).toBe(!!ca);
      if (ca && cb) expect(cb.distance).toBeCloseTo(ca.distance, 4);
      expect(tiled.isInside(o)).toBe(one.isInside(o));
      const to = o.clone().addScaledVector(d, 20);
      expect(tiled.sphereCast(o, to, r)).toBeCloseTo(one.sphereCast(o, to, r), 4);
    }
  });

  it('sees through a removed member at once, and sees it again when re-added', () => {
    const b = blocks[0];
    const top = new THREE.Vector3(b.position.x, 30, b.position.z);
    const down = new THREE.Vector3(0, -1, 0);
    const before = tiled.raycast(top, down, 60)!.point.y;
    const pos = trianglesOf([b]);
    expect(set.remove('b0')).toBe(true);
    const after = tiled.raycast(top, down, 60)!.point.y;
    expect(after).toBeLessThan(before - 1);
    set.add('b0', pos);
    expect(tiled.raycast(top, down, 60)!.point.y).toBeCloseTo(before, 4);
  });

  it('rebuilds one tile in place (a crater) well inside the per-blast budget', () => {
    const l = tiled.tileLayer(0, 0)!;
    const pos = new Float32Array(l.geometry.attributes.position.array as ArrayLike<number>);
    for (let i = 1; i < pos.length; i += 3) {
      const dx = pos[i - 1] - 30;
      const dz = pos[i + 1] - 30;
      pos[i] -= 4 * Math.max(0, 1 - Math.hypot(dx, dz) / 10);
    }
    const y0 = tiled.groundAt(30, 30, 20, 40)!.point.y;
    const t0 = performance.now();
    tiled.replaceLayer(l, pos);
    const ms = performance.now() - t0;
    expect(tiled.groundAt(30, 30, 20, 40)!.point.y).toBeLessThan(y0 - 3);
    expect(ms).toBeLessThan(40); // the plan's budget is 8 ms in the browser; this CI box is far slower and shared
  });

  it('keeps the triangle queries for decals working across layers', () => {
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(64, 0, 64), new THREE.Vector3(6, 20, 6));
    const tris = tiled.trianglesInBox(box, 2000, []);
    expect(tris.length / 9).toBeGreaterThan(10);
    expect(geometryTriangles(new THREE.BoxGeometry()).length).toBe(12 * 9);
  });
});
