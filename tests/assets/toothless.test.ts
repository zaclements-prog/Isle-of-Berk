import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { readGlbJson } from './glb';

const DIR = 'public/assets/characters/toothless/';
const gltf = readGlbJson(`${DIR}toothless.glb`);
const poses = readGlbJson(`${DIR}toothless.poses.glb`);
const rig = JSON.parse(readFileSync(`${DIR}toothless.rig.json`, 'utf8'));
const MORPHS = ['blink_L', 'blink_R', 'blink_L_a', 'blink_L_b', 'blink_R_a', 'blink_R_b', 'squint', 'teeth_out',
  'membrane_pleat_L', 'membrane_pleat_R', 'smile', 'snarl', 'nostril_flare'];
const MATERIALS = ['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'];
const CLIPS = ['bind', 'wings_fold_25', 'wings_half', 'wings_fold_75', 'wings_folded', 'jaw_open'];

describe('toothless.glb', () => {
  it('stays within the size budget', () => {
    expect(statSync(`${DIR}toothless.glb`).size).toBeLessThanOrEqual(6 * 1024 * 1024);
  });
  it('has one 101-joint skin whose joints match rig.json', () => {
    expect(gltf.skins).toHaveLength(1);
    const names = gltf.skins[0].joints.map((j: number) => gltf.nodes[j].name).sort();
    expect(names).toEqual(rig.bones.map((b: any) => b.name).sort());
    expect(names).toHaveLength(101);
  });
  it('exports every morph target with zero default weights', () => {
    const mesh = gltf.meshes[0];
    for (const m of MORPHS) expect(mesh.extras.targetNames).toContain(m);
    expect(mesh.weights.every((w: number) => w === 0)).toBe(true);
  });
  it('carries skinning, eye UVs and the _MASK attribute on every primitive, within the triangle budget', () => {
    let tris = 0;
    for (const p of gltf.meshes[0].primitives) {
      for (const a of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0', '_MASK']) expect(p.attributes).toHaveProperty(a);
      tris += gltf.accessors[p.indices].count / 3;
    }
    expect(tris).toBeLessThanOrEqual(90000);
  });
  it('names every material the engine expects', () => {
    const names = gltf.materials.map((m: any) => m.name);
    for (const m of MATERIALS) expect(names).toContain(m);
  });
  it('ships the bind pose only (clips live in toothless.poses.glb)', () => {
    expect(gltf.animations ?? []).toHaveLength(0);
  });
  it('matches the locked proportions within 3 % and has finite bounds (no NaN)', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes[0].primitives) {
      const acc = gltf.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        expect(Number.isFinite(acc.min[i]) && Number.isFinite(acc.max[i])).toBe(true);
        lo[i] = Math.min(lo[i], acc.min[i]);
        hi[i] = Math.max(hi[i], acc.max[i]);
      }
    }
    const err = (v: number, target: number) => Math.abs(v - target) / target;
    expect(err(hi[0] - lo[0], rig.proportions.wingspan)).toBeLessThan(0.03);   // x: wingspan
    expect(err(hi[2] - lo[2], rig.proportions.length)).toBeLessThan(0.03);     // z: nose -> tail tip
    expect(lo[1]).toBeGreaterThan(-0.05);                                       // y: paws on the ground
  });
});

describe('toothless.poses.glb', () => {
  it('keeps full tracks for every bone in every clip', () => {
    for (const c of CLIPS) {
      const anim = poses.animations.find((a: any) => a.name === c);
      expect(anim, c).toBeTruthy();
      const nodes = new Set(anim.channels.filter((ch: any) => ch.target.path === 'rotation').map((ch: any) => ch.target.node));
      expect(nodes.size, c).toBe(101);
    }
  });
});

describe('toothless.rig.json', () => {
  const bones = new Set(rig.bones.map((b: any) => b.name));
  it('references only existing bones', () => {
    for (const chain of Object.values(rig.chains) as string[][]) for (const b of chain) expect(bones.has(b), b).toBe(true);
    for (const limb of Object.values(rig.limbs) as any[]) for (const b of limb.bones) expect(bones.has(b), b).toBe(true);
    for (const c of Object.values(rig.contacts) as any[]) expect(bones.has(c.bone)).toBe(true);
    for (const p of rig.proxies) expect(bones.has(p.bone)).toBe(true);
    for (const a of Object.values(rig.anchors) as any[]) expect(bones.has(a.bone)).toBe(true);
  });
  it('puts the paws on the ground (glTF +Y up) and opens the jaw with a negative rotation', () => {
    for (const c of Object.values(rig.contacts) as any[]) expect(c.sole[1]).toBeLessThan(0.05);
    expect(rig.jaw.openSign).toBe(-1);
  });
  it('records the locked proportions', () => {
    expect(rig.proportions.length).toBeGreaterThan(7.1);
    expect(rig.proportions.wingspan).toBeGreaterThan(13.0);
  });
  it('has the blink map and the jaw rest close, and every listed morph exists in the GLB', () => {
    const targets: string[] = gltf.meshes[0].extras.targetNames;
    for (const side of ['L', 'R']) {
      expect(rig.blink[side]).toEqual([`blink_${side}_a`, `blink_${side}_b`, `blink_${side}`]);
      for (const k of rig.blink[side]) expect(targets).toContain(k);
    }
    for (const k of rig.morphs) expect(targets).toContain(k);
    expect(rig.jaw.restCloseRad).toBeGreaterThan(0);   // closes: against openSign -1
    expect(rig.jaw.restCloseRad).toBeLessThan(0.2);
  });
});
