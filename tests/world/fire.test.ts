import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FireSim, DEFAULT_FIRE, airAt, type FireOptions } from '../../src/world/damage/fire';
import { BurnMask } from '../../src/world/damage/burnMask';
import { DEFAULT_TREE_DAMAGE, TreeDamage } from '../../src/world/damage/trees';
import { WorldEvents, type BlastEvent, type BurnEvent } from '../../src/world/events';
import { ForceField } from '../../src/world/forceField';
import { buildProps } from '../../src/world/island/props';
import { Fire, DEFAULT_FIRE_FX } from '../../src/world/damage/fireFx';

const blast = (x: number, z: number, power = 1, time = 0, y = 0): BlastEvent => ({
  type: 'blast', point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius: 6 * power, time,
});

/** A 256 m flat world: grass everywhere x < 60, a rock shelf (no fuel) at x ≥ 60, a lake (no fuel) x < -60. */
const world = (over: Partial<FireOptions> = {}, events = new WorldEvents()) => {
  const burn = new BurnMask(256, -128, 1);
  // the burn mask chars before the fire reads the ground, as on the island
  events.on('blast', (e) => burn.burn(e.point.x, e.point.z, e.radius, e.power));
  const fuel = (x: number, z: number) => (x >= 60 || x < -60 ? -1 : 0.85 * (1 - THREE.MathUtils.smoothstep(burn.sample(x, z).scorch, 0.4, 0.8)));
  const fire = new FireSim({ fuel, ground: () => 0, start: -128, size: 256, burn, events, ...over });
  const burns: BurnEvent[] = [];
  events.on('burn', (e) => burns.push(e));
  return { events, burn, fire, burns };
};

const run = (fire: FireSim, seconds: number, each?: () => void, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) {
    fire.update(dt);
    each?.();
  }
};

