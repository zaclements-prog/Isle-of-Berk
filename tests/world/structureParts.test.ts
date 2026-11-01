import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';
import { Debris, DEFAULT_DEBRIS } from '../../src/world/damage/debris';
import { DEFAULT_STRUCTURE, StructureDamage, longhouseParts, pierParts, type Structure } from '../../src/world/damage/structures';
import { WorldEvents } from '../../src/world/events';

const blast = (x: number, y: number, z: number, power = 1) => ({
  type: 'blast' as const, point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius: 6 * power, time: 0,
});

/**
 * One 8 × 5 m longhouse at the origin, square to the axes, its collision box in a `structures` set, on flat ground.
 * Parts (longhouseParts, 2 segments): 0, 1 the −z long wall; 2 the −x end; 3, 4 the +z long wall; 5 the +x end;
 * 6, 7 the −z roof half; 8, 9 the +z roof half (8 over wall 3, 9 over wall 4).
 */
function scene() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
  const world = CollisionWorld.fromObjects([ground], { tile: 64 });
  const set = world.createSet('structures');
  set.add('house:0', new Float32Array(new THREE.BoxGeometry(8, 3.2, 5).translate(0, 1.6, 0).toNonIndexed().attributes.position.array));
  const house: Structure & { hidden: boolean } = {
    key: 'house:0', kind: 'house', base: new THREE.Vector3(), yaw: 0, halfX: 4, halfZ: 2.5, height: 7.5, hp: 100,
    parts: longhouseParts(8, 5, 1, new THREE.Color(0.5, 0.35, 0.2), new THREE.Color(0.4, 0.2, 0.1)),
    hidden: false, scorch() {}, hide() { house.hidden = true; },
  };
  const debris = new Debris(world, world.createSet('debris'), DEFAULT_DEBRIS, { ground: () => 0 });
  const events = new WorldEvents();
  const collapsed: string[] = [];
  events.on('collapse', (e) => collapsed.push(e.key));
  const dmg = new StructureDamage([house], set, debris, events);
  return { world, set, house, debris, events, collapsed, dmg };
}

/** A blast 1.5 m outside the +z long wall, over its −x segment (part 3). */
const NEAR = [-2, 0.3, 3.8] as const;

