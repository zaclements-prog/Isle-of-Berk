import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import type { MotionTuning } from './tuning';
import { angleDiff, clamp, deg, lerp, wrapAngle } from './math';

type ControllerTuning = MotionTuning['controller'];

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

export interface MoveIntent {
  /** Desired world direction on the ground (unit) when hasDir. */
  dirX: number;
  dirZ: number;
  hasDir: boolean;
  speed: number;
  gallop: boolean;
  prowl: boolean;
  /** Edge-triggered action requests for M6 (jump, plasma). */
  jump: boolean;
  plasma: boolean;
}

export function createIntent(): MoveIntent {
  return { dirX: 0, dirZ: 0, hasDir: false, speed: 0, gallop: false, prowl: false, jump: false, plasma: false };
}

/** Input → intent (spec §6.2). Camera-relative WASD; C toggles prowl; Shift gallops. Ctrl is deliberately unbound. */
export class DragonController {
  prowl = false;

  read(input: InputState, cameraYaw: number, t: ControllerTuning, out: MoveIntent): MoveIntent {
    if (input.pressed.has('KeyC')) this.prowl = !this.prowl;
    const held = (codes: string[]) => codes.some((c) => input.keys.has(c));
    const f = (held(FORWARD) ? 1 : 0) - (held(BACK) ? 1 : 0);
    const r = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
    // camera forward = (sin yaw, 0, cos yaw); camera right = forward × up = (−cos yaw, 0, sin yaw)
    const x = f * Math.sin(cameraYaw) - r * Math.cos(cameraYaw);
    const z = f * Math.cos(cameraYaw) + r * Math.sin(cameraYaw);
    const len = Math.hypot(x, z);
    out.hasDir = len > 1e-6;
    out.dirX = out.hasDir ? x / len : 0;
    out.dirZ = out.hasDir ? z / len : 0;
    out.gallop = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    out.prowl = this.prowl && !out.gallop;
    out.speed = !out.hasDir ? 0 : out.gallop ? t.gallopSpeed : out.prowl ? t.prowlSpeed : t.trotSpeed;
    out.jump = input.pressed.has('Space');
    out.plasma = input.pressed.has('KeyF') || (input.buttonsPressed & 1) !== 0;
    return out;
  }
}

/**
 * Speed, heading and yaw rate of the body (spec §6.2): momentum (accel 5 m/s², gallop launch 8, braking 12), turn rate
 * 200°/s at ≤ 1.5 m/s tapering to 80°/s at full gallop, and turning (nearly) on the spot for large heading errors.
 * `pos` is the character-frame origin on the ground between the feet; the body always moves along its heading.
 */
export class BodyKinematics {
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  yawRate = 0;
  accel = 0;
  readonly velocity = new THREE.Vector3();
  /** Displacement proposed by the last plan() — collision may shorten it before commit(). */
  readonly delta = new THREE.Vector3();

  spawn(x: number, y: number, z: number, heading: number): void {
    this.pos.set(x, y, z);
    this.heading = wrapAngle(heading);
    this.speed = 0;
    this.yawRate = 0;
    this.accel = 0;
    this.velocity.set(0, 0, 0);
    this.delta.set(0, 0, 0);
  }

  plan(intent: MoveIntent, dt: number, t: ControllerTuning, speedCap = Infinity): void {
    let target = Math.min(intent.speed, speedCap);
    let rate = 0;
    if (intent.hasDir) {
      const err = angleDiff(this.heading, Math.atan2(intent.dirX, intent.dirZ));
      const k = clamp((this.speed - t.slowTurnSpeed) / Math.max(t.gallopSpeed - t.slowTurnSpeed, 1e-6), 0, 1);
      let maxRate = deg(lerp(t.turnRateSlowDeg, t.turnRateFastDeg, k));
      if (this.speed < t.inPlaceSpeed) maxRate = Math.min(maxRate, deg(t.inPlaceTurnRateDeg));
      rate = clamp(err * t.turnGain, -maxRate, maxRate);
      if (Math.abs(err) > deg(t.turnInPlaceAngleDeg)) target = Math.min(target, t.inPlaceSpeed);
      else target *= Math.max(0, Math.cos(err));
    }
    this.yawRate = rate;
    this.heading = wrapAngle(this.heading + rate * dt);
    const up = (intent.gallop ? t.gallopAccel : t.accel) * dt;
    const change = clamp(target - this.speed, -t.brake * dt, up);
    this.speed = Math.max(0, this.speed + change);
    this.accel = change / dt;
    this.velocity.set(Math.sin(this.heading) * this.speed, 0, Math.cos(this.heading) * this.speed);
    this.delta.copy(this.velocity).multiplyScalar(dt);
  }

  /** Apply the (collision-resolved) displacement; speed a wall took away is lost. */
  commit(delta: THREE.Vector3, dt: number): void {
    this.pos.x += delta.x;
    this.pos.z += delta.z;
    const along = Math.max(0, (delta.x * Math.sin(this.heading) + delta.z * Math.cos(this.heading)) / dt);
    if (along < this.speed - 1e-9) this.speed = along;
    this.velocity.set(delta.x / dt, 0, delta.z / dt);
  }
}
