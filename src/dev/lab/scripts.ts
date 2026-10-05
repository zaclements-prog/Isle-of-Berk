import type { InputEvent } from '../../core/input';
import { DEFAULT_TUNING } from '../../characters/dragon/motion/tuning';

/**
 * What a script must achieve, so a dragon that stands still (perfect metrics) cannot pass it. Checked by
 * runLabScript and reported as failures: `minEndY` / `maxEndY` final ground height ≥ / ≤ (onto a plateau or ledge /
 * down to a lower level), `maxY` height never above (did not climb what blocks him), `minTravel` final horizontal
 * distance from the spawn ≥ (m).
 */
export interface LabGoal {
  minEndY?: number;
  /** Final ground height ≤ (down onto a lower level). */
  maxEndY?: number;
  maxY?: number;
  minTravel?: number;
}

export interface LabScript {
  name: string;
  description: string;
  spawn: { x: number; z: number; heading: number };
  duration: number;
  events: InputEvent[];
  /** Constant camera orbit rate (rad/s), fed as mouse input (so the camera does not auto-recentre). */
  cameraYawRate?: number;
  goal?: LabGoal;
}

const hold = (keys: string[], from: number, to: number): InputEvent[] => [{ t: from, down: keys }, { t: to, up: keys }];
const prowl = (at = 0): InputEvent[] => [{ t: at, down: ['KeyC'] }, { t: at + 0.05, up: ['KeyC'] }];
/** Mouse pixels that turn the camera by `rad` (camera yaw −= dx · sensitivity). */
const turnPx = (rad: number) => -rad / DEFAULT_TUNING.camera.sensitivity;
const PI = Math.PI;

export const LAB_SCRIPTS: LabScript[] = [
  { name: 'walk-straight', description: 'prowl walk across the pad', spawn: { x: 0, z: 0, heading: 0 }, duration: 10, events: [...prowl(), ...hold(['KeyW'], 0.1, 8)], goal: { minTravel: 8 } },
  { name: 'trot-straight', description: 'default trot', spawn: { x: 0, z: 0, heading: 0 }, duration: 8, events: hold(['KeyW'], 0.1, 6), goal: { minTravel: 14 } },
  { name: 'gallop-straight', description: 'Shift gallop toward −Z (clear lane at x = 0)', spawn: { x: 0, z: 0, heading: PI }, duration: 6, events: hold(['KeyW', 'ShiftLeft'], 0.1, 4), goal: { minTravel: 30 } },
  { name: 'trot-circle', description: 'trot on an 8 m circle', spawn: { x: -8, z: 10, heading: 0 }, duration: 20, events: hold(['KeyW'], 0.1, 20), cameraYawRate: 0.4 },
  ...[15, 30, 45, 60].map((a, i): LabScript => {
    // spawn 6 m before the ramp foot; stop mid-plateau (it ends in a drop of the ramp's full rise). From 45° he climbs
    // (a 45° face measures a hair over 45° in floating point) at climb speed, and slows to it ~2 m before the foot,
    // where the face first meets his head.
    const run = 8 * Math.cos((a * PI) / 180);
    const climb = a >= DEFAULT_TUNING.climb.climbMinDeg;
    const rampSpeed = climb ? DEFAULT_TUNING.climb.climbSpeed : DEFAULT_TUNING.controller.trotSpeed;
    const walk = 0.7 + 6 / DEFAULT_TUNING.controller.trotSpeed + run / rampSpeed + 2.5 / DEFAULT_TUNING.controller.trotSpeed + (climb ? 0.6 : 0);
    return {
      name: `ramp${a}`, description: `up the ${a}° ramp onto its plateau`, spawn: { x: -40 + i * 8, z: -8, heading: PI },
      duration: walk + 1.5, events: hold(['KeyW'], 0.1, 0.1 + walk), goal: { minEndY: 8 * Math.sin((a * PI) / 180) - 0.1 },
    };
  }),
  { name: 'side-slope', description: 'along the 20° side slope (body roll)', spawn: { x: -21, z: 13, heading: 0 }, duration: 4, events: hold(['KeyW'], 0.1, 3), goal: { minTravel: 6, minEndY: 1 } },
  { name: 'steps-small', description: 'prowl up the 0.25 m steps', spawn: { x: 9, z: -10, heading: PI / 2 }, duration: 7, events: [...prowl(), ...hold(['KeyW'], 0.1, 6)], goal: { minEndY: 1 } },
  { name: 'steps-large', description: 'prowl up the 0.5 m steps', spawn: { x: 9, z: -2, heading: PI / 2 }, duration: 6, events: [...prowl(), ...hold(['KeyW'], 0.1, 5)], goal: { minEndY: 1 } },
  { name: 'ledge-scramble', description: 'scramble up the 2.3 m climb wall', spawn: { x: 0, z: 22, heading: 0 }, duration: 6, events: hold(['KeyW'], 0.1, 5), goal: { minEndY: 2.2 } },
  { name: 'ledge-blocked', description: 'walk into the 3 m ledge: blocked', spawn: { x: 40, z: 0, heading: 0 }, duration: 5, events: hold(['KeyW'], 0.1, 4), goal: { maxY: 0.3 } },
  { name: 'boulders', description: 'trot through the boulder field', spawn: { x: 26, z: 20, heading: PI / 4 }, duration: 9, events: hold(['KeyW'], 0.1, 8), goal: { minTravel: 5 } },
  { name: 'corners', description: 'into the inside corner, then around the pillar', spawn: { x: -27, z: 22, heading: Math.atan2(-6, 7) }, duration: 6, events: hold(['KeyW'], 0.1, 5) },
  // the way down: off a ledge, down a ramp, down stairs
  { name: 'drop-hop', description: 'walk off the 2 m ledge: hop down', spawn: { x: 24, z: 9.5, heading: PI }, duration: 4, events: hold(['KeyW'], 0.1, 3), goal: { maxEndY: 0.1, minTravel: 6 } },
  { name: 'down-ramp30', description: 'from its plateau down the 30° ramp', spawn: { x: -32, z: -24.5, heading: 0 }, duration: 5.5, events: hold(['KeyW'], 0.1, 4.5), goal: { maxEndY: 0.1, minTravel: 10 } },
  { name: 'down-steps-small', description: 'prowl down the 0.25 m steps', spawn: { x: 18.7, z: -10, heading: -PI / 2 }, duration: 6.5, events: [...prowl(), ...hold(['KeyW'], 0.1, 5.5)], goal: { maxEndY: 0.1, minTravel: 5 } },
  {
    name: 'idle-turn-60s', description: '60 s of standing, turning on the spot and short walks', spawn: { x: 0, z: 0, heading: 0 }, duration: 60,
    events: Array.from({ length: 12 }, (_, k): InputEvent[] => [{ t: 5 * k + 1, mouse: [turnPx(PI), 0], down: ['KeyW'] }, { t: 5 * k + 2.5, up: ['KeyW'] }]).flat(),
  },
];

export function scriptByName(name: string): LabScript {
  const s = LAB_SCRIPTS.find((x) => x.name === name);
  if (!s) throw new Error(`unknown lab script '${name}' (have: ${LAB_SCRIPTS.map((x) => x.name).join(', ')})`);
  return s;
}
