import * as THREE from 'three';
import type { MotionRig } from '../motion/rigTypes';
import type { RigSkeleton } from '../motion/skeleton';
import type { SecondaryMotion } from '../motion/secondary';
import { deg, lerp } from '../motion/math';
import type { FaceState } from './face';

const AX = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();

/**
 * The face's rig-side channels, written in DragonCharacter's face hook (spec §6.1 step 8): the jaw, ABSOLUTE from bind
 * every step (rest = closed by rig.jaw.restCloseRad, the lips meeting; open = openSign · maxOpenRad), and the ears'
 * mood bias for SecondaryMotion's next step. No pose layer masks the jaw, so nothing else writes it.
 */
export class FaceRig {
  readonly jaw: number;
  /** The head bone (the brain reads its forward axis for "sun in his face"). */
  readonly head: number;
  private readonly closed: number;
  private readonly open: number;

  constructor(rig: MotionRig, s: RigSkeleton) {
    const j = rig.jaw ?? { bone: 'jaw', openSign: -1, maxOpenRad: 0.62 };
    this.jaw = s.id(j.bone);
    this.head = s.id(rig.chains.neck[rig.chains.neck.length - 1]);
    const sign = Math.sign(j.openSign) || -1;
    this.closed = -sign * Math.abs(j.restCloseRad ?? 0);
    this.open = sign * j.maxOpenRad;
  }

  /** Jaw rotation about its local X (rad) for an opening 0…1. */
  angle(open: number): number {
    return lerp(this.closed, this.open, open);
  }

  apply(s: RigSkeleton, secondary: SecondaryMotion, st: FaceState): void {
    s.localQuat[this.jaw].copy(s.bindLocalQuat[this.jaw]).multiply(_q.setFromAxisAngle(AX, this.angle(st.jaw)));
    secondary.earBias = deg(st.earsDeg);
  }
}
