import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionRig } from '../motion/rigTypes';
import type { MotionTuning } from '../motion/tuning';
import { angleDiff, deg, smoothstep } from '../motion/math';

type PlasmaTuning = MotionTuning['plasma'];
const ORDER = 2;
/** The airborne charge plays over the flight clips (flight 3; the tuck's fold layer is also 4, but wings only). */
const AIR_ORDER = 4;
/** Derived layers (PoseLayerStack.derive) from plasma_rear: its face curves alone; its neck and head, additive. */
const AIR_FACE = 'plasma_air_face';
const AIR_NECK = 'plasma_air_neck';
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

/** A bolt leaving his mouth; the FX layer takes it from PlasmaAction.shots. */
export interface PlasmaShot {
  readonly from: THREE.Vector3;
  /** Unit direction: from the mouth along the aim ray. */
  readonly dir: THREE.Vector3;
  /** Speed along `dir` (m/s): the muzzle speed plus the body's speed along the ray; absent = tuning.plasma.boltSpeed. */
  readonly speed?: number;
}

/**
 * What the plasma reads from (and does to) the body in the air: the flight, or a jump's arc. Without one (the lab,
 * the tests' bare brain) he only fires standing.
 */
export interface PlasmaBody {
  /** In the air: the blast fires on the wing (no standing rear, no turn on the spot). */
  airborne(): boolean;
  /** The body's world velocity (m/s), the path's own (no flap bob). */
  velocity(out: THREE.Vector3): THREE.Vector3;
  /** While he charges on the wing: slow the flap's beat by this share (0…1), a held stroke; 0 lets it go. */
  hitch?(share: number): void;
  /** The release on the wing: a nose-up pitch (rad) easing in and out, and a little speed (m/s) lost. */
  recoil?(pitch: number, speedLoss: number): void;
}

/**
 * The bolt's speed along the aim ray when fired from a moving body. The bolt flies from the mouth ALONG the aim ray
 * (so it lands on the reticle, whatever he is doing), at the muzzle speed plus the body's velocity component along
 * that ray: in effect the throw leads out the body's sideways drift and keeps its push toward the target. A dive at
 * the target makes the bolt arrive faster; flying away from it never makes it slower than the muzzle speed.
 */
export function boltSpeedFrom(muzzle: number, dir: THREE.Vector3, body: THREE.Vector3, inherit = 1): number {
  return muzzle + inherit * Math.max(0, dir.dot(body));
}

