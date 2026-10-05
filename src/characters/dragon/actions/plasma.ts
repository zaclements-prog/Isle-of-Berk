import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionRig } from '../motion/rigTypes';
import type { MotionTuning } from '../motion/tuning';
import { angleDiff, deg, smoothstep } from '../motion/math';

type PlasmaTuning = MotionTuning['plasma'];
const ORDER = 2;
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();

/** A bolt leaving his mouth; the FX layer takes it from PlasmaAction.shots. */
export interface PlasmaShot {
  readonly from: THREE.Vector3;
  readonly dir: THREE.Vector3;
}

/**
 * The plasma blast (spec §6.13). F / left click: if the aim is more than ~100° off his facing he turns to it first;
 * then a ~0.3 s charge (the plasma_rear layer: head rears, jaw opens, teeth out, ears flat, pupils slit, dorsal plates
 * glow — its face curves); the bolt leaves the mouth anchor toward the aim point; a recoil kicks the head up, dips the
 * suspension and skids him back a little; then a ~0.7 s cooldown. The aim point comes from `aimAt` (the game: the
 * camera's aim ray) and is his top look priority while he charges and fires.
 */
export class PlasmaAction implements DragonAction {
  readonly name = 'plasma';
  phase: 'idle' | 'turn' | 'charge' | 'recover' = 'idle';
  t = 0;
  readonly aimPoint = new THREE.Vector3();
  /** Fired and not yet taken by the FX. */
  readonly shots: PlasmaShot[] = [];
  fired = 0;
  private cool = 0;
  private linger = 0;
  private skid = 0;
  private readonly mouthBone: number;
  private readonly mouthLocal: THREE.Vector3;

  constructor(
    rig: MotionRig, d: DragonCharacter, private readonly cfg: PlasmaTuning,
    private readonly aimAt: (d: DragonCharacter, out: THREE.Vector3) => THREE.Vector3,
  ) {
    const a = rig.anchors.mouth ?? { bone: rig.chains.neck[rig.chains.neck.length - 1], position: [0, 1.375, 2.2] as [number, number, number] };
    this.mouthBone = d.skeleton.id(a.bone);
    this.mouthLocal = d.skeleton.bindToLocal(this.mouthBone, new THREE.Vector3(...a.position), new THREE.Vector3());
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get aim(): THREE.Vector3 | null {
    return this.phase === 'idle' ? null : this.aimPoint;
  }

  get aggressive(): boolean {
    return this.phase !== 'idle' || this.linger > 0;
  }

  /** Abandon the blast at once (a respawn): no rear-up layer, pending shot, cooldown or lingering aggression. */
  reset(d: DragonCharacter): void {
    if (d.layers.has('plasma_rear')) d.layers.set('plasma_rear', 0);
    this.phase = 'idle';
    this.t = 0;
    this.cool = 0;
    this.linger = 0;
    this.skid = 0;
    this.shots.length = 0;
  }

  /** World position of the mouth anchor (the muzzle). */
  mouth(d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 {
    return d.skeleton.toWorld(this.mouthBone, this.mouthLocal, out);
  }

  step(d: DragonCharacter, dt: number, standing: boolean): void {
    const c = this.cfg;
    this.cool = Math.max(0, this.cool - dt);
    this.linger = Math.max(0, this.linger - dt);
    this.t += dt;
    const L = d.layers;
    if (this.phase === 'idle') {
      if (!d.intent.plasma || !standing || this.cool > 0 || d.mods.scripted) return;
      this.aimAt(d, this.aimPoint);
      this.phase = Math.abs(this.offAim(d)) > deg(c.turnFirstDeg) ? 'turn' : 'charge';
      this.t = 0;
    }
    if (this.phase === 'turn') {
      this.aimAt(d, this.aimPoint);
      _d.subVectors(this.aimPoint, d.kin.pos);
      const len = Math.hypot(_d.x, _d.z) || 1;
      d.intent.hasDir = true;
      d.intent.dirX = _d.x / len;
      d.intent.dirZ = _d.z / len;
      d.intent.speed = 0;                                   // turn on the spot
      if (Math.abs(this.offAim(d)) < deg(c.chargeFacingDeg) || this.t > c.turnTimeout) {
        this.phase = 'charge';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'charge') {
      this.aimAt(d, this.aimPoint);
      d.mods.speedCap = 0;
      d.intent.hasDir = false;
      if (L.has('plasma_rear')) L.set('plasma_rear', smoothstep(0, L.meta('plasma_rear')?.blendIn ?? 0.15, this.t), this.t, false, ORDER);
      if (this.t >= c.chargeTime) this.fire(d);
      return;
    }
    // recover: the rear-up blends out while the charge's face curves play on; the skid decays
    const bo = L.meta('plasma_rear')?.blendOut ?? 0.3;
    if (L.has('plasma_rear')) L.set('plasma_rear', 1 - smoothstep(0, bo, this.t), c.chargeTime + this.t, false, ORDER);
    if (this.skid > 1e-3) {
      _d.set(-Math.sin(d.kin.heading), 0, -Math.cos(d.kin.heading)).multiplyScalar(this.skid * dt);
      d.proxies.update(d.skeleton);
      d.proxies.resolveMove(d.world, _d, d.tuning.body.wallNormalY);
      d.kin.pos.add(_d);
      this.skid *= Math.exp(-c.skidDecay * dt);
    }
    if (this.t >= bo) {
      if (L.has('plasma_rear')) L.set('plasma_rear', 0);
      this.phase = 'idle';
    }
  }

  private offAim(d: DragonCharacter): number {
    return angleDiff(d.kin.heading, Math.atan2(this.aimPoint.x - d.kin.pos.x, this.aimPoint.z - d.kin.pos.z));
  }

  private fire(d: DragonCharacter): void {
    const c = this.cfg;
    this.mouth(d, _m);
    this.shots.push({ from: _m.clone(), dir: _d.subVectors(this.aimPoint, _m).normalize().clone() });
    this.fired++;
    d.body.impulse(c.recoilDrop);
    d.look.headPitch.v += c.recoilKick;
    this.skid = c.skidSpeed;
    this.cool = c.cooldown;
    this.linger = c.lingerAggro;
    this.phase = 'recover';
    this.t = 0;
  }
}
