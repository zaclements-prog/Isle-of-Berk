import * as THREE from 'three';
import { ScriptedInput } from '../../core/input';
import { OrbitCamera, type CameraFollow } from '../../camera/orbitCamera';
import { DragonCharacter } from '../../characters/dragon/motion/dragon';
import { MotionMetrics, type MetricsReport } from '../../characters/dragon/motion/metrics';
import type { PosesMeta } from '../../characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../characters/dragon/motion/rigTypes';
import type { MotionTuning } from '../../characters/dragon/motion/tuning';
import type { CollisionWorld } from '../../world/collision';
import type { LabScript } from './scripts';

export interface LabRunOptions {
  rig: MotionRig;
  world: CollisionWorld;
  script: LabScript;
  tuning?: MotionTuning;
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  posesMeta?: PosesMeta;
  onStep?: (d: DragonCharacter, t: number) => void;
  /** Called once after spawning (M6: attach the brain and actions). */
  setup?: (d: DragonCharacter, cam: OrbitCamera) => void;
}

/** Build the camera's view of the dragon (shared by the runner, the lab page and the game page). */
export function cameraFollow(d: DragonCharacter, out: { chest: THREE.Vector3 }): CameraFollow {
  d.chestPos(out.chest);
  return {
    chest: out.chest, velocity: d.kin.velocity, heading: d.kin.heading, moving: d.kin.speed > 0.2,
    climbing: d.climb.mode === 'climb' || d.climb.mode === 'scramble',
    bodySpheres: d.proxies.items.map((p, k) => ({ center: d.proxies.centers[k], radius: p.radius })),
  };
}

/** Run a script deterministically at 1/120 s with no rendering and return the spec §8.2 metrics. */
export function runLabScript(o: LabRunOptions): MetricsReport {
  const dt = 1 / 120;
  const d = new DragonCharacter({ rig: o.rig, world: o.world, tuning: o.tuning, clips: o.clips, posesMeta: o.posesMeta, seed: 1 });
  d.spawn(o.script.spawn.x, o.script.spawn.z, o.script.spawn.heading);
  const cam = new OrbitCamera(d.tuning.camera, o.world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(d, hold));
  o.setup?.(d, cam);
  const input = new ScriptedInput(o.script.events);
  const metrics = new MotionMetrics(o.world, o.script.duration);
  const yawPx = o.script.cameraYawRate ? -(o.script.cameraYawRate * dt) / d.tuning.camera.sensitivity : 0;
  const n = Math.round(o.script.duration / dt);
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    const inp = input.sample(t);
    cam.update({ mouseDX: inp.mouseDX + yawPx, mouseDY: inp.mouseDY, wheel: inp.wheel }, cameraFollow(d, hold), dt);
    d.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    metrics.sample(d);
    maxY = Math.max(maxY, d.kin.pos.y);
    o.onStep?.(d, t);
  }
  const report = metrics.report(o.script.name);
  const g = o.script.goal;
  if (g) {
    const travel = Math.hypot(d.kin.pos.x - o.script.spawn.x, d.kin.pos.z - o.script.spawn.z);
    if (g.minEndY !== undefined && d.kin.pos.y < g.minEndY) report.failures.push(`goal: ended at y ${d.kin.pos.y.toFixed(2)} < ${g.minEndY.toFixed(2)}`);
    if (g.maxEndY !== undefined && d.kin.pos.y > g.maxEndY) report.failures.push(`goal: ended at y ${d.kin.pos.y.toFixed(2)} > ${g.maxEndY.toFixed(2)}`);
    if (g.maxY !== undefined && maxY > g.maxY) report.failures.push(`goal: rose to y ${maxY.toFixed(2)} > ${g.maxY.toFixed(2)}`);
    if (g.minTravel !== undefined && travel < g.minTravel) report.failures.push(`goal: travelled ${travel.toFixed(2)} m < ${g.minTravel} m`);
    report.pass = report.failures.length === 0;
  }
  return report;
}
