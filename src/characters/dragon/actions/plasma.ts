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
  /** The blast's power (× tuning.plasma.blastPower: it scales the bolt, the flash and every world effect); absent = 1. */
  readonly power?: number;
  /** How far the long fire was charged (0 = a quick shot … 1 = full). */
  readonly charge?: number;
}

/**
 * The long fire's charge so far (0…1) after holding `held` s from the press: nothing within tapTime (a quick shot),
 * then linear up to fullTime.
 */
export function chargeFraction(c: PlasmaTuning, held: number): number {
  if (held >= c.fullTime - 1e-6) return 1;                          // (a step-summed hold lands a hair short)
  return Math.min(1, Math.max(0, (held - c.tapTime) / Math.max(1e-6, c.fullTime - c.tapTime)));
}

/** A blast's power for a charge (0…1): tapPower for a quick shot up to fullPower, easing in (a full charge pays most). */
export function chargePower(c: PlasmaTuning, charge: number): number {
  return c.tapPower + (c.fullPower - c.tapPower) * Math.max(0, Math.min(1, charge)) ** 1.5;
}

/** The cooldown after a blast of this charge (0…1): the quick shot's up to a full charge's. */
export function chargeCooldown(c: PlasmaTuning, charge: number): number {
  return c.cooldown + (c.fullCooldown - c.cooldown) * Math.max(0, Math.min(1, charge));
}

/**
 * The dorsal plates' glow (berkPlasmaGlow) while he charges: the quick shot's ramp to tapGlow over the wind-up (`windup`
 * s into it), and a long charge (`held` s since the press, past tapTime) climbing from there to fullGlow at full
 * charge, with a pulse that dips deeper and quickens (3 → 8 Hz, to −35 %) over its last (1 − flickerFrom) share. At full charge
 * the pulse is at its crest (the moment it fires is the brightest).
 */
export function chargeGlow(c: PlasmaTuning, windup: number, held: number): number {
  const ramp = c.tapGlow * smoothstep(0, c.chargeTime, windup);
  if (held <= c.tapTime) return ramp;
  const f = chargeFraction(c, held);
  let g = c.tapGlow + (c.fullGlow - c.tapGlow) * f ** 1.4;
  if (f > c.flickerFrom) {
    const T = (1 - c.flickerFrom) * (c.fullTime - c.tapTime);       // the flicker's span (s)
    const tau = (f - c.flickerFrom) * (c.fullTime - c.tapTime);     // into it (s)
    const amp = tau / T;
    // phase of a pulse whose frequency rises 3 → 8 Hz over T, shifted so it crests at full charge
    const ph = (x: number) => 3 * x + (2.5 * x * x) / T;
    g *= 1 - 0.35 * amp * 0.5 * (1 - Math.cos(2 * Math.PI * (ph(tau) - ph(T))));
  }
  return Math.max(ramp, g);
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
 * Where the long charge's light has climbed to along the spine (the materials' plasmaSweep.x: 0 = the tail tip … 1 =
 * the head, 1.2 = every plate alike): a quick shot lights them all at once; a long charge runs the light from the tail
 * up to the head over the first 80 % of the charge, the rest of the plates holding the quick shot's glow.
 */
export function chargeSweep(c: PlasmaTuning, held: number): number {
  if (held <= c.tapTime) return 1.2;
  return Math.min(1.2, (chargeFraction(c, held) / 0.8) * 1.1);
}

