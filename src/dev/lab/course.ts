import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';

export interface Course {
  root: THREE.Group;
  surfaces: THREE.Mesh[];
}

const deg = THREE.MathUtils.degToRad;

/**
 * Static Motion Lab course (spec §8.2): flat pad, 15–60° ramps, side slope, steps, ledges,
 * boulder field, a vertical 2.3 m climb face with a plateau, a 75° wall, and inside/outside corners.
 * Layout (top view): ramps along −Z on the west side, steps + ledges east, boulders north-east,
 * climbing walls south, corners south-west. The pad centre (0, 0, 0) is clear for spawning.
 */
export function buildCourse(seed = 7): Course {
  const root = new THREE.Group();
  root.name = 'Course';
  const surfaces: THREE.Mesh[] = [];
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.95 }),
    ramp: new THREE.MeshStandardMaterial({ color: 0xa8a296, roughness: 0.9 }),
    step: new THREE.MeshStandardMaterial({ color: 0x9aa39a, roughness: 0.9 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.92 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x9c8f82, roughness: 0.92 }),
  };
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    root.add(mesh);
    surfaces.push(mesh);
    return mesh;
  };

  add('floor', new THREE.BoxGeometry(160, 1, 160), mats.floor, [0, -0.5, 0]);

  // Ramps rise toward −Z: rotating +a about X lifts the −Z end. Near edge sits on the floor.
  [15, 30, 45, 60].forEach((a, i) => {
    const len = 8;
    const thick = 0.4;
    const rise = Math.sin(deg(a)) * len;
    const run = Math.cos(deg(a)) * len;
    const x = -40 + i * 8;
    const z0 = -14; // near (bottom) edge
    add(`ramp${a}`, new THREE.BoxGeometry(5, thick, len), mats.ramp,
      [x, rise / 2 - (thick / 2) * Math.cos(deg(a)), z0 - run / 2], [deg(a), 0, 0]);
    // The ramp's top face is set back from z0 - run by (thick/2)*sin(a) once tilted (its top-face
    // far edge, at local (0, +thick/2, -len/2), lands at world z = z0 - run + (thick/2)*sin(a)).
    // Shift the plateau the same amount so its near edge (Box3 max.z) meets that edge with no gap.
    add(`plateau${a}`, new THREE.BoxGeometry(5, rise, 6), mats.step, [x, rise / 2, z0 - run - 3 + (thick / 2) * Math.sin(deg(a))]);
  });

  // 20° side slope (tilted about Z), for body-roll tests.
  add('sideSlope', new THREE.BoxGeometry(10, 0.4, 14), mats.ramp, [-20, 1.6, 18], [0, 0, deg(20)]);

  // Stairs: 6 × 0.25 m then 4 × 0.5 m risers, 1 m treads, rising toward +X.
  for (let i = 0; i < 6; i++) {
    const h = 0.25 * (i + 1);
    add(`stepSmall${i}`, new THREE.BoxGeometry(1, h, 5), mats.step, [14 + i, h / 2, -10]);
  }
  for (let i = 0; i < 4; i++) {
    const h = 0.5 * (i + 1);
    add(`stepLarge${i}`, new THREE.BoxGeometry(1.2, h, 5), mats.step, [14 + i * 1.2, h / 2, -2]);
  }

  // Ledges of 1 / 2 / 2.5 / 3 m (3 m is above the scramble limit → must block).
  [1, 2, 2.5, 3].forEach((h, i) => {
    add(`ledge${h}`, new THREE.BoxGeometry(6, h, 6), mats.wall, [16 + i * 8, h / 2, 8]);
  });

  // Boulder field: 30 displaced icosahedra, seeded.
  const rnd = mulberry32(seed);
  for (let i = 0; i < 30; i++) {
    const r = 0.4 + rnd() * 1.1;
    const geo = new THREE.IcosahedronGeometry(r, 2);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 0.8 + rnd() * 0.35;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.7, pos.getZ(v) * k);
    }
    geo.computeVertexNormals();
    add(`boulder${i}`, geo, mats.rock, [28 + rnd() * 18, r * 0.25, 22 + rnd() * 16], [rnd(), rnd() * 6, rnd()]);
  }

  // Climbing: a vertical 2.3 m face with a plateau on top (scramble-up), and a 75° wall with no ledge.
  add('climbWall', new THREE.BoxGeometry(10, 2.3, 1), mats.wall, [0, 1.15, 30]);
  add('climbTop', new THREE.BoxGeometry(10, 2.3, 8), mats.step, [0, 1.15, 34.5]);
  add('steepWall', new THREE.BoxGeometry(10, 0.6, 6.2), mats.wall, [14, 2.9, 30], [deg(-75), 0, 0]);

  // Corners: an L of two walls (inside corner) and a free-standing pillar (outside corners).
  add('cornerA', new THREE.BoxGeometry(8, 3, 0.8), mats.wall, [-30, 1.5, 30]);
  add('cornerB', new THREE.BoxGeometry(0.8, 3, 8), mats.wall, [-33.6, 1.5, 26.4]);
  add('pillar', new THREE.BoxGeometry(3, 3, 3), mats.wall, [-18, 1.5, 34]);

  addRoughLanes(add, mats, mulberry32(seed + 1000));
  return { root, surfaces };
}