/**
 * The plasma blast (spec §6.13). F / left click: if the aim is more than ~100° off his facing he turns to it first;
 * then a ~0.3 s charge (the plasma_rear layer: head rears, jaw opens, teeth out, ears flat, pupils slit, dorsal plates
 * glow — its face curves); the bolt leaves the mouth anchor toward the aim point; a recoil kicks the head up, dips the
 * suspension and skids him back a little; then a ~0.7 s cooldown. The aim point comes from `aimAt` (the game: the
 * camera's aim ray) and is his top look priority while he charges and fires.
 *
 * On the wing (a PlasmaBody says he is airborne: flying in any phase, or a jump's arc) there is no turn and no rear:
 * the charge plays plasma_rear's face (jaw, teeth, slit pupils, plate glow) and a share of its neck and head additively
 * over the flight clips (AIR_ORDER), the head snaps to the aim (the look's spring sped up by airSnap), the flap's beat
 * is held back a little (a hitch that keeps the cycle's phase continuous), and the release pitches his nose up and
 * costs a little speed. He fires only into a forward cone (airConeDeg about his flight path, the bolt never crosses
 * his own wings): an aim outside it holds the charge up to airHoldTime while the flight's camera steering turns him
 * toward it (the aim comes from the same camera), then lets the blast go unfired, with no cooldown. The bolt leaves
 * along the aim ray with the body's speed along it added (boltSpeedFrom).
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
  /** This blast is on the wing (decided at the press). */
  air = false;
  /** On the wing, the last aim's angle off his flight path (rad). */
  offPath = 0;
  /** Blasts let go unfired: the aim stayed outside the forward cone. */
  dropped = 0;
  private readonly mouthBone: number;
  private readonly mouthLocal: THREE.Vector3;
  private readonly airLayers: boolean;
  private dt = 1 / 120;

  constructor(
    rig: MotionRig, d: DragonCharacter, private readonly cfg: PlasmaTuning,
    private readonly aimAt: (d: DragonCharacter, out: THREE.Vector3) => THREE.Vector3,
    private readonly body?: PlasmaBody,
  ) {
    const a = rig.anchors.mouth ?? { bone: rig.chains.neck[rig.chains.neck.length - 1], position: [0, 1.375, 2.2] as [number, number, number] };
    this.mouthBone = d.skeleton.id(a.bone);
    this.mouthLocal = d.skeleton.bindToLocal(this.mouthBone, new THREE.Vector3(...a.position), new THREE.Vector3());
    // the airborne charge's layers, made from the standing rear: its face curves on no bones; its neck and head only
    this.airLayers = d.layers.derive(AIR_FACE, 'plasma_rear', { mask: [], root: undefined, wings: undefined })
      && d.layers.derive(AIR_NECK, 'plasma_rear', { mask: ['neck_', 'head'], root: undefined, wings: undefined, face: undefined });
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
    this.airPose(d, 0, 0);
    this.phase = 'idle';
    this.air = false;
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
    this.dt = dt;
    const L = d.layers;
    if (this.phase === 'idle') {
      if (!d.intent.plasma || this.cool > 0) return;
      const air = this.body?.airborne() ?? false;
      if (!air && (!standing || d.mods.scripted)) return;
      this.air = air;
      this.aimAt(d, this.aimPoint);
      this.phase = !air && Math.abs(this.offAim(d)) > deg(c.turnFirstDeg) ? 'turn' : 'charge';
      this.t = 0;
    }
    if (this.air) return this.stepAir(d);
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

  /** The blast on the wing: charge (holding while the aim is outside the cone), fire, recover. */
  private stepAir(d: DragonCharacter): void {
    const c = this.cfg;
    const L = d.layers;
    const bi = L.meta('plasma_rear')?.blendIn ?? 0.15;
    const bo = L.meta('plasma_rear')?.blendOut ?? 0.3;
    if (this.phase === 'charge') {
      this.aimAt(d, this.aimPoint);
      const w = smoothstep(0, bi, this.t);
      // the face's curves run to the release and hold there while he waits for the aim to come round
      this.airPose(d, w, Math.min(this.t, c.chargeTime));
      d.look.snap = c.airSnap;
      this.body?.hitch?.(c.airHitch * w);
      this.mouth(d, _m);
      this.offPath = this.angleOffPath(d, _d.subVectors(this.aimPoint, _m));
      const inCone = this.offPath <= deg(c.airConeDeg);
      if (this.t >= c.chargeTime && inCone) this.fire(d);
      else if (this.t >= c.chargeTime + c.airHoldTime) {
        // never came round: let it go unfired (no cooldown spent)
        this.dropped++;
        this.phase = 'recover';
        this.t = 0;
      }
      return;
    }
    // recover: the charge pose blends out, the head's spring and the beat go back to normal
    const w = 1 - smoothstep(0, bo, this.t);
    this.airPose(d, w, c.chargeTime + this.t);
    this.body?.hitch?.(c.airHitch * w * (1 - smoothstep(0, 0.12, this.t)));
    d.look.snap = 1 + (c.airSnap - 1) * w;
    if (this.t >= bo) {
      this.airPose(d, 0, 0);
      this.body?.hitch?.(0);
      d.look.snap = 1;
      this.phase = 'idle';
      this.air = false;
    }
  }

  /** The airborne charge's layers at weight w (the neck's share of it is airRear), at time t on plasma_rear's clock. */
  private airPose(d: DragonCharacter, w: number, t: number): void {
    if (!this.airLayers) return;
    d.layers.set(AIR_FACE, w > 1e-4 ? w : 0, t, false, AIR_ORDER);
    const n = w * this.cfg.airRear;
    d.layers.set(AIR_NECK, n > 1e-4 ? n : 0, t, true, AIR_ORDER);
  }

  /** Angle (rad) between a direction and his flight path (the body's velocity; slow, his facing). */
  private angleOffPath(d: DragonCharacter, dir: THREE.Vector3): number {
    const v = this.body ? this.body.velocity(_v) : _v.set(0, 0, 0);
    if (v.lengthSq() > 4) _f.copy(v).normalize();
    else _f.set(Math.sin(d.kin.heading), 0, Math.cos(d.kin.heading));
    return _f.angleTo(dir);
  }

  private offAim(d: DragonCharacter): number {
    return angleDiff(d.kin.heading, Math.atan2(this.aimPoint.x - d.kin.pos.x, this.aimPoint.z - d.kin.pos.z));
  }

  private fire(d: DragonCharacter): void {
    const c = this.cfg;
    this.mouth(d, _m);
    if (this.air) {
      // the skeleton is last step's: carry the muzzle on by one step of the body's velocity
      this.body!.velocity(_v);
      _m.addScaledVector(_v, this.dt);
      const dir = _d.subVectors(this.aimPoint, _m).normalize().clone();
      this.shots.push({ from: _m.clone(), dir, speed: boltSpeedFrom(c.boltSpeed, dir, _v, c.inherit) });
      this.body!.recoil?.(deg(c.airRecoilDeg), c.airRecoilSpeed);
    } else {
      this.shots.push({ from: _m.clone(), dir: _d.subVectors(this.aimPoint, _m).normalize().clone() });
      d.body.impulse(c.recoilDrop);
      this.skid = c.skidSpeed;
    }
    this.fired++;
    d.look.headPitch.v += c.recoilKick;
    this.cool = c.cooldown;
    this.linger = c.lingerAggro;
    this.phase = 'recover';
    this.t = 0;
  }
}
