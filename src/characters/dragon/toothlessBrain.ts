import * as THREE from 'three';
import { JumpAction } from './actions/jump';
import { PlasmaAction } from './actions/plasma';
import { DragonBrain } from './behaviour/brain';
import type { DragonCharacter } from './motion/dragon';
import type { MotionRig } from './motion/rigTypes';

export interface ToothlessBrainOptions {
  seed?: number;
  sunDir?: THREE.Vector3;
  /** Where plasma goes (the game: the camera's aim ray). Default: 30 m ahead of his head. */
  aimAt?: (d: DragonCharacter, out: THREE.Vector3) => THREE.Vector3;
}

export interface ToothlessBrain {
  readonly brain: DragonBrain;
  readonly jump: JumpAction;
  readonly plasma: PlasmaAction;
}

/** Straight ahead of his head, 30 m out. */
function aheadAim(d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 {
  d.headPos(out);
  return out.set(out.x + Math.sin(d.kin.heading) * 30, out.y, out.z + Math.cos(d.kin.heading) * 30);
}

/** Toothless's M6 layer on a DragonCharacter: the brain with the jump and plasma actions (lab, game, tests). */
export function createToothlessBrain(d: DragonCharacter, rig: MotionRig, o: ToothlessBrainOptions = {}): ToothlessBrain {
  const jump = new JumpAction(d.tuning.jump);
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, o.aimAt ?? aheadAim);
  const brain = new DragonBrain(d, { rig, seed: o.seed, sunDir: o.sunDir, actions: [jump, plasma] });
  return { brain, jump, plasma };
}
