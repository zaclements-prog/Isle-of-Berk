import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const RIG_JSON = 'public/assets/characters/toothless/toothless.rig.json';
const GLB = 'public/assets/characters/toothless/toothless.glb';

interface GltfNode { name?: string; rotation?: number[]; translation?: number[] }
function readGlbNodes(path: string): GltfNode[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return (JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: GltfNode[] }).nodes;
}

/** three.js bones built from the skeleton's bind locals — what GLTFLoader builds from the GLB. */
function threeBones(s: RigSkeleton): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  for (let i = 0; i < s.count; i++) {
    const b = new THREE.Bone();
    b.name = s.names[i];
    b.position.copy(s.bindLocalPos[i]);
    b.quaternion.copy(s.bindLocalQuat[i]);
    bones.set(b.name, b);
    if (s.parent[i] >= 0) bones.get(s.names[s.parent[i]])!.add(b);
  }
  return bones;
}

describe('RigSkeleton (fixture rig)', () => {
  const rig = toothlessFixtureRig();
  it('orders 101 bones parents-first', () => {
    const s = new RigSkeleton(rig);
    expect(s.count).toBe(101);
    for (let i = 0; i < s.count; i++) expect(s.parent[i]).toBeLessThan(i);
  });
  it('reproduces every bone head, tail and hinge axis at bind', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.fk();
    const x = new THREE.Vector3();
    for (const b of rig.bones) {
      const i = s.id(b.name);
      expect(s.worldPos[i].distanceTo(new THREE.Vector3(...b.head))).toBeLessThan(1e-9);
      expect(s.tail(i, new THREE.Vector3()).distanceTo(new THREE.Vector3(...b.tail))).toBeLessThan(1e-9);
      x.set(1, 0, 0).applyQuaternion(s.worldQuat[i]);
      expect(x.dot(new THREE.Vector3(...b.xAxis).normalize())).toBeGreaterThan(1 - 1e-9);
    }
  });
  it('recomputes poses absolutely — 1000 steps equal one', () => {
    const s = new RigSkeleton(rig);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const i = s.id('tail_05');
    for (let step = 0; step < 1000; step++) {
      s.resetToBind();
      s.localQuat[i].multiply(q);
    }
    s.fk();
    const many = s.worldQuat[i].clone();
    s.resetToBind();
    s.localQuat[i].multiply(q);
    s.fk();
    expect(Math.abs(many.dot(s.worldQuat[i]))).toBeCloseTo(1, 12);
  });
  it('sets local rotations from desired world rotations', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.fk();
    const i = s.id('hind_tibia_L');
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 0.5));
    s.setWorldQuat(i, want);
    s.fk();
    expect(Math.abs(s.worldQuat[i].dot(want))).toBeCloseTo(1, 12);
  });
  it('matches three.js Object3D forward kinematics and interpolates when writing', () => {
    const s = new RigSkeleton(rig);
    const bones = threeBones(s);
    s.resetToBind();
    s.snapshot();
    const i = s.id('neck_02');
    s.localQuat[i].multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6));
    s.localPos[s.id('pelvis')].x += 1;
    s.fk();
    s.writeTo(bones, 1);
    bones.get('pelvis')!.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (let k = 0; k < s.count; k++) expect(bones.get(s.names[k])!.getWorldPosition(p).distanceTo(s.worldPos[k])).toBeLessThan(1e-9);
    s.writeTo(bones, 0.5);
    const mid = new THREE.Quaternion().slerpQuaternions(s.prevLocalQuat[i], s.localQuat[i], 0.5);
    expect(Math.abs(bones.get('neck_02')!.quaternion.dot(mid))).toBeCloseTo(1, 12);
    expect(bones.get('pelvis')!.position.x).toBeCloseTo(s.prevLocalPos[s.id('pelvis')].x + 0.5, 12);
  });
  it('detects non-finite poses and restores the previous one', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.snapshot();
    s.localQuat[3].x = Number.NaN;
    expect(s.isFinite()).toBe(false);
    s.restorePrev();
    expect(s.isFinite()).toBe(true);
  });
});

describe.skipIf(!existsSync(RIG_JSON) || !existsSync(GLB))('exported Toothless asset (Plan 2)', () => {
  it('bind locals match the GLB bone nodes — the axis-convention guard', () => {
    const s = new RigSkeleton(JSON.parse(readFileSync(RIG_JSON, 'utf8')) as MotionRig);
    const nodes = new Map(readGlbNodes(GLB).filter((n) => n.name).map((n) => [n.name!, n]));
    for (let i = 0; i < s.count; i++) {
      const n = nodes.get(s.names[i]);
      expect(n, s.names[i]).toBeTruthy();
      const q = new THREE.Quaternion().fromArray(n!.rotation ?? [0, 0, 0, 1]);
      const t = new THREE.Vector3().fromArray(n!.translation ?? [0, 0, 0]);
      expect(Math.abs(q.dot(s.bindLocalQuat[i])), s.names[i]).toBeGreaterThan(1 - 1e-4);
      expect(t.distanceTo(s.bindLocalPos[i]), s.names[i]).toBeLessThan(1e-4);
    }
  });
  it('agrees with the fixture rig (keeps the fixture honest)', () => {
    const exported = JSON.parse(readFileSync(RIG_JSON, 'utf8')) as MotionRig;
    const fixture = new Map(toothlessFixtureRig().bones.map((b) => [b.name, b]));
    for (const b of exported.bones) {
      const f = fixture.get(b.name);
      expect(f, b.name).toBeTruthy();
      for (let k = 0; k < 3; k++) {
        expect(b.head[k]).toBeCloseTo(f!.head[k], 4);
        expect(b.tail[k]).toBeCloseTo(f!.tail[k], 4);
        expect(b.xAxis[k]).toBeCloseTo(f!.xAxis[k], 3);
      }
    }
  });
});
