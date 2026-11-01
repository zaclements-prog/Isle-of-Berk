import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BurnMask } from '../../src/world/damage/burnMask';
import { TreeDamage } from '../../src/world/damage/trees';
import { WorldEvents, type BlastEvent } from '../../src/world/events';
import { CollisionWorld } from '../../src/world/collision';
import { buildProps } from '../../src/world/island/props';

const blast = (x: number, y: number, z: number, time = 0, power = 1, radius = 6): BlastEvent => ({
  type: 'blast', point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius, time,
});

describe('burn mask', () => {
  it('scorches the core, flattens grass further out, and heals over time', () => {
    const m = new BurnMask(128, -64, 1);
    m.burn(0, 0, 6);
    expect(m.sample(0, 0).scorch).toBeGreaterThan(0.95);
    expect(m.sample(0, 0).flat).toBeGreaterThan(0.95);
    expect(m.sample(4.5, 0).scorch).toBeLessThan(0.6);
    expect(m.sample(7, 0).scorch).toBe(0);
    expect(m.sample(7, 0).flat).toBeGreaterThan(0.1);
    expect(m.sample(12, 0).flat).toBe(0);
    const k = (64 * 128 + 64) * 2;
    expect((m.texture.image.data as Uint8Array)[k]).toBeGreaterThan(240);
    for (let t = 0; t < 20; t++) m.update(1);
    expect(m.sample(7, 0).flat).toBe(0);                          // flattened grass springs back in seconds
    expect(m.sample(0, 0).scorch).toBeGreaterThan(0.7);           // the scorch lasts minutes
    for (let t = 0; t < 200; t++) m.update(1);
    expect(m.sample(0, 0).scorch).toBe(0);
    expect((m.texture.image.data as Uint8Array)[k]).toBe(0);
  });
});

describe('tree damage', () => {
  // three trees on flat ground at x = 0, 6 and 40
  const setup = () => {
    const props = buildProps([[0, 0, 0, 1, 0, 0], [6, 0, 0, 1, 1, 0], [40, 0, 0, 1, 2, 0]], [], () => 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
    const world = CollisionWorld.fromObjects([ground], { tile: 64 });
    const trees = world.createSet('trees');
    for (const t of props.trunks) trees.add(t.key, t.positions);
    const events = new WorldEvents();
    const records = props.treeInstances.map((r, i) => ({ mesh: r.mesh, k: r.k, key: `tree:${i}` }));
    const dmg = new TreeDamage(records, trees, () => 0, events);
    return { props, world, trees, events, dmg };
  };

  it('fells a tree close to the blast away from it, scorches one nearby, leaves a far one', () => {
    const { props, world, trees, events, dmg } = setup();
    const fell: number[] = [];
    events.on('fell', (e) => fell.push(e.yaw));
    const side = new THREE.Vector3(1, 1.2, 0);
    const west = new THREE.Vector3(-1, 0, 0);
    expect(world.raycast(side, west, 2)).not.toBeNull();         // the trunk is there
    events.emit(blast(-2, 1, 0));
    expect(dmg.state(0)).toBe('falling');
    expect(dmg.state(1)).toBe('scorched');
    expect(dmg.state(2)).toBe('standing');
    expect(fell).toHaveLength(1);
    expect(Math.sin(fell[0])).toBeGreaterThan(0.9);                // thrown east, away from the blast
    expect(trees.has('tree:0')).toBe(false);
    let t = 0;
    while (dmg.state(0) === 'falling' && t < 6) {
      dmg.update(1 / 60);
      t += 1 / 60;
    }
    expect(dmg.state(0)).toBe('felled');
    expect(t).toBeGreaterThan(1);                                    // a tree falls over seconds, not a frame
    expect(t).toBeLessThan(5);
    // where it stood is open; it lies to the east, colliding there
    expect(world.raycast(side.set(1, 1.2, 0), west, 2)).toBeNull();
    const onLog = world.groundAt(2.5, 0, 5, 10)!;
    expect(onLog.point.y).toBeGreaterThan(0.3);
    // the crown broke off as it hit: the tree is gone, a log lies along its fall to the east, a stump at its foot
    const m = new THREE.Matrix4();
    const inst = props.treeInstances[0];
    inst.mesh.getMatrixAt(inst.k, m);
    expect(new THREE.Vector3().setFromMatrixColumn(m, 1).length()).toBe(0);
    const logs: THREE.Matrix4[] = [];
    for (let k = 0; k < dmg.logs.count; k++) {
      dmg.logs.getMatrixAt(k, m);
      if (new THREE.Vector3().setFromMatrixColumn(m, 1).length() > 0) logs.push(m.clone());
    }
    expect(logs).toHaveLength(1);
    const up = new THREE.Vector3().setFromMatrixColumn(logs[0], 1).normalize();
    expect(up.y).toBeLessThan(0.3);
    expect(up.x).toBeGreaterThan(0.9);
    expect(dmg.stumps.count).toBe(1);
    // the scorched tree is darkened
    const c = new THREE.Color();
    props.treeInstances[1].mesh.getColorAt(props.treeInstances[1].k, c);
    expect(c.r).toBeLessThan(0.9);
    // in time it crumbles to a stump, and its log stops colliding
    for (let k = 0; k < 60 * 50; k++) dmg.update(1 / 60);
    expect(dmg.state(0)).toBe('stump');
    expect(dmg.stumps.count).toBe(1);
    for (let k = 0; k < dmg.logs.count; k++) {
      dmg.logs.getMatrixAt(k, m);
      expect(new THREE.Vector3().setFromMatrixColumn(m, 1).length()).toBe(0); // the log has crumbled away
    }
    expect(trees.has('tree:0')).toBe(false);
    expect(dmg.census()).toEqual({ standing: 1, scorched: 1, falling: 0, felled: 0, stump: 1 });
    props.dispose();
    dmg.dispose();
  });

  it('a stronger blast reaches further', () => {
    const { events, dmg, props } = setup();
    events.emit(blast(-6, 1, 0, 0, 1));
    expect(dmg.state(0)).toBe('scorched');
    events.emit(blast(-6, 1, 0, 0, 2, 12));
    expect(dmg.state(0)).toBe('falling');
    props.dispose();
    dmg.dispose();
  });
});
