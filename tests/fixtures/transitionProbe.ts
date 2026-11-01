import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { DEFAULT_TUNING, mergeTuning, type MotionTuning } from '../../src/characters/dragon/motion/tuning';
import { createToothlessBrain, type ToothlessBrain } from '../../src/characters/dragon/toothlessBrain';
import { CollisionWorld } from '../../src/world/collision';
import { loadToothlessMotion } from './toothlessAsset';
import { box } from './worlds';

/**
 * Transition probe: drives the real Toothless rig (rig.json + poses GLB, the game's motion-tuning.json) through scripted
 * input sequences at the game's 120 Hz and records, per step, the active state and every key bone's rotation
 * discontinuity: the angle (deg) between this step's rotation and the one extrapolated at constant angular velocity
 * from the two before (a second difference: smooth motion of any speed reads near 0, a one-step snap of θ reads θ, a
 * velocity kink reads its Δω·dt). Pelvis height and pitch get the same second difference (cm, deg). A pop is the peak
 * of those inside a window around a state change.
 */

export const DT = 1 / 120;

/** Bones probed: [label, bone, world rotation (else local)]. */
export const PROBE_BONES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['pelvis', 'pelvis', true],
  ['chest', 'chest', false],
  ['neck', 'neck_02', false],
  ['head', 'head', true],
  ['wingL', 'wing_humerus_L', false],
  ['wingR', 'wing_humerus_R', false],
  ['tail', 'tail_03', false],
  ['tailTip', 'tail_09', false],
];

export interface Step {
  keys?: string[];
  press?: string[];
  /** Camera yaw (rad, absolute) and pitch (rad, + looking down); default yaw 0, pitch 0.31 (level flight). */
  yaw?: number;
  pitch?: number;
}

export interface Sequence {
  name: string;
  seconds: number;
  /** Ground: 'flat' (a 3 km floor at y 0) or 'ledge' (a 6 m high platform for z < 4, floor beyond). */
  world?: 'flat' | 'ledge';
  spawn?: [number, number, number];
  plan(t: number): Step;
}

export interface Sample {
  t: number;
  state: string;
  /** Per PROBE_BONES: second-difference angle (deg). */
  d2: number[];
  /** Pelvis height (m), pitch (deg); their second differences (cm, deg). */
  y: number;
  pitch: number;
  d2y: number;
  d2p: number;
  speed: number;
  /** Deepest tail segment end below the ground under it (m, 0 when clear). */
  tailPen: number;
}

export interface Transition {
  t: number;
  from: string;
  to: string;
  /** Peak second differences in [t − pre, t + post]: per bone (deg), height (cm), pitch (deg). */
  bones: number[];
  dy: number;
  dp: number;
  /** Largest one-step change of the ground/path speed (m/s). */
  dv: number;
  /** max over the bones (deg). */
  peak: number;
  worstBone: string;
}

export interface ProbeResult {
  name: string;
  samples: Sample[];
  transitions: Transition[];
  /** Worst pop over the whole run (any time): bones max (deg), height (cm), pitch (deg). */
  peak: number;
  peakY: number;
  peakP: number;
  nanResets: number;
  /** Deepest tail penetration over the run (m). */
  tailPen: number;
  d: DragonCharacter;
  tb: ToothlessBrain;
}

const LEVEL = (18 * Math.PI) / 180;
const at = (t: number, s: number) => Math.abs(t - s) < DT / 2;
export const press = (t: number, s: number, code = 'Space'): string[] => (at(t, s) ? [code] : []);

let gameTuning: MotionTuning | null = null;
/** DEFAULT_TUNING under the game's public motion-tuning.json (what the browser loads). */
export function loadGameTuning(): MotionTuning {
  gameTuning ??= mergeTuning(DEFAULT_TUNING, JSON.parse(readFileSync('public/assets/characters/toothless/motion-tuning.json', 'utf8')));
  return gameTuning;
}

function world(kind: Sequence['world']): CollisionWorld {
  if (kind === 'ledge') return CollisionWorld.fromObjects([box(60, 6, 60, 0, 3, -26), box(400, 1, 400, 0, -0.5, 0)]);
  return CollisionWorld.fromObjects([box(3000, 1, 3000, 0, -0.5, 0)]);
}

