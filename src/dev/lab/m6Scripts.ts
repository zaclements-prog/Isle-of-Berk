import * as THREE from 'three';
import type { InputEvent } from '../../core/input';
import { createToothlessBrain, type ToothlessBrain } from '../../characters/dragon/toothlessBrain';
import type { MetricsReport } from '../../characters/dragon/motion/metrics';
import { runLabScript, type LabRunOptions } from './labRunner';
import type { LabScript } from './scripts';

/** An M6 lab script: Plan 3's LabScript plus forced behaviours and a plasma aim point. */
export interface M6LabScript extends LabScript {
  /** berk.behaviour(name) at time t. */
  behaviours?: Array<{ t: number; name: string }>;
  /** World point the plasma aims at (the game: the camera's aim ray). */
  aim?: [number, number, number];
  /** false: the selector stays quiet, only `behaviours` play (repeatable cycles). */
  autonomous?: boolean;
}

const hold = (keys: string[], from: number, to: number): InputEvent[] => [{ t: from, down: keys }, { t: to, up: keys }];
const tap = (key: string, at: number): InputEvent[] => [{ t: at, down: [key] }, { t: at + 0.05, up: [key] }];
const PI = Math.PI;

/** Force a behaviour, let it play, interrupt it with W, walk off (each < 30 s: boundedness belongs to idle-cycle). */
function behaviourRun(name: string, playFor: number): M6LabScript {
  const w = 0.5 + playFor;
  return {
    name: `behaviour-${name}`, description: `${name}: forced, interrupted by W at ${w.toFixed(1)} s, walks off`,
    spawn: { x: 0, z: 0, heading: 0 }, duration: w + 4, events: hold(['KeyW'], w, w + 2), behaviours: [{ t: 0.5, name }],
  };
}

/** One 24 s cycle: sit, lie down, curl up asleep, get up (W), shake off; run 58 s so the last 10 s repeat the first. */
function idleCycle(): M6LabScript {
  const events: InputEvent[] = [];
  const behaviours: Array<{ t: number; name: string }> = [];
  for (let c = 0; c < 3; c++) {
    const o = 24 * c;
    behaviours.push({ t: o + 1, name: 'sit' }, { t: o + 4, name: 'scratch' }, { t: o + 8, name: 'lie' }, { t: o + 11, name: 'sleep' }, { t: o + 20, name: 'shake' });
    events.push(...hold(['KeyW'], o + 16, o + 16.4));
  }
  return {
    name: 'idle-cycle-58s', description: 'three 24 s idle cycles: sit, scratch, lie, sleep, W, shake — the behaviours\' spin-bug check',
    spawn: { x: 0, z: 0, heading: 0 }, duration: 58, events, behaviours, autonomous: false,
  };
}

/** Spec §8.2 lab checks for M6 (§9: idles and actions pass lab checks). Course coordinates: Plan 1's buildCourse. */
export const M6_SCRIPTS: M6LabScript[] = [
  behaviourRun('sit', 6), behaviourRun('lie', 7), behaviourRun('sleep', 9), behaviourRun('stretch', 3), behaviourRun('sniff', 3),
  behaviourRun('scratch', 5), behaviourRun('shake', 2), behaviourRun('yawn', 3), behaviourRun('look_around', 3),
  behaviourRun('glance_camera', 2),
  {
    name: 'idle-free-28s', description: 'no input: the selector idles freely (small behaviours, then sits)',
    spawn: { x: 0, z: 0, heading: 0 }, duration: 28, events: [],
  },
  idleCycle(),
  { name: 'jump-standing', description: 'Space from a stand', spawn: { x: 0, z: 0, heading: 0 }, duration: 4, events: tap('Space', 0.5) },
  { name: 'jump-trot', description: 'trot, leap, keep trotting', spawn: { x: 0, z: -6, heading: 0 }, duration: 6, events: [...hold(['KeyW'], 0.1, 5), ...tap('Space', 2.5)] },
  {
    name: 'jump-off-ledge', description: 'leap off the 2 m ledge onto the pad', spawn: { x: 24, z: 9.5, heading: PI }, duration: 5,
    events: [...hold(['KeyW'], 0.1, 1), ...tap('Space', 0.6)],
  },
  { name: 'plasma-wall', description: 'fire at the climb wall', spawn: { x: 0, z: 18, heading: 0 }, duration: 3, events: tap('KeyF', 0.5), aim: [1, 1.2, 29.5] },
  { name: 'plasma-turn', description: 'aim behind him: turn, then fire', spawn: { x: 0, z: 18, heading: PI }, duration: 4, events: tap('KeyF', 0.5), aim: [0, 1.2, 29.5] },
];

export function m6ScriptByName(name: string): M6LabScript {
  const s = M6_SCRIPTS.find((x) => x.name === name);
  if (!s) throw new Error(`unknown M6 lab script '${name}' (have: ${M6_SCRIPTS.map((x) => x.name).join(', ')})`);
  return s;
}

/** runLabScript with Toothless's brain attached, the script's behaviours forced on time and its plasma aim. */
export function runM6Script(o: Omit<LabRunOptions, 'script' | 'setup'> & { script: M6LabScript; onBrain?: (b: ToothlessBrain) => void }): MetricsReport {
  const aim = new THREE.Vector3(...(o.script.aim ?? [0, 1.5, 1e4]));
  let tb: ToothlessBrain | null = null;
  const queue = [...(o.script.behaviours ?? [])].sort((a, b) => a.t - b.t);
  return runLabScript({
    ...o,
    setup: (d) => {
      tb = createToothlessBrain(d, o.rig, { seed: 1, aimAt: (_d, out) => out.copy(aim) });
      tb.brain.behaviours.autonomous = o.script.autonomous ?? true;
      o.onBrain?.(tb);
    },
    onStep: (d, t) => {
      while (queue.length && queue[0].t <= t + 1e-9) tb!.brain.behaviour(queue.shift()!.name);
      o.onStep?.(d, t);
    },
  });
}
