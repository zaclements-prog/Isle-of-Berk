import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';
import { Debris } from '../../src/world/damage/debris';
import { StructureDamage, longhouseParts, type Structure } from '../../src/world/damage/structures';
import { WorldEvents } from '../../src/world/events';
import { buildBerk, type BerkSites } from '../../src/world/island/berk';

function flatWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
  const world = CollisionWorld.fromObjects([ground], { tile: 64 });
  return { world, set: world.createSet('debris') };
}

const blast = (x: number, y: number, z: number, power = 1) => ({
  type: 'blast' as const, point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius: 6 * power, time: 0,
});

describe('debris', () => {
  it('falls, bounces, comes to rest on the ground and becomes collision there', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set);
    const p = d.spawn(new THREE.Vector3(0, 6, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0.7)),
      new THREE.Vector3(1, 0.15, 0.5), new THREE.Color(0.5, 0.35, 0.2), new THREE.Vector3(3, 0, 0), new THREE.Vector3(0, 2, 3));
    let t = 0;
    let lowest = Infinity;
    while (!p.asleep && t < 12) {
      d.update(1 / 60);
      t += 1 / 60;
      lowest = Math.min(lowest, p.pos.y);
    }
    expect(p.asleep).toBe(true);
    expect(t).toBeGreaterThan(0.8);
    expect(p.pos.x).toBeGreaterThan(1);                                  // carried along before it stopped
    expect(lowest).toBeGreaterThan(0.05);                                // never sinks through
    // lies flat on its broad face, resting on the ground
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.q);
    expect(Math.abs(up.y)).toBeGreaterThan(0.95);
    expect(p.pos.y).toBeGreaterThan(0.1);
    expect(p.pos.y).toBeLessThan(0.25);
    // and it is now part of the world: something dropped onto it lands on top
    expect(world.groundAt(p.pos.x, p.pos.z, 5, 10)!.point.y).toBeGreaterThan(0.25);
    expect(set.size).toBe(1);
    d.dispose();
  });

  it('keeps the moving and the total pieces within their caps', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set, { ...new Debris(world, null)['t'], maxActive: 5, maxPieces: 8 });
    for (let k = 0; k < 12; k++) d.spawn(new THREE.Vector3(k * 3, 4, 0), new THREE.Quaternion(), new THREE.Vector3(0.3, 0.3, 0.3), new THREE.Color(), new THREE.Vector3(), new THREE.Vector3());
    expect(d.pieces.length).toBe(8);
    expect(d.active).toBeLessThanOrEqual(5);
    d.dispose();
  });
});

describe('structures', () => {
  const house = (key: string, x: number): Structure & { hidden: boolean; scorched: number } => {
    const s = {
      key, kind: 'house' as const, base: new THREE.Vector3(x, 0, 0), yaw: 0.3, halfX: 4, halfZ: 2.5, height: 7.5, hp: 100,
      parts: longhouseParts(8, 5, 1, new THREE.Color(0.5, 0.35, 0.2), new THREE.Color(0.4, 0.2, 0.1)),
      hidden: false, scorched: 0,
      scorch(a: number) { s.scorched = a; },
      hide() { s.hidden = true; },
    };
    return s;
  };

  it('breaks a house next to a blast into flying debris, damages one further off, and spares a far one', () => {
    const { world } = flatWorld();
    const set = world.createSet('structures');
    const box = (x: number) => new THREE.BoxGeometry(8, 3.2, 5).translate(x, 1.6, 0);
    const houses = [house('house:0', 0), house('house:1', 12), house('house:2', 60)];
    houses.forEach((h) => set.add(h.key, new Float32Array(box(h.base.x).toNonIndexed().attributes.position.array)));
    const debris = new Debris(world, world.createSet('debris'));
    const events = new WorldEvents();
    const collapsed: string[] = [];
    events.on('collapse', (e) => collapsed.push(e.key));
    const dmg = new StructureDamage(houses, set, debris, events);
    expect(world.raycast(new THREE.Vector3(-10, 1, 0), new THREE.Vector3(1, 0, 0), 20)).not.toBeNull();
    events.emit(blast(-3, 0.5, 4));
    expect(dmg.health('house:0')).toBeLessThan(100);
    events.emit(blast(-2, 0.5, 3));
    expect(dmg.health('house:0')).toBeLessThanOrEqual(0);              // two close blasts finish it
    expect(houses[0].hidden).toBe(true);
    expect(collapsed).toEqual(['house:0']);
    expect(set.has('house:0')).toBe(false);
    expect(dmg.health('house:1')).toBe(100);
    expect(houses[2].scorched).toBe(0);
    // its parts fly away from the blast and come down as rubble
    expect(debris.pieces.length).toBe(houses[0].parts.length);
    const before = debris.pieces.map((p) => p.pos.clone());
    for (let k = 0; k < 60 * 6; k++) debris.update(1 / 60);
    const moved = debris.pieces.filter((p, k) => p.pos.x - before[k].x > 0.3 || p.pos.z - before[k].z < -0.3).length;
    expect(moved).toBeGreaterThan(debris.pieces.length / 2);
    expect(debris.pieces.every((p) => p.pos.y > 0 && p.pos.y < 3)).toBe(true);
    expect(debris.active).toBe(0);
    // a much bigger blast reaches the next house
    events.emit(blast(4, 0.5, 0, 2.5));
    expect(dmg.health('house:1')).toBeLessThan(100);
    expect(houses[1].scorched).toBeGreaterThan(0);
    dmg.dispose();
    debris.dispose();
  });

  it('gives every Berk house, the hall and each pier a breakable form', () => {
    const sites: BerkSites = {
      houses: [{ x: 0, z: 0, y: 5, yaw: 0, len: 8, wid: 5, terrace: 0 }, { x: 20, z: 0, y: 5, yaw: 1, len: 10, wid: 6, terrace: 0 }],
      docks: [{ x: 50, z: 0, yaw: 0, len: 12, width: 3, deck: 1 }],
      hall: { x: -40, z: 0, height: 20, yaw: 0 },
      killRing: { x: 0, z: 60, r: 15, depth: 4, rim: 10 },
      harbour: { inner: { x: 50, z: 10 } },
    } as BerkSites;
    const berk = buildBerk(sites);
    expect(berk.breakables.map((b) => b.key).sort()).toEqual(['hall', 'house:0', 'house:1', 'pier:0']);
    expect(berk.breakables.map((b) => b.key).sort()).toEqual(berk.structures.map((s) => s.key).sort());
    const h = berk.breakables.find((b) => b.key === 'house:1')!;
    h.hide();
    const mesh = berk.root.getObjectByName('houses_1') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).length()).toBe(0);
    berk.dispose();
  });
});
