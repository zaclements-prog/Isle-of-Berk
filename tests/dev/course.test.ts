import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCourse } from '../../src/dev/lab/course';

describe('buildCourse', () => {
  it('contains every named test surface', () => {
    const c = buildCourse();
    const names = new Set(c.surfaces.map((m) => m.name));
    for (const n of ['floor', 'ramp15', 'ramp30', 'ramp45', 'ramp60', 'sideSlope', 'stepSmall0', 'stepLarge3',
      'ledge1', 'ledge2', 'ledge2.5', 'ledge3', 'boulder0', 'climbWall', 'climbTop', 'steepWall', 'cornerA', 'cornerB', 'pillar']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('tilts each ramp to its named angle', () => {
    const c = buildCourse();
    for (const a of [15, 30, 45, 60]) {
      const ramp = c.surfaces.find((m) => m.name === `ramp${a}`)!;
      ramp.updateMatrixWorld(true);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ramp.quaternion);
      expect(THREE.MathUtils.radToDeg(Math.acos(up.y))).toBeCloseTo(a, 5);
    }
  });

  it('gives each ledge its named height', () => {
    const c = buildCourse();
    for (const h of [1, 2, 2.5, 3]) {
      const ledge = c.surfaces.find((m) => m.name === `ledge${h}`)!;
      const box = new THREE.Box3().setFromObject(ledge);
      expect(box.max.y).toBeCloseTo(h, 5);
    }
  });

  it('meets each ramp top exactly at its plateau (no seam gap)', () => {
    const c = buildCourse();
    for (const a of [15, 30, 45, 60]) {
      const ramp = c.surfaces.find((m) => m.name === `ramp${a}`)!;
      const plateau = c.surfaces.find((m) => m.name === `plateau${a}`)!;
      ramp.updateMatrixWorld(true);
      const { height, depth } = (ramp.geometry as THREE.BoxGeometry).parameters;
      const rampTopFarEdge = new THREE.Vector3(0, height / 2, -depth / 2).applyMatrix4(ramp.matrixWorld);
      const plateauBox = new THREE.Box3().setFromObject(plateau);
      expect(Math.abs(rampTopFarEdge.z - plateauBox.max.z), `ramp${a} z gap`).toBeLessThan(0.001);
      expect(Math.abs(rampTopFarEdge.y - plateauBox.max.y), `ramp${a} y gap`).toBeLessThan(0.001);
    }
  });

  // The M5 climbing metrics depend on the three assertions below.
  it('tilts the steep wall\'s climbing face to 75° (±0.5°)', () => {
    const wall = buildCourse().surfaces.find((m) => m.name === 'steepWall')!;
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(wall.quaternion); // the 10 × 6.2 m faces
    const slope = THREE.MathUtils.radToDeg(Math.acos(Math.abs(normal.y)));
    expect(Math.abs(slope - 75)).toBeLessThanOrEqual(0.5);
  });

  it('joins cornerA and cornerB into a closed L: no gap at the inside corner, flush outside faces', () => {
    const c = buildCourse();
    const a = new THREE.Box3().setFromObject(c.surfaces.find((m) => m.name === 'cornerA')!);
    const b = new THREE.Box3().setFromObject(c.surfaces.find((m) => m.name === 'cornerB')!);
    expect(a.intersectsBox(b)).toBe(true); // touching counts
    // The concave vertex, where A's inner face (z = a.min.z) meets B's inner face (x = b.max.x),
    // lies on both walls, at every height of the walls.
    for (const y of [a.min.y, (a.min.y + a.max.y) / 2, a.max.y]) {
      const inside = new THREE.Vector3(b.max.x, y, a.min.z);
      expect(a.containsPoint(inside), `A at y=${y}`).toBe(true);
      expect(b.containsPoint(inside), `B at y=${y}`).toBe(true);
    }
    expect(a.min.x).toBeCloseTo(b.min.x, 5); // outer faces flush: an L, not a T or a cross
    expect(a.max.z).toBeCloseTo(b.max.z, 5);
  });

  it('stands the pillar free on the floor: a 3 × 3 m footprint at (-18, 34), 3 m tall', () => {
    const c = buildCourse();
    const pillar = new THREE.Box3().setFromObject(c.surfaces.find((m) => m.name === 'pillar')!);
    const size = pillar.getSize(new THREE.Vector3());
    const centre = pillar.getCenter(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3, 5);
    expect(size.z).toBeCloseTo(3, 5);
    expect(size.y).toBeCloseTo(3, 5);
    expect(pillar.min.y).toBeCloseTo(0, 5);
    expect(centre.x).toBeCloseTo(-18, 5);
    expect(centre.z).toBeCloseTo(34, 5);
    for (const other of c.surfaces) {
      if (other.name === 'pillar' || other.name === 'floor') continue;
      expect(pillar.intersectsBox(new THREE.Box3().setFromObject(other)), other.name).toBe(false);
    }
  });

  it('is deterministic for a seed', () => {
    const a = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    const b = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    expect(a).toEqual(b);
  });
});
