import { sampleCurve, type ActiveLayer } from '../motion/poseLayers';
import type { MotionTuning } from '../motion/tuning';
import { clamp, lerp, smoothstep } from '../motion/math';
import { stepSpring, type SpringState } from '../motion/springs';

export type Mood = 'calm' | 'curious' | 'excited' | 'tired' | 'aggressive';
/** Order of the per-mood tables in tuning.face (pupilByMood, earsByMood). */
export const MOODS: readonly Mood[] = ['calm', 'curious', 'excited', 'tired', 'aggressive'];

type FaceTuning = MotionTuning['face'];

/** What the face reads each step (DragonBrain fills it from the character and the behaviours). */
export interface FaceInput {
  /** 0…1 (secondary.exertion). */
  exertion: number;
  gallopWeight: number;
  /** Seconds without movement input. */
  idle: number;
  /** Watching an interest point. */
  interested: boolean;
  /** Charging or firing plasma. */
  aggressive: boolean;
  /** Head yaw speed (rad/s): large head turns blink. */
  headTurnRate: number;
  /** 0…1: how squarely the sun shines into his face (bright light narrows the pupils). */
  sunInFace: number;
  /** Eye rotation from the look controller (rad). */
  eyeYaw: number;
  eyePitch: number;
  /** 0…1: a content moment (the gummy smile), asked for by behaviours. */
  content: number;
  /** Wing fold 0…1 (drives the membrane pleat correctives). */
  wingFold: number;
}

/** Everything the expression binder writes to the asset (morphs, eye/skin uniforms) and the rig (jaw, ears). */
export interface FaceState {
  readonly mood: Record<Mood, number>;
  blinkL: number;
  blinkR: number;
  squint: number;
  smile: number;
  snarl: number;
  teethOut: number;
  nostrilFlare: number;
  /** 0 = closed … 1 = rig.jaw.maxOpenRad open. */
  jaw: number;
  /** 0 = slit … 1 = round. */
  pupil: number;
  eyeGlow: number;
  plasmaGlow: number;
  /** Ear attitude (deg): + lays them back/flat, − perks them forward. */
  earsDeg: number;
  gazeYaw: number;
  gazePitch: number;
  pleat: number;
}

export function createFaceInput(): FaceInput {
  return {
    exertion: 0, gallopWeight: 0, idle: 0, interested: false, aggressive: false, headTurnRate: 0, sunInFace: 0,
    eyeYaw: 0, eyePitch: 0, content: 0, wingFold: 1,
  };
}

/** Layer face curves: channels that take the strongest layer vs channels that blend toward the layer's value. */
const MAX_CHANNELS = ['jaw', 'blink', 'squint', 'smile', 'snarl', 'teeth_out', 'nostril_flare', 'plasmaGlow'] as const;
type MaxChannel = (typeof MAX_CHANNELS)[number];

/**
 * Face and mood (spec §6.12). Mood (calm, curious, excited, tired, aggressive) eases with springs from context; it
 * drives blinks (every 2–6 s, occasional doubles, on large head turns, heavier when tired), the pupils (slit when
 * aggressive or in bright light, round when curious or content), the ears (perked, neutral, flat when aggressive; the
 * gallop lay-back is SecondaryMotion's) and the gummy smile in content moments. Live pose layers add their face
 * curves (the yawn, the plasma charge, sleep's closed eyes). Seeded: the same seed gives the same blinks.
 */
export class FaceController {
  readonly state: FaceState = {
    mood: { calm: 1, curious: 0, excited: 0, tired: 0, aggressive: 0 },
    blinkL: 0, blinkR: 0, squint: 0, smile: 0, snarl: 0, teethOut: 0, nostrilFlare: 0, jaw: 0, pupil: 0.5, eyeGlow: 0.35,
    plasmaGlow: 0, earsDeg: 0, gazeYaw: 0, gazePitch: 0, pleat: 1,
  };
  /** Blinks started so far (tests, debug). */
  blinks = 0;
  private readonly moodS: Record<Mood, SpringState> = {
    calm: { x: 1, v: 0 }, curious: { x: 0, v: 0 }, excited: { x: 0, v: 0 }, tired: { x: 0, v: 0 }, aggressive: { x: 0, v: 0 },
  };
  private readonly pupilS: SpringState = { x: 0.5, v: 0 };
  private readonly earsS: SpringState = { x: 0, v: 0 };
  private readonly layerMax: Record<MaxChannel, number> = {
    jaw: 0, blink: 0, squint: 0, smile: 0, snarl: 0, teeth_out: 0, nostril_flare: 0, plasmaGlow: 0,
  };
  private blinkT = -1;
  private nextBlink: number;
  private sinceBlink = 10;
  private doublePending = false;
  private secondOfDouble = false;

  constructor(private readonly t: FaceTuning, private readonly rng: () => number) {
    this.nextBlink = lerp(t.blinkMin, t.blinkMax, rng());
  }

