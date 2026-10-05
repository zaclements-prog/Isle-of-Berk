import * as THREE from 'three';
import type { CollisionWorld } from '../world/collision';
import type { MotionTuning } from '../characters/dragon/motion/tuning';
import { angleDiff, clamp, dampFactor, deg, smoothstep, wrapAngle } from '../characters/dragon/motion/math';
import { Vec3Spring, stepSpring, type SpringState } from '../characters/dragon/motion/springs';

type CameraTuning = MotionTuning['camera'];

export interface CameraFollow {
  /** Chest-height point to orbit. */
  readonly chest: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly heading: number;
  readonly moving: boolean;
  readonly climbing: boolean;
  /** Body spheres (world) for the proximity fade. */
  readonly bodySpheres: ReadonlyArray<{ center: THREE.Vector3; radius: number }>;
}

export interface CameraInput {
  mouseDX: number;
  mouseDY: number;
  wheel: number;
}

const _goal = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();

/**
 * Third-person orbit camera (spec §6.15):
 * - Orbits a chest-height target; the mouse moves it under pointer lock, the wheel sets the distance (4–18 m).
 * - Follows with a critically damped spring and velocity look-ahead.
 * - Sphere-casts from the target, pulling in instantly and easing back out slowly, and never ends inside geometry.
 * - Recentres behind him after ~2 s without mouse input while he moves; raises its pitch while he climbs.
 * - Reports a `fade` when forced within ~1.2 m of his body.
 */
export class OrbitCamera {
  /** Forward yaw (heading convention: forward = (sin yaw, 0, cos yaw)); camera-relative controls read it. */
  yaw = 0;
  pitch: number;
  /** Wanted distance (wheel); currentDistance is what collision allows. */
  distance: number;
  currentDistance: number;
  /** Camera-proximity fade for the dragon: 0 = opaque, 1 = gone. */
  fade = 0;
  readonly target = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  private readonly follow = new Vec3Spring();
  private readonly climbPitch: SpringState = { x: 0, v: 0 };
  private readonly dist: SpringState = { x: 0, v: 0 };
  private sinceMouse = 0;
  private shakeT = 0;
  private shakeDur = 1;
  private shakeAmp = 0;
  private shakeClock = 0;

  constructor(private readonly t: CameraTuning, public world: CollisionWorld) {
    this.pitch = deg(t.pitchDeg);
    this.distance = t.distance;
    this.currentDistance = t.distance;
  }

  reset(f: CameraFollow): void {
    this.yaw = f.heading;
    this.pitch = deg(this.t.pitchDeg);
    this.distance = this.t.distance;
    this.currentDistance = this.distance;
    this.dist.x = this.distance;
    this.dist.v = 0;
    this.climbPitch.x = this.climbPitch.v = 0;
    this.sinceMouse = 0;
    this.follow.reset(f.chest);
    this.target.copy(f.chest);
  }

  update(input: CameraInput, f: CameraFollow, dt: number): void {
    const t = this.t;
    if (input.mouseDX !== 0 || input.mouseDY !== 0) this.sinceMouse = 0;
    else this.sinceMouse += dt;
    this.yaw = wrapAngle(this.yaw - input.mouseDX * t.sensitivity);
    this.pitch = clamp(this.pitch + input.mouseDY * t.sensitivity, deg(t.minPitchDeg), deg(t.maxPitchDeg));
    this.distance = clamp(this.distance * Math.exp(input.wheel * t.wheelScale), t.minDistance, t.maxDistance);
    if (f.moving && this.sinceMouse > t.recentreDelay) {
      this.yaw = wrapAngle(this.yaw + angleDiff(this.yaw, f.heading) * dampFactor(1 / t.recentreOmega, dt));
    }
    stepSpring(this.climbPitch, f.climbing ? deg(t.climbPitchDeg) : 0, t.climbPitchOmega, 1, dt);

    _goal.copy(f.chest).addScaledVector(f.velocity, t.lookAhead);
    this.follow.step(_goal, t.followOmega, 1, dt);
    this.target.copy(this.follow.x);

    const pitch = clamp(this.pitch + this.climbPitch.x, deg(t.minPitchDeg), deg(t.maxPitchDeg));
    _dir.set(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
    _want.copy(this.target).addScaledVector(_dir, this.distance);
    const free = this.world.sphereCast(this.target, _want, t.radius) * this.distance;
    if (free < this.dist.x) {
      this.dist.x = free; // pull in at once
      this.dist.v = 0;
    } else {
      stepSpring(this.dist, free, t.easeOutOmega, 1, dt); // ease back out slowly
    }
    this.currentDistance = this.dist.x;
    this.position.copy(this.target).addScaledVector(_dir, this.currentDistance);
    // last resort (a target already inside geometry casts to 0): step in until the lens is clear
    for (let k = 0; k < 10 && this.world.closestPoint(this.position, t.radius * 0.5); k++) {
      this.dist.x = this.currentDistance *= 0.8;
      this.position.copy(this.target).addScaledVector(_dir, this.currentDistance);
    }

    if (this.shakeT > 0) {
      // M6 impact shake: a decaying sum of sines (deterministic), position more than aim
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.shakeClock += dt;
      const k = (this.shakeAmp * (this.shakeT / this.shakeDur) ** 2) / 1.5;
      const c = this.shakeClock;
      _shake.set(Math.sin(c * 71.3) + 0.5 * Math.sin(c * 37.1), Math.sin(c * 83.7 + 1.3) + 0.5 * Math.sin(c * 29.3), Math.sin(c * 61.9 + 2.1))
        .multiplyScalar(k);
      this.position.add(_shake);
      this.target.addScaledVector(_shake, 0.5);
    }

    let nearest = Infinity;
    for (const s of f.bodySpheres) nearest = Math.min(nearest, this.position.distanceTo(s.center) - s.radius);
    this.fade = 1 - smoothstep(t.fadeNear, t.fadeFar, nearest);
  }

  /** Impact shake (M6 plasma): amplitude (m) fading over duration (s); a stronger shake overrides a weaker one. */
  shake(amplitude: number, duration: number): void {
    const now = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / this.shakeDur) ** 2 : 0;
    if (amplitude <= now) return;
    this.shakeAmp = amplitude;
    this.shakeDur = Math.max(duration, 1e-3);
    this.shakeT = this.shakeDur;
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }
}
