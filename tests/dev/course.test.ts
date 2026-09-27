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

  it('is deterministic for a seed', () => {
    const a = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    const b = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    expect(a).toEqual(b);
  });
});