  update(inp: FaceInput, layers: ReadonlyArray<ActiveLayer>, dt: number): FaceState {
    const t = this.t;
    const st = this.state;
    // 1) mood: each eases toward its context target; calm is what the others leave
    const aggressive = inp.aggressive ? 1 : 0;
    const targets: Record<Mood, number> = {
      calm: 0,
      curious: inp.interested ? 1 : 0,
      excited: clamp(Math.max(inp.exertion * 1.6 - 0.3, inp.gallopWeight), 0, 1),
      tired: smoothstep(t.tiredFrom, t.tiredFull, inp.idle),
      aggressive,
    };
    for (const m of MOODS) {
      if (m === 'calm') continue;
      stepSpring(this.moodS[m], targets[m], m === 'aggressive' && aggressive ? t.moodOmega * 4 : t.moodOmega, 1, dt);
      st.mood[m] = clamp(this.moodS[m].x, 0, 1);
    }
    st.mood.calm = 1 - Math.max(st.mood.curious, st.mood.excited, st.mood.tired, st.mood.aggressive);
    // 2) live pose layers' face curves
    for (const c of MAX_CHANNELS) this.layerMax[c] = 0;
    let pupilW = 0;
    let pupilV = 0;
    let earsW = 0;
    let earsV = 0;
    for (const l of layers) {
      const face = l.meta.face;
      if (!face) continue;
      for (const c of MAX_CHANNELS) {
        const curve = face[c];
        if (curve) this.layerMax[c] = Math.max(this.layerMax[c], sampleCurve(curve, l.time) * l.weight);
      }
      if (face.pupil) {
        pupilW += l.weight;
        pupilV += l.weight * sampleCurve(face.pupil, l.time);
      }
      if (face.ears) {
        earsW += l.weight;
        earsV += l.weight * sampleCurve(face.ears, l.time);
      }
    }
    // 3) blinks: scheduled (2–6 s, sometimes double), on large head turns, slower and heavier when tired
    this.sinceBlink += dt;
    this.nextBlink -= dt;
    const turnBlink = Math.abs(inp.headTurnRate) > t.turnBlinkRate && this.sinceBlink > t.turnBlinkGap;
    if (this.blinkT < 0 && (this.nextBlink <= 0 || turnBlink)) this.startBlink();
    let blink = 0;
    if (this.blinkT >= 0) {
      const slow = 1 + st.mood.tired;
      const close = t.blinkClose * slow;
      const hold = t.blinkHold * slow;
      const open = t.blinkOpen * slow;
      const b = this.blinkT;
      blink = b < close ? b / close : b < close + hold ? 1 : 1 - (b - close - hold) / open;
      this.blinkT += dt;
      if (this.blinkT > close + hold + open) {
        this.blinkT = -1;
        blink = 0;
        if (this.doublePending) {
          this.doublePending = false;
          this.secondOfDouble = true;
          this.nextBlink = t.doubleGap;
        }
      }
    }
    const lid = Math.max(clamp(blink, 0, 1), t.tiredLid * st.mood.tired, this.layerMax.blink);
    st.blinkL = lid;
    st.blinkR = lid;
    // 4) expressions
    st.squint = Math.max(this.layerMax.squint, t.sunSquint * inp.sunInFace, 0.25 * st.mood.tired);
    st.smile = Math.max(this.layerMax.smile, t.contentSmile * inp.content);
    st.snarl = Math.max(this.layerMax.snarl, 0.35 * st.mood.aggressive);
    st.teethOut = this.layerMax.teeth_out;
    st.nostrilFlare = Math.max(this.layerMax.nostril_flare, 0.5 * inp.exertion);
    st.jaw = Math.max(this.layerMax.jaw, t.pantJaw * clamp(inp.exertion * 1.4 - 0.4, 0, 1));
    st.plasmaGlow = this.layerMax.plasmaGlow;
    st.eyeGlow = t.eyeGlow + t.eyeGlowAggressive * st.mood.aggressive;
    // pupils: the mood's size, narrowed by bright light; a layer's pupil target takes over by its weight
    let pupil = 0;
    let ears = 0;
    MOODS.forEach((m, k) => {
      pupil += st.mood[m] * t.pupilByMood[k];
      ears += st.mood[m] * t.earsByMood[k];
    });
    const wsum = MOODS.reduce((a, m) => a + st.mood[m], 0) || 1;
    pupil = pupil / wsum - t.sunNarrow * inp.sunInFace + t.contentPupil * inp.content;
    ears /= wsum;
    if (pupilW > 0) pupil = lerp(pupil, pupilV / pupilW, Math.min(1, pupilW));
    if (earsW > 0) ears = lerp(ears, earsV / earsW, Math.min(1, earsW));
    stepSpring(this.pupilS, clamp(pupil, 0, 1), t.pupilOmega, 1, dt);
    stepSpring(this.earsS, ears, t.earOmega, 1, dt);
    st.pupil = clamp(this.pupilS.x, 0, 1);
    st.earsDeg = this.earsS.x;
    st.gazeYaw = inp.eyeYaw;
    st.gazePitch = inp.eyePitch;
    st.pleat = smoothstep(0.5, 1, inp.wingFold);
    return st;
  }

  private startBlink(): void {
    this.blinkT = 0;
    this.sinceBlink = 0;
    this.blinks++;
    this.nextBlink = lerp(this.t.blinkMin, this.t.blinkMax, this.rng());
    if (this.secondOfDouble) {
      this.secondOfDouble = false;                 // the second blink of a double never doubles again
      return;
    }
    this.doublePending = this.rng() < this.t.doubleBlink;
  }
}
