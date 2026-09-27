import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';

export function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.updateMatrixWorld(true);
  return m;
}

/** 40 × 40 m floor whose top is y = 0. */
export const floor = (): THREE.Mesh => box(40, 1, 40, 0, -0.5, 0);

export const flatWorld = (): CollisionWorld => CollisionWorld.fromObjects([floor()]);

/** Ramp of `deg` rising toward +Z from z = z0 (8 m long, 6 m wide, 0.4 m thick) with a plateau on top. */
export function rampWorld(deg: number, z0 = 2): CollisionWorld {
  const a = (deg * Math.PI) / 180;
  const len = 8;
  const t = 0.4;
  const rise = Math.sin(a) * len;
  const run = Math.cos(a) * len;
  const ramp = box(6, t, len, 0, (len / 2) * Math.sin(a) - (t / 2) * Math.cos(a), z0 + (len / 2) * Math.cos(a) + (t / 2) * Math.sin(a), -a);
  const plateau = box(6, rise, 6, 0, rise / 2, z0 + run + 3);
  return CollisionWorld.fromObjects([floor(), ramp, plateau]);
}

/** Wall of height h across X whose near face is at z = zWall − 0.5, with a platform of the same height behind it. */
export function wallWorld(h: number, zWall = 3): CollisionWorld {
  return CollisionWorld.fromObjects([floor(), box(10, h, 1, 0, h / 2, zWall), box(10, h, 8, 0, h / 2, zWall + 4.5)]);
}

/** A raised floor of height h starting at z = z0. */
export function stepWorld(h: number, z0 = 1): CollisionWorld {
  return CollisionWorld.fromObjects([floor(), box(10, h, 20, 0, h / 2, z0 + 10)]);
}

/** Floor at y = 0 for z < z0 and at y = −drop beyond. */
export function dropWorld(drop: number, z0 = 3): CollisionWorld {
  return CollisionWorld.fromObjects([box(40, 1, 20, 0, -0.5, z0 - 10), box(40, 1, 20, 0, -drop - 0.5, z0 + 10)]);
}
