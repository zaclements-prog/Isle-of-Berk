import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';
import { DEFAULT_DEBRIS, Debris } from '../../src/world/damage/debris';
import { Splashes } from '../../src/world/damage/splash';
import { ForceField, MAX_RIPPLES } from '../../src/world/forceField';

function flatWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
  return CollisionWorld.fromObjects([ground], { tile: 64 });
}

describe('splashes', () => {
  it('fires once when a piece drops into the water, at the surface, with its speed and mass', () => {
    const world = flatWorld();
    const hits: { at: THREE.Vector3; speed: number; mass: number }[] = [];
    // the sea, 3 m deep, east of x = 10; dry land west of it
    const d = new Debris(world, null, DEFAULT_DEBRIS, {
      ground: () => 0, water: (x) => (x > 10 ? 3 : -Infinity), splash: (at, speed, mass) => hits.push({ at: at.clone(), speed, mass }),
    });
    const plank = d.spawn(new THREE.Vector3(15, 9, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.1, 0.4), new THREE.Color(), new THREE.Vector3(), new THREE.Vector3());
    const onLand = d.spawn(new THREE.Vector3(0, 4, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.1, 0.4), new THREE.Color(), new THREE.Vector3(), new THREE.Vector3());
    for (let t = 0; t < 8; t += 1 / 60) d.update(1 / 60);
    expect(hits.length).toBe(1);
    expect(hits[0].at.y).toBe(3);
    expect(hits[0].at.x).toBeCloseTo(15, 0);
    expect(hits[0].speed).toBeGreaterThan(8);                  // ~ sqrt(2 g 6)
    expect(hits[0].mass).toBeCloseTo(plank.mass);
    expect(onLand.afloat).toBe(false);
    d.dispose();
  });

  it('scales the spray with the impact, rings the water and fades away', () => {
    const field = new ForceField();
    const s = new Splashes(field.uniforms);
    s.splash(new THREE.Vector3(0, 1, 0), 1, 2);                  // a pebble's worth: nothing
    expect(s.count).toBe(0);
    s.splash(new THREE.Vector3(0, 1, 0), 4, 60);                 // a little plank, gently
    const small = s.spray.count;
    s.splash(new THREE.Vector3(30, 1, 0), 10, 2400);             // a wall panel thrown in
    const big = s.spray.count - small;
    expect(small).toBeGreaterThan(10);
    expect(big).toBeGreaterThan(small * 3);
    expect(s.mist.count).toBeGreaterThan(5);
    s.update(0.2);
    const u = field.uniforms;
    expect(u.uForceRippleS.value[1].x).toBeGreaterThan(u.uForceRippleS.value[0].x);    // the bigger ring is stronger
    const r0 = u.uForceRipple.value[1].w;
    s.update(0.5);
    expect(u.uForceRipple.value[1].w).toBeGreaterThan(r0 + 1);                        // and spreads
    expect(u.uForceRipple.value[1].y).toBe(1);                                        // at its water's level
    for (let t = 0; t < 8; t += 0.1) s.update(0.1);
    expect(s.ripples.length).toBe(0);
    for (let k = 0; k < MAX_RIPPLES; k++) expect(u.uForceRippleS.value[k].x).toBe(0);
    expect(s.spray.count).toBe(0);
    s.dispose();
  });
});
