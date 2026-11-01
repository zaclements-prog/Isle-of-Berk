import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Ejecta, DEFAULT_EJECTA } from '../../src/world/damage/ejecta';
import { WorldEvents } from '../../src/world/events';

const blast = (x: number, y: number, z: number, power = 1, time = 0) =>
  ({ type: 'blast' as const, point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius: 6 * power, time });

describe('ejecta', () => {
  it('throws clods out of the crater that land on the ground around it, rest, then sink back in', () => {
    const events = new WorldEvents();
    const ground = (x: number, z: number) => 0.05 * x;            // a gentle slope
    const e = new Ejecta({ height: ground }, events);
    events.emit(blast(0, 0, 0));
    expect(e.live).toBeGreaterThan(80);
    expect(e.spray.count).toBeGreaterThan(300);
    expect(e.dust.count).toBeGreaterThan(20);
    let maxH = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      e.update(1 / 60);
      for (const c of e.clods) {
        maxH = Math.max(maxH, c.pos.y - ground(c.pos.x, c.pos.z));
        expect(c.pos.y).toBeGreaterThan(ground(c.pos.x, c.pos.z) - 0.01); // never under the ground
      }
    }
    expect(maxH).toBeGreaterThan(3);                                     // flung well up
    // by now they lie scattered around the crater, outside it, at rest on the ground
    const resting = e.clods.filter((c) => c.rest > 0);
    expect(resting.length).toBeGreaterThan(e.live * 0.8);
    const spread = resting.map((c) => Math.hypot(c.pos.x, c.pos.z)).sort((a, b) => a - b);
    expect(spread[spread.length >> 1]).toBeGreaterThan(3);
    // and later they've sunk back in and their slots are free again
    for (let t = 0; t < DEFAULT_EJECTA.rest + DEFAULT_EJECTA.sink + 1; t += 1 / 30) e.update(1 / 30);
    expect(e.live).toBe(0);
    e.dispose();
  });

  it('throws more for a bigger blast, nothing for an air burst, and never more than it can hold', () => {
    const events = new WorldEvents();
    const e = new Ejecta({ height: () => 0 }, events, DEFAULT_EJECTA, 300);
    events.emit(blast(0, 20, 0));                                        // 20 m up: an air burst
    expect(e.live).toBe(0);
    events.emit(blast(0, 0, 0, 0.5));
    const small = e.live;
    events.emit(blast(40, 0, 0, 2));
    expect(e.live - small).toBeGreaterThan(small * 2);
    for (let k = 0; k < 6; k++) events.emit(blast(k * 30, 0, 50, 3));
    expect(e.live).toBeLessThanOrEqual(300);
    e.dispose();
  });

  it('throws stone where the ground is rock', () => {
    const e = new Ejecta({ height: () => 0, rock: () => 1 }, null);
    e.blast(blast(0, 0, 0));
    const c = new THREE.Color();
    let grey = 0;
    for (const cl of e.clods) {
      e.clodMesh.getColorAt(cl.slot, c);
      if (Math.abs(c.r - c.g) < 0.04 && Math.abs(c.g - c.b) < 0.04) grey++;
    }
    expect(grey).toBe(e.live);
    e.dispose();
  });
});