/**
 * The plasma blast (spec §6.13), quick fire and long fire. A quick press (F / left click released within tapTime) is a
 * small shot (tapPower) after the usual ~0.3 s wind-up, with a short cooldown, so taps fire in quick succession (a tap
 * up to pressBuffer s early is kept). Held on, the blast charges: the dorsal plates light up (`glow`, chargeGlow) from
 * the quick shot's level to a bright, flickering fullGlow, and at fullTime from the press it fires itself at fullPower
 * (a much bigger bolt and blast, a bigger recoil and a longer cooldown). Released between the two, it fires at once
 * with the power charged so far (chargePower): the hold is never wasted, and a tap never needs to be a perfect click.
 * The same on the ground and on the wing. `press(holdSeconds)` / `release()` script it (berk.toothless.fireHold).
 *
 * F / left click: if the aim is more than ~100° off his facing he turns to it first;
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
  /** Seconds the button has been held since this blast's press (frozen at the release). */
  held = 0;
  /** The button is still down for this blast. */
  holding = false;
  /** The last blast's charge (0…1) and power. */
  lastCharge = 0;
  lastPower = 0;
  /** A press waiting for him to be ready (s it is kept for). */
  private queued = 0;
  /** Scripted press / hold (s) for the debug API and captures. */
  private scriptPress = false;
  private scriptHold = 0;
  /** On the wing: s spent ready to fire with the aim outside the cone. */
  private wait = 0;
  /** The plates' glow when it fired (the recover fades it out). */
  private fireGlow = 0;
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

  /** The long fire's charge so far (0…1); 0 when idle or for a quick shot. */
  get charge(): number {
    return this.phase === 'turn' || this.phase === 'charge' ? chargeFraction(this.cfg, this.held) : 0;
  }

  /** The dorsal plates' glow he drives (DragonAction.glow): charging, then fading after the release; null idle. */
  get glow(): number | null {
    if (this.phase === 'idle') return null;
    if (this.phase === 'recover') return this.fireGlow * (1 - smoothstep(0, this.cfg.chargeTime, this.t));
    return chargeGlow(this.cfg, this.phase === 'charge' ? this.t : 0, this.held);
  }

  /**
   * The plates' sweep for the materials (plasmaSweep): the lit front along the spine and the share of the glow the
   * plates ahead of it keep (the quick shot's level). All alike when idle, after the release, or for a quick shot.
   */
  sweep(out: THREE.Vector2): THREE.Vector2 {
    const g = this.glow ?? 0;
    if (this.phase !== 'turn' && this.phase !== 'charge') return out.set(1.2, 1);
    return out.set(chargeSweep(this.cfg, this.held), g > this.cfg.tapGlow ? this.cfg.tapGlow / g : 1);
  }

  /** A scripted press (the debug API): held for `holdSeconds` of simulation time (0: a tap, Infinity: until release). */
  press(holdSeconds = 0): void {
    this.scriptPress = true;
    this.scriptHold = holdSeconds;
  }

  /** Let a scripted hold go. */
  release(): void {
    this.scriptHold = 0;
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
    this.held = 0;
    this.holding = false;
    this.queued = 0;
    this.scriptPress = false;
    this.scriptHold = 0;
    this.wait = 0;
    this.fireGlow = 0;
  }

  /** The muzzle as a bone name and a point in its local frame (the render places the charge's mouth glow by it). */
  mouthAnchor(d: DragonCharacter): { bone: string; local: THREE.Vector3 } {
    return { bone: d.skeleton.names[this.mouthBone], local: this.mouthLocal };
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
    // the button: a press (kept pressBuffer s while he is busy), and whether it is still down
    const down = d.intent.plasmaHeld || this.scriptHold > 0;
    this.scriptHold = Math.max(0, this.scriptHold - dt);
    if (d.intent.plasma || this.scriptPress) this.queued = c.pressBuffer + dt;
    this.scriptPress = false;
    this.queued = Math.max(0, this.queued - dt);
    if (this.phase === 'idle') {
      if (this.queued <= 0 || this.cool > 0) return;
      const air = this.body?.airborne() ?? false;
      if (!air && (!standing || d.mods.scripted)) return;
      this.queued = 0;
      this.air = air;
      this.aimAt(d, this.aimPoint);
      this.phase = !air && Math.abs(this.offAim(d)) > deg(c.turnFirstDeg) ? 'turn' : 'charge';
      this.t = 0;
      this.held = 0;
      this.holding = down;
      this.wait = 0;
    } else if (this.phase !== 'recover' && this.holding) {
      if (down) this.held += dt;
      else this.holding = false;
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
      if (this.t >= c.chargeTime && this.ready) this.fire(d);
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
      // a long charge holds the beat back less (he has to stay up for two seconds)
      this.body?.hitch?.(c.airHitch * w * (this.held > c.tapTime ? 0.5 : 1));
      this.mouth(d, _m);
      this.offPath = this.angleOffPath(d, _d.subVectors(this.aimPoint, _m));
      const inCone = this.offPath <= deg(c.airConeDeg);
      const ready = this.t >= c.chargeTime && this.ready;
      if (ready && inCone) this.fire(d);
      else if (ready && (this.wait += this.dt) > c.airHoldTime + 1e-9) {
        // never came round: let it go unfired (no cooldown spent)
        this.dropped++;
        this.fireGlow = this.glow ?? 0;
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

  /** The charge is done: released (a quick shot, or a long one let go early), or held to full. */
  private get ready(): boolean {
    return !this.holding || this.held >= this.cfg.fullTime - 1e-6;
  }

  private offAim(d: DragonCharacter): number {
    return angleDiff(d.kin.heading, Math.atan2(this.aimPoint.x - d.kin.pos.x, this.aimPoint.z - d.kin.pos.z));
  }

  private fire(d: DragonCharacter): void {
    const c = this.cfg;
    const charge = chargeFraction(c, this.held);
    const power = chargePower(c, charge);
    // the recoil grows with the square root of the power: a full charge kicks ~1.6× today's shot, a tap ~0.8×
    const k = Math.sqrt(power);
    this.fireGlow = this.glow ?? 0;
    this.mouth(d, _m);
    if (this.air) {
      // the skeleton is last step's: carry the muzzle on by one step of the body's velocity
      this.body!.velocity(_v);
      _m.addScaledVector(_v, this.dt);
      const dir = _d.subVectors(this.aimPoint, _m).normalize().clone();
      this.shots.push({ from: _m.clone(), dir, speed: boltSpeedFrom(c.boltSpeed, dir, _v, c.inherit), power, charge });
      this.body!.recoil?.(deg(c.airRecoilDeg) * k, c.airRecoilSpeed * k);
    } else {
      this.shots.push({ from: _m.clone(), dir: _d.subVectors(this.aimPoint, _m).normalize().clone(), power, charge });
      d.body.impulse(c.recoilDrop * k);
      this.skid = c.skidSpeed * k;
    }
    this.fired++;
    this.lastCharge = charge;
    this.lastPower = power;
    this.holding = false;
    d.look.headPitch.v += c.recoilKick * k;
    this.cool = chargeCooldown(c, charge);
    this.linger = c.lingerAggro;
    this.phase = 'recover';
    this.t = 0;
  }
}
