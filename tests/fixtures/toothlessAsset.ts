import { existsSync, readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parsePosesMeta, type PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const DIR = 'public/assets/characters/toothless/';

/** The exported asset with the M6 pose library (poses.json v2) is present. */
export const HAS_LIBRARY = existsSync(`${DIR}toothless.rig.json`) && existsSync(`${DIR}toothless.poses.glb`)
  && existsSync(`${DIR}toothless.poses.json`)
  && (JSON.parse(readFileSync(`${DIR}toothless.poses.json`, 'utf8')) as { version?: number }).version === 2;

export interface ToothlessMotionAsset {
  rig: MotionRig;
  clips: Map<string, THREE.AnimationClip>;
  posesMeta: PosesMeta;
}

let cached: Promise<ToothlessMotionAsset> | null = null;

/** rig.json + the poses GLB's clips (GLTFLoader.parse runs in node for an armature-only GLB) + poses.json. */
export function loadToothlessMotion(): Promise<ToothlessMotionAsset> {
  cached ??= (async () => {
    const buf = readFileSync(`${DIR}toothless.poses.glb`);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    return {
      rig: JSON.parse(readFileSync(`${DIR}toothless.rig.json`, 'utf8')) as MotionRig,
      clips: new Map(gltf.animations.map((c) => [c.name, c])),
      posesMeta: parsePosesMeta(JSON.parse(readFileSync(`${DIR}toothless.poses.json`, 'utf8'))),
    };
  })();
  return cached;
}