describe('structures break part by part', () => {
  it('a near blast throws the nearest wall out, away from the blast, but leaves the house standing', () => {
    const { set, house, debris, collapsed, dmg } = scene();
    dmg.blast(blast(...NEAR));
    expect(dmg.part('house:0', 3)!.standing).toBe(false);          // the wall it went off at
    for (const i of [0, 1, 2, 4, 5, 6, 7, 9]) expect(dmg.part('house:0', i)!.standing).toBe(true);
    expect(dmg.health('house:0')).toBeGreaterThan(40);
    expect(collapsed).toEqual([]);
    expect(house.hidden).toBe(true);                               // shown as its parts now
    expect(set.has('house:0')).toBe(false);
    expect(set.has('house:0#0')).toBe(true);                       // the walls left collide one by one
    expect(set.has('house:0#3')).toBe(false);
    expect(set.has('house:0#6')).toBe(false);                      // roofs don't collide (as before)
    const wall = debris.pieces[0];
    expect(wall.half.x).toBeCloseTo(2);
    expect(wall.v.z).toBeLessThan(-3);                             // into the house, away from the blast
    expect(debris.pieces.length).toBe(2);                          // the wall and the roof that sat on it
  });

  it('leaves an opening where the wall was: a ray (and a dragon) passes in to the far wall', () => {
    const { world, dmg } = scene();
    const from = new THREE.Vector3(-2, 1, 10);
    const dir = new THREE.Vector3(0, 0, -1);
    expect(world.raycast(from, dir, 30)!.distance).toBeCloseTo(7.5, 1);   // the house's box
    expect(world.sphereContact(new THREE.Vector3(-2, 1.2, 2.3), 0.7)).not.toBeNull();
    dmg.blast(blast(...NEAR));
    world.flush();
    expect(world.raycast(from, dir, 30)!.distance).toBeGreaterThan(11.5);  // through to the −z wall's inner face
    expect(world.sphereContact(new THREE.Vector3(-2, 1.2, 2.3), 0.7)).toBeNull();
    // the wall beside the opening still stops him
    expect(world.raycast(new THREE.Vector3(2, 1, 10), dir, 30)!.distance).toBeLessThan(8);
  });

  it('drops a roof half whose walls are gone, though the blast did not break it', () => {
    const { debris, dmg } = scene();
    dmg.blast(blast(...NEAR));
    const roof = dmg.part('house:0', 8)!;
    expect(roof.standing).toBe(false);
    expect(roof.hp).toBeGreaterThan(0);                                         // it fell, it wasn't blown off
    expect(dmg.part('house:0', 9)!.standing).toBe(true);                       // its neighbour still has its wall
    const fallen = debris.pieces[1];
    expect(fallen.v.length()).toBeLessThan(1.5);                               // dropped, not thrown
    for (let t = 0; t < 4; t += 1 / 60) debris.update(1 / 60);
    expect(fallen.pos.y).toBeLessThan(2.5);                                    // it came down (onto the rubble)
  });

  it('shows damage before a part breaks: the wall beside the blast leans away from it', () => {
    const { dmg } = scene();
    dmg.blast(blast(...NEAR));
    const p = dmg.part('house:0', 4)!;
    expect(p.standing).toBe(true);
    expect(p.hp).toBeLessThan(DEFAULT_STRUCTURE.partHp.house * 0.95);
    const m = new THREE.Matrix4();
    dmg.mesh.getMatrixAt(4, m);
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    expect(up.z).toBeLessThan(-0.02);                                          // leans away from the blast (−z)
    expect(Math.acos(up.y)).toBeLessThan(DEFAULT_STRUCTURE.lean + 1e-6);
  });

  it('accumulated blasts bring it down: the rest falls at once, collapse is published, no collision is left', () => {
    const { set, house, debris, collapsed, dmg } = scene();
    dmg.blast(blast(...NEAR));
    dmg.blast(blast(...NEAR));
    expect(collapsed).toEqual([]);
    expect(dmg.standing('house:0')).toBeGreaterThan(3);
    dmg.blast(blast(...NEAR));
    expect(collapsed).toEqual(['house:0']);
    expect(dmg.health('house:0')).toBe(0);
    expect(dmg.broken).toBe(1);
    expect(debris.pieces.length).toBe(house.parts.length);
    expect(set.size).toBe(0);
    // the rubble settles: nothing under the ground, nothing still moving after 15 s
    for (let t = 0; t < 15; t += 1 / 60) debris.update(1 / 60);
    expect(debris.active).toBe(0);
    const c = new THREE.Vector3();
    for (const p of debris.pieces) {
      for (const k of [-1, 1]) for (const l of [-1, 1]) for (const n of [-1, 1]) {
        expect(c.set(k * p.half.x, l * p.half.y, n * p.half.z).applyQuaternion(p.q).add(p.pos).y).toBeGreaterThan(-0.11);
      }
    }
  });

  it('a pier loses the planks over a blast and those on its broken posts, not the whole deck', () => {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
    const world = CollisionWorld.fromObjects([ground], { tile: 64 });
    const parts = pierParts(14, 3, new THREE.Color());
    const pier: Structure = { key: 'pier:0', kind: 'pier', base: new THREE.Vector3(0, 3, 0), yaw: 0, halfX: 1.5, halfZ: 7, height: 1, hp: 120, parts, scorch() {}, hide() {} };
    const dmg = new StructureDamage([pier], world.createSet('structures'), new Debris(world, null), null);
    const planks = parts.filter((p) => p.role === 'deck').length;
    expect(planks).toBe(7);
    expect(parts.filter((p) => p.role === 'post').length).toBe(10);
    dmg.blast(blast(0, 3, 5));
    const left = parts.flatMap((p, i) => (p.role === 'deck' && dmg.part('pier:0', i)!.standing ? [i] : []));
    expect(left.length).toBeGreaterThan(2);
    expect(left.length).toBeLessThan(planks);
    expect(dmg.part('pier:0', 6)!.standing).toBe(true);          // the far end
  });

  it('rubble resting on the house falls when what held it up gives way, instead of hanging in the air', () => {
    const { debris, dmg } = scene();
    // a plank lands on the whole-house box's top (3.2 m) and settles there
    const plank = debris.spawn(new THREE.Vector3(1, 3.6, 0), new THREE.Quaternion(), new THREE.Vector3(1.2, 0.1, 0.3), new THREE.Color(), new THREE.Vector3(), new THREE.Vector3());
    for (let k = 0; k < 240; k++) debris.update(1 / 60);
    expect(plank.asleep).toBe(true);
    expect(plank.pos.y).toBeGreaterThan(3.2);
    // a blast at the far end opens the house into its parts: the box (and so the plank's support) is gone
    dmg.blast(blast(-6, 0.3, -3.8, 0.8));
    for (let k = 0; k < 600; k++) debris.update(1 / 60);
    expect(plank.pos.y).toBeLessThan(0.5);
  });
});