type AddFn = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => THREE.Mesh;

/** Lane centres (x) of the rough-terrain lanes; each runs along −Z from z = −8 to −38 (spawn at z = −4 heading −Z). */
export const ROUGH_LANES = { rubble: 46, logs: 52, broken: 58, mounds: 64, ditch: 70, angled: 76 } as const;

/**
 * Rough-terrain lanes (task #11: obstacle interactions on uneven ground), east of the steps, clear of every other
 * script: rubble underfoot, logs to step over, broken ground of uneven blocks, rolling mounds, a ditch between two
 * raised platforms, and ledges met at an angle (up onto one, down off its far edge). Seeded apart from the boulders.
 */
function addRoughLanes(add: AddFn, mats: Record<string, THREE.Material>, rnd: () => number): void {
  const L = ROUGH_LANES;
  // rubble: flattened rocks 0.08–0.25 m across the lane
  for (let i = 0; i < 140; i++) {
    const r = 0.08 + rnd() * 0.17;
    const geo = new THREE.IcosahedronGeometry(r, 1);
    geo.scale(1, 0.55, 1);
    add(`rubble${i}`, geo, mats.rock, [L.rubble - 2.2 + rnd() * 4.4, r * 0.15, -8 - rnd() * 30], [rnd(), rnd() * 6, rnd()]);
  }
  // logs across the lane to step over (radius 0.12–0.22 m: at most ~0.44 m tall, a third of his shoulder height;
  // taller logs are a hop, not a step), a little skewed
  for (let i = 0; i < 7; i++) {
    const r = 0.12 + rnd() * 0.1;
    const geo = new THREE.CylinderGeometry(r, r * 0.9, 5.5, 12);
    add(`log${i}`, geo, mats.wall, [L.logs + (rnd() - 0.5) * 0.6, r, -10 - i * 4 - rnd()], [0, (rnd() - 0.5) * 0.7, Math.PI / 2]);
  }
  // broken ground: 0.6 m blocks, tops 0–0.35 m high
  for (let ix = 0; ix < 7; ix++) {
    for (let iz = 0; iz < 50; iz++) {
      const h = 0.02 + rnd() * 0.33;
      add(`broken${ix}_${iz}`, new THREE.BoxGeometry(0.6, h, 0.6), mats.step, [L.broken - 1.8 + ix * 0.6, h / 2, -8 - iz * 0.6]);
    }
  }
  // rolling mounds: flattened spheres sunk into the floor, crests 0.2–0.5 m
  for (let i = 0; i < 12; i++) {
    const rad = 1.4 + rnd() * 1.2;
    const crest = 0.2 + rnd() * 0.3;
    const geo = new THREE.SphereGeometry(rad, 24, 12);
    const sy = 0.35;
    geo.scale(1, sy, 1);
    add(`mound${i}`, geo, mats.rock, [L.mounds + (rnd() - 0.5) * 3, crest - rad * sy, -9 - i * 2.6], [0, rnd() * 6, 0]);
  }
  // ditch: two 0.6 m platforms (0.3 m entry step) with a 1.2 m gap between them
  add('ditchStep', new THREE.BoxGeometry(5, 0.3, 1), mats.step, [L.ditch, 0.15, -8.5]);
  add('ditchA', new THREE.BoxGeometry(5, 0.6, 10), mats.step, [L.ditch, 0.3, -14]);
  add('ditchB', new THREE.BoxGeometry(5, 0.6, 10), mats.step, [L.ditch, 0.3, -25.2]);
  // angled ledges: a 0.5 m platform skewed 35° to the lane: up onto one edge, down off the far one
  add('angledLedge', new THREE.BoxGeometry(9, 0.5, 9), mats.wall, [L.angled, 0.25, -21], [0, 0.61, 0]);
}