function input(s: Step): InputState {
  return { keys: new Set(s.keys ?? []), pressed: new Set(s.press ?? []), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
}

/** The state label: flight phase (air split into flap / glide / dive), else jump phase, else the gait (or idle). */
export function stateOf(d: DragonCharacter, tb: ToothlessBrain): string {
  const f = tb.flight;
  if (f.phase !== 'idle') {
    if (f.phase === 'air') return f.tuckW > 0.5 ? 'dive' : f.glideW > 0.5 ? 'glide' : 'flap';
    return f.phase;
  }
  if (tb.jump.phase !== 'idle') return `jump-${tb.jump.phase}`;
  if (d.climb.mode !== 'ground') return d.climb.mode;
  return d.kin.speed < 0.15 ? 'idle' : d.gait.name;
}

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();

/** Angle (deg) between q2 and q1·(q0⁻¹·q1)-style extrapolation (constant angular velocity), world or local frame. */
function d2Angle(q0: THREE.Quaternion, q1: THREE.Quaternion, q2: THREE.Quaternion): number {
  // step rotation r = q1 · q0⁻¹ (world-frame delta), prediction p = r · q1
  _r.copy(q0).invert().premultiply(q1);
  _q.copy(q1).premultiply(_r);
  const dot = Math.min(1, Math.abs(_q.dot(q2)));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

export async function runSequence(seq: Sequence, opts: { pre?: number; post?: number; tuning?: MotionTuning; onSpawn?: (d: DragonCharacter) => void } = {}): Promise<ProbeResult> {
  const a = await loadToothlessMotion();
  const w = world(seq.world);
  const d = new DragonCharacter({ rig: a.rig, world: w, tuning: opts.tuning ?? loadGameTuning(), clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
  const [sx, sz, sh] = seq.spawn ?? [0, 0, 0];
  d.spawn(sx, sz, sh);
  const tb = createToothlessBrain(d, a.rig, {});
  opts.onSpawn?.(d);
  const s = d.skeleton;
  const ids = PROBE_BONES.map(([, b]) => s.id(b));
  const hist: THREE.Quaternion[][] = ids.map(() => [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]);
  const yh = [0, 0, 0];
  const ph = [0, 0, 0];
  const samples: Sample[] = [];
  const cam = new THREE.Vector3();
  const tailIds = a.rig.chains.tail.map((n) => s.id(n));
  const tip = new THREE.Vector3();
  const n = Math.round(seq.seconds / DT);
  for (let k = 0; k < n; k++) {
    const t = k * DT;
    const st = seq.plan(t);
    const yaw = st.yaw ?? 0;
    // the camera behind him along its yaw, a little above (the look and the glance read it)
    cam.set(d.kin.pos.x - Math.sin(yaw) * 8, d.kin.pos.y + 3, d.kin.pos.z - Math.cos(yaw) * 8);
    d.update({ input: input(st), cameraYaw: yaw, cameraPitch: st.pitch ?? LEVEL, cameraPos: cam }, DT);
    const d2: number[] = [];
    ids.forEach((b, i) => {
      const h = hist[i];
      h.push(h.shift()!.copy(PROBE_BONES[i][2] ? s.worldQuat[b] : s.localQuat[b]));
      d2.push(k >= 2 ? d2Angle(h[0], h[1], h[2]) : 0);
    });
    yh.shift();
    yh.push(d.body.pose.pelvisPos.y);
    ph.shift();
    ph.push((d.body.pose.pitch * 180) / Math.PI);
    samples.push({
      t, state: stateOf(d, tb), d2, y: yh[2], pitch: ph[2],
      d2y: k >= 2 ? Math.abs(yh[2] - 2 * yh[1] + yh[0]) * 100 : 0,
      d2p: k >= 2 ? Math.abs(ph[2] - 2 * ph[1] + ph[0]) : 0,
      speed: d.kin.speed,
      tailPen: tailIds.reduce((m, b) => {
        s.tail(b, tip);
        const g = w.groundAt(tip.x, tip.z, tip.y + 1.5, 4);
        return g ? Math.max(m, g.point.y - tip.y) : m;
      }, 0),
    });
  }
  const pre = opts.pre ?? 0.05;
  const post = opts.post ?? 0.5;
  const transitions: Transition[] = [];
  for (let k = 1; k < samples.length; k++) {
    if (samples[k].state === samples[k - 1].state) continue;
    const t0 = samples[k].t;
    const tr: Transition = { t: t0, from: samples[k - 1].state, to: samples[k].state, bones: ids.map(() => 0), dy: 0, dp: 0, dv: 0, peak: 0, worstBone: '' };
    for (let j = 1; j < samples.length; j++) {
      const sm = samples[j];
      if (sm.t < t0 - pre || sm.t > t0 + post || sm.t < 3 * DT) continue;
      tr.dv = Math.max(tr.dv, Math.abs(sm.speed - samples[j - 1].speed));
    }
    for (const sm of samples) {
      if (sm.t < t0 - pre || sm.t > t0 + post || sm.t < 3 * DT) continue;
      sm.d2.forEach((v, i) => { tr.bones[i] = Math.max(tr.bones[i], v); });
      tr.dy = Math.max(tr.dy, sm.d2y);
      tr.dp = Math.max(tr.dp, sm.d2p);
    }
    tr.peak = Math.max(...tr.bones);
    tr.worstBone = PROBE_BONES[tr.bones.indexOf(tr.peak)][0];
    transitions.push(tr);
  }
  const live = samples.filter((sm) => sm.t >= 3 * DT);
  return {
    name: seq.name, samples, transitions,
    peak: Math.max(...live.map((sm) => Math.max(...sm.d2))),
    peakY: Math.max(...live.map((sm) => sm.d2y)),
    peakP: Math.max(...live.map((sm) => sm.d2p)),
    nanResets: d.nanResets, tailPen: Math.max(...samples.map((sm) => sm.tailPen)), d, tb,
  };
}

const W = ['KeyW'];
const RUN = ['KeyW', 'ShiftLeft'];

/** The probe's scripted sequences (spec of the transition audit). */
export const SEQUENCES: Sequence[] = [
  {
    name: 'idle-walk-run-stop', seconds: 9,
    plan: (t) => ({ keys: t < 1 ? [] : t < 3.5 ? ['KeyW'] : t < 6.5 ? RUN : [] }),
  },
  {
    name: 'trot-jump-land-trot', seconds: 5,
    plan: (t) => ({ keys: t < 0.5 ? [] : W, press: press(t, 2) }),
  },
  {
    name: 'stand-jump-land', seconds: 4,
    plan: (t) => ({ keys: [], press: press(t, 1.5) }),
  },
  {
    name: 'gallop-takeoff-flight', seconds: 7,
    plan: (t) => ({ keys: t < 4 ? RUN : W, press: press(t, 3) }),
  },
  {
    name: 'stand-takeoff-hover', seconds: 6,
    plan: (t) => ({ keys: t >= 1 && t < 1.6 ? ['Space'] : [], press: press(t, 1) }),
  },
  {
    name: 'flap-glide-dive-pullup', seconds: 22,
    plan: (t) => {
      const keys = t < 1 ? [] : t < 1.6 ? ['Space'] : t < 9 ? W : t < 12 ? [] : t < 15 ? ['ShiftLeft'] : t < 18 ? [] : W;
      const pitch = t < 9 ? (-10 * Math.PI) / 180 : t < 12 ? LEVEL : t < 15 ? (70 * Math.PI) / 180 : t < 18 ? -0.3 : LEVEL;
      return { keys, press: press(t, 1), pitch };
    },
  },
  {
    name: 'fast-flight-runland-runout', seconds: 16,
    plan: (t) => ({ keys: t < 4 ? RUN : t < 9 ? W : t < 10 ? [] : W, press: [...press(t, 3), ...press(t, 9.5)] }),
  },
  {
    name: 'fast-flight-runland-stop', seconds: 16,
    plan: (t) => ({ keys: t < 4 ? RUN : t < 9 ? W : [], press: [...press(t, 3), ...press(t, 9.5)] }),
  },
  {
    name: 'slow-flight-standland', seconds: 18,
    plan: (t) => ({ keys: t >= 1 && t < 1.6 ? ['Space'] : t > 5 && t < 8 ? W : t > 10 && t < 12.5 ? ['KeyS'] : [], press: [...press(t, 1), ...press(t, 12.5)] }),
  },
  {
    name: 'ledge-jump-high-fall', seconds: 6, world: 'ledge', spawn: [0, -0.5, 0],
    plan: (t) => ({ keys: t > 0.5 && t < 2.2 ? W : [], press: press(t, 1.6) }),
  },
  {
    name: 'quick-rejump', seconds: 6,
    plan: (t) => ({ keys: t < 0.5 ? [] : W, press: [...press(t, 1.5), ...press(t, 2.9), ...press(t, 3.0), ...press(t, 3.1)] }),
  },
  {
    name: 'gallop-sharp-turns', seconds: 8,
    plan: (t) => ({ keys: t < 7 ? RUN : [], yaw: t < 2.5 ? 0 : t < 4.5 ? Math.PI / 2 : t < 6 ? -Math.PI / 2 : -Math.PI / 2 }),
  },
  {
    name: 'trot-reverse', seconds: 6,
    plan: (t) => ({ keys: t < 5 ? W : [], yaw: t < 2.5 ? 0 : Math.PI }),
  },
];
