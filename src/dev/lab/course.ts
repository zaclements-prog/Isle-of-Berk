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
    add(`plateau${a}`, new THREE.BoxGeometry(5, rise, 6), mats.step, [x, rise / 2, z0 - run - 3]);
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

  return { root, surfaces };
}