describe('fire', () => {
  it('a blast on grass lights a ring around its char, which chars the ground further as it burns', () => {
    const { events, fire, burn, burns } = world();
    events.emit(blast(0, 0));
    expect(fire.burningCount).toBeGreaterThan(8);
    // nothing in the core the blast charred bare: the fire is a ring around it
    for (const k of fire.burning) expect(fire.center(k).length()).toBeGreaterThan(2);
    expect(burns.some((e) => e.kind === 'ignite')).toBe(true);
    const k = fire.burning[0];
    const c = fire.center(k);
    run(fire, 12);
    expect(burn.sample(c.x, c.z).scorch).toBeGreaterThan(0.8);
  });

  it('nothing catches on rock or water', () => {
    const { events, fire, burns } = world();
    events.emit(blast(90, 0));                                        // on the rock shelf
    events.emit(blast(-90, 0));                                       // on the lake
    expect(fire.burningCount).toBe(0);
    expect(fire.igniteAt(100, 10)).toBe(false);
    expect(burns).toHaveLength(0);
  });

  it('spread is bounded and burns out well inside a minute', () => {
    const { events, fire } = world();
    events.emit(blast(0, 0));
    let maxR = 0;
    let peak = 0;
    let outAt = -1;
    let t = 0;
    run(fire, 60, () => {
      t += 1 / 30;
      peak = Math.max(peak, fire.burningCount);
      for (const k of fire.burning) maxR = Math.max(maxR, fire.center(k).length());
      if (outAt < 0 && !fire.active) outAt = t;
    });
    expect(peak).toBeGreaterThan(20);                                 // it does spread
    expect(maxR).toBeGreaterThan(9);
    expect(maxR).toBeLessThan(40);                                    // but not across the meadow
    expect(outAt).toBeGreaterThan(8);
    expect(outAt).toBeLessThan(45);                                   // and it's out by 45 s
    expect(fire.burningCount).toBe(0);
    // the ground it burnt doesn't light again
    expect(fire.igniteAt(fire.center(fire.cellOf(8, 0)).x, 0)).toBe(false);
  });

  it('fanning (the downwash hovering over it) spreads it further downwind, still bounded', () => {
    const still = world();
    still.events.emit(blast(0, 0));
    let stillLit = 0;
    run(still.fire, 40);
    stillLit = still.fire.lit;
    const field = new ForceField();
    // a dragon hovering 5 m over a point 8 m east of the blast, beating hard
    field.source = () => ({ airborne: true, chest: new THREE.Vector3(8, 5, 0), velocity: new THREE.Vector3(), ground: 0, wingPush: 1 });
    const fanned = world({ force: field.uniforms });
    fanned.events.emit(blast(0, 0));
    let time = 0;
    let maxX = 0;
    run(fanned.fire, 40, () => {
      time += 1 / 30;
      field.update(time, 1 / 30);
      for (const k of fanned.fire.burning) maxX = Math.max(maxX, fanned.fire.center(k).x);
    });
    expect(fanned.fire.lit).toBeGreaterThan(stillLit);
    expect(maxX).toBeLessThan(60);
    expect(fanned.fire.active).toBe(false);
    const a = airAt(field.uniforms, 16, 0, 0, { x: 0, z: 0, fan: 0 });
    expect(a.x).toBeGreaterThan(0.2);                                 // the air blows outward from under him
    expect(a.fan).toBeGreaterThan(0.2);
  });

  it('a tree near the fire catches, burns and ends burnt', () => {
    const props = buildProps([[14, 0, 0, 1, 0, 0], [80, 0, 0, 1, 1, 0]], [], () => 0);
    const events = new WorldEvents();
    const records = props.treeInstances.map((r, i) => ({ mesh: r.mesh, k: r.k, key: `tree:${i}` }));
    const trees = new TreeDamage(records, null, () => 0, events);
    const { fire, burns } = world({ trees }, events);
    events.emit(blast(4, 0));
    expect(trees.state(0)).toBe('standing');                          // out of the blast's reach
    let caught = -1;
    let time = 0;
    run(fire, 60, () => {
      time += 1 / 30;
      trees.update(1 / 30);
      if (caught < 0 && trees.state(0) === 'burning') caught = time;
    });
    expect(caught).toBeGreaterThan(0);
    expect(trees.state(0)).toBe('burnt');
    expect(trees.state(1)).toBe('standing');                          // the one on the rock is left alone
    expect(burns.some((e) => e.kind === 'tree' && e.key === 'tree:0')).toBe(true);
    // burnt black
    const c = new THREE.Color();
    props.treeInstances[0].mesh.getColorAt(props.treeInstances[0].k, c);
    expect(c.r).toBeLessThan(0.12);
    expect(trees.ignite(0)).toBe(false);                              // and it can't burn twice
    props.dispose();
    trees.dispose();
  });

  it('a blast that scorches a tree hard sets it alight', () => {
    const props = buildProps([[3, 0, 0, 1, 0, 0]], [], () => 0);
    const events = new WorldEvents();
    const records = props.treeInstances.map((r, i) => ({ mesh: r.mesh, k: r.k, key: `tree:${i}` }));
    const trees = new TreeDamage(records, null, () => 0, events, { ...DEFAULT_TREE_DAMAGE, fell: 0.1 });
    const fire = new FireSim({ fuel: () => 0, ground: () => 0, start: -128, size: 256, trees, events });
    events.emit(blast(0, 0));
    expect(trees.state(0)).toBe('burning');
    expect(fire.burningTrees).toEqual([0]);
    props.dispose();
    trees.dispose();
  });

  it('holds the cap on burning cells whatever it is fed', () => {
    const { events, fire } = world({ fuel: () => 1 });
    let most = 0;
    for (let k = 0; k < 30; k++) events.emit(blast(-100 + (k % 6) * 40, -100 + Math.floor(k / 6) * 40, 2));
    most = fire.burningCount;
    run(fire, 20, () => {
      most = Math.max(most, fire.burningCount);
      if (fire.burningCount < DEFAULT_FIRE.maxBurning) fire.igniteAt((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200);
    });
    expect(most).toBe(DEFAULT_FIRE.maxBurning);
    expect(most).toBeLessThanOrEqual(DEFAULT_FIRE.maxBurning);
  });

  it('publishes burn events: ignite, spread and out', () => {
    const { events, fire, burns } = world();
    events.emit(blast(0, 0));
    run(fire, 60);
    const kinds = new Set(burns.map((e) => e.kind));
    expect(kinds.has('ignite')).toBe(true);
    expect(kinds.has('spread')).toBe(true);
    expect(kinds.has('out')).toBe(true);
    expect(burns.filter((e) => e.kind === 'out')).toHaveLength(1);
    expect(burns.filter((e) => e.kind === 'spread').length).toBe(fire.lit);
    fire.dispose();
  });

  it('an air burst lights nothing', () => {
    const { events, fire } = world();
    events.emit(blast(0, 0, 1, 0, 20));
    expect(fire.burningCount).toBe(0);
  });
});

describe('fire fx', () => {
  const setup = (force?: ForceField) => {
    const events = new WorldEvents();
    const fire = new Fire({ fuel: () => 0.9, ground: () => 0, start: -128, size: 256, events, force: force?.uniforms });
    return { events, fire };
  };

  it('a blast throws sparks and smoking firebrands; flames and ember beds follow the burning cells', () => {
    const { events, fire } = setup();
    events.emit(blast(0, 0));
    expect(fire.fx.sparks.count).toBeGreaterThan(100);
    expect(fire.fx.brands.length).toBeGreaterThan(3);
    for (let k = 0; k < 150; k++) fire.update(1 / 30);
    // every cell burning (bar any lit this very instant) has its tongues and its glowing bed
    expect(fire.fx.flames.count).toBeLessThanOrEqual(fire.sim.burningCount * DEFAULT_FIRE_FX.flamesPerCell);
    expect(fire.fx.flames.count).toBeGreaterThan((fire.sim.burningCount - 3) * DEFAULT_FIRE_FX.flamesPerCell);
    expect(fire.fx.beds.count).toBe(fire.fx.flames.count / DEFAULT_FIRE_FX.flamesPerCell);
    expect(fire.fx.smoke).toBeGreaterThan(20);
    expect(fire.fx.embers.count).toBeGreaterThan(20);
    expect(fire.fx.brands.length).toBe(0);                            // the firebrands have landed
    fire.dispose();
  });

  it('smoke drifts downwind and rises', () => {
    const { fire } = setup();
    fire.sim.igniteAt(0, 0, 1);
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 150; k++) fire.update(1 / 30);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < fire.fx.smoke; i++) {
      fire.fx.puffs.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      sx += p.x;
      sy += p.y;
    }
    expect(fire.fx.smoke).toBeGreaterThan(3);
    expect(sx / fire.fx.smoke).toBeGreaterThan(1);                    // the wind blows toward +x
    expect(sy / fire.fx.smoke).toBeGreaterThan(3);
    fire.dispose();
  });

  it('the downwash bends the flames away from under the dragon', () => {
    const field = new ForceField();
    field.source = () => ({ airborne: true, chest: new THREE.Vector3(0, 5, 0), velocity: new THREE.Vector3(), ground: 0, wingPush: 1 });
    const { fire } = setup(field);
    fire.sim.igniteAt(-8, 0, 1);
    fire.sim.igniteAt(8, 0, 1);
    for (let k = 0; k < 40; k++) {
      field.update(k / 30, 1 / 30);
      fire.update(1 / 30);
    }
    // per flame: its (local) bend, turned back to the world by its yaw, points away from x = 0
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const s = new THREE.Vector3();
    const attr = fire.fx.flames.geometry.getAttribute('aFlame') as THREE.InstancedBufferAttribute;
    let checked = 0;
    for (let i = 0; i < fire.fx.flames.count; i++) {
      fire.fx.flames.getMatrixAt(i, m);
      m.decompose(pos, q, s);
      const b = new THREE.Vector3(attr.getY(i), 0, attr.getZ(i)).applyQuaternion(q);
      if (Math.abs(pos.x) < 5) continue;
      expect(Math.sign(b.x)).toBe(Math.sign(pos.x));
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
    fire.dispose();
  });

  it('a felled tree smoulders, lighting the ground it lies on', () => {
    const { events, fire } = setup();
    events.emit({ type: 'fell', key: 'tree:0', point: new THREE.Vector3(30, 0, 30), yaw: 0, time: 0 });
    expect(fire.sim.logs).toHaveLength(1);
    expect(fire.sim.burningCount).toBe(1);
    for (let k = 0; k < 30; k++) fire.update(1 / 30);
    expect(fire.fx.smoke).toBeGreaterThan(0);
    fire.dispose();
  });
});
