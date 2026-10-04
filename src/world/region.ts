import type * as THREE from 'three';

/** Where Toothless (or a camera) may start in a region. Heading: forward = (sin h, 0, cos h). */
export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

/** Something worth looking at (Plan 4's look-at priorities: interest points > travel > camera). */
export interface InterestPoint {
  id: string;
  kind: 'water' | 'view' | 'butterfly' | 'fish' | 'flower';
  position: THREE.Vector3;
  weight: number;
}

/** A tree trunk collider: base centre (x, y, z), radius, height. */
export interface TreeCapsule {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

/** A sphere that pushes vegetation and ripples water (paws, body, tail). */
export interface InteractionSphere {
  center: THREE.Vector3;
  radius: number;
}

export interface RegionUpdateContext {
  time: number;
  camera: THREE.PerspectiveCamera;
  interactions: readonly InteractionSphere[];
}

/**
 * A streamed-in piece of the world (spec §7.1). Factories (e.g. `createCove(app)`) return a fully loaded
 * region; the Phase 3 island composes several.
 */
export interface Region {
  readonly id: string;
  readonly bounds: THREE.Box3;
  readonly transform: THREE.Matrix4;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  /** Invisible world-space collision meshes, in the form Plan 3's CollisionWorld.fromObjects consumes. */
  collisionRoots(): THREE.Object3D[];
  treeCapsules(): readonly TreeCapsule[];
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[];
  update(dt: number, ctx: RegionUpdateContext): void;
  dispose(): void;
}
