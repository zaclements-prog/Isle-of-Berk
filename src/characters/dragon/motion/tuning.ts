/** Every motion constant (spec §6.16). Defaults come from the spec; tuned presets live in motion-tuning.json. */
export interface MotionTuning {
  controller: {
    trotSpeed: number; prowlSpeed: number; gallopSpeed: number;
    accel: number; gallopAccel: number; brake: number;
    turnRateSlowDeg: number; turnRateFastDeg: number; slowTurnSpeed: number;
    inPlaceTurnRateDeg: number; inPlaceSpeed: number; turnGain: number; turnInPlaceAngleDeg: number;
  };
  gait: { hysteresis: number; blendTime: number; stopSpeed: number; turnStepRadius: number; maxCadence: number; strideFrac: number };
  planner: {
    raibertGain: number; castUp: number; castDown: number; maxSlopeDeg: number;
    edgeDrop: number; edgeProbe: number; candidateOffset: number;
    retargetHalfLife: number; freezeRetargetAt: number;
    forcedStepDist: number; forcedSwingTime: number; forcedLift: number;
    overstretch: number; clearance: number; minSwingTime: number; maxAirborne: number; maxStepUp: number; maxStepDown: number;
    reachFrac: number; sideLead: number; strainLookahead: number;
    /** Fraction of a leg's fore-aft envelope the Raibert lead may use (distinct from reachFrac, the 3D hip-reach limit). */
    leadEnvelopeFrac: number;
    /** Cap (s) on an over-stretch recovery swing while moving, so a stretched leg re-plants quickly. */
    overstretchSwingMax: number;
  };
  body: {
    heightOmega: number; tiltOmega: number; maxTiltDeg: number;
    crouchWalk: number; crouchTrot: number; crouchGallop: number;
    footfallImpulse: number; bobWalk: number; bobTrot: number; rockGallopDeg: number; flexGallopDeg: number;
    leanGain: number; maxLeanDeg: number; accelPitchDeg: number; maxAccelPitchDeg: number;
    bendGain: number; maxBendDeg: number; shortfallLower: number; terrainLookahead: number;
    /** Contacts with |normal.y| below this (steeper than ~50°) push the body sideways; flatter ones belong to the body solver. */
    wallNormalY: number;
    /** Lateral-bend share for spine_01, spine_02, spine_03, chest (should sum near 1). */
    bendShare: number[];
    /** Speed (m/s) at which a footfall impulse reaches full strength; it scales down toward footfallMinScale below this. */
    footfallFullSpeed: number;
    /** Minimum footfall-impulse scale at a standstill, ramping up to full strength at footfallFullSpeed. */
    footfallMinScale: number;
  };
  legs: { scapulaFollow: number; swingCurlDeg: number; maxReach: number; limitMarginDeg: number; envelopeDrop: number };
  look: {
    yawLimitDeg: number; pitchLimitDeg: number; headOmega: number; eyeOmega: number; eyeLimitDeg: number;
    leadGain: number; aheadDist: number; idleCameraDelay: number; glanceMin: number; glanceMax: number; glanceHold: number;
    weights: number[];
  };
  tail: {
    omegaBase: number; omegaTip: number; zeta: number; droopDeg: number; turnGain: number;
    latAccelGain: number; vertAccelGain: number; gallopRaiseDeg: number; clearance: number;
  };
  ears: { omega: number; zeta: number; twitchMin: number; twitchMax: number; twitchImpulse: number; gallopBackDeg: number };
  fins: { omega: number; zeta: number; flutterDeg: number; flutterHz: number };
  breath: { calmPerMin: number; exertedPerMin: number; recoverTime: number; amplitudeDeg: number };
  climb: {
    climbMinDeg: number; wallMinDeg: number; climbSpeed: number; scrambleSpeed: number; maxTiltDeg: number;
    cadenceScale: number; strideScale: number; swingScale: number; wingsOpen: number;
    ledgeMax: number; scrambleTime: number; dropMin: number; hopUpSpeed: number; probeAhead: number;
  };
  camera: {
    distance: number; minDistance: number; maxDistance: number; pitchDeg: number; minPitchDeg: number; maxPitchDeg: number;
    sensitivity: number; wheelScale: number; followOmega: number; lookAhead: number;
    recentreDelay: number; recentreOmega: number; climbPitchDeg: number; radius: number; easeOutOmega: number;
    fadeNear: number; fadeFar: number; chestHeight: number;
  };
}

export const DEFAULT_TUNING: MotionTuning = {
  controller: {
    trotSpeed: 3.2, prowlSpeed: 1.4, gallopSpeed: 10, accel: 5, gallopAccel: 8, brake: 12,
    turnRateSlowDeg: 200, turnRateFastDeg: 80, slowTurnSpeed: 1.5, inPlaceTurnRateDeg: 120, inPlaceSpeed: 0.3,
    turnGain: 6, turnInPlaceAngleDeg: 100,
  },
  gait: { hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05, turnStepRadius: 0.8, maxCadence: 3, strideFrac: 0.85 },
  planner: {
    raibertGain: 0.45, castUp: 0.8, castDown: 1.8, maxSlopeDeg: 75, edgeDrop: 0.15, edgeProbe: 0.1, candidateOffset: 0.12,
    retargetHalfLife: 0.04, freezeRetargetAt: 0.8, forcedStepDist: 0.2, forcedSwingTime: 0.28,
    forcedLift: 0.09, overstretch: 0.97, clearance: 0.05, minSwingTime: 0.12, maxAirborne: 2, maxStepUp: 0.6, maxStepDown: 1.0,
    reachFrac: 0.9, sideLead: 0.2, strainLookahead: 3, leadEnvelopeFrac: 0.9, overstretchSwingMax: 0.4,
  },
  body: {
    heightOmega: 14, tiltOmega: 10, maxTiltDeg: 35, crouchWalk: 0.03, crouchTrot: 0.09, crouchGallop: 0.16,
    footfallImpulse: 0.12, bobWalk: 0.012, bobTrot: 0.02, rockGallopDeg: 3, flexGallopDeg: 6,
    leanGain: 0.8, maxLeanDeg: 18, accelPitchDeg: 0.5, maxAccelPitchDeg: 6, bendGain: 0.25, maxBendDeg: 25, shortfallLower: 1,
    terrainLookahead: 0.15, wallNormalY: 0.64, bendShare: [0.2, 0.25, 0.3, 0.25], footfallFullSpeed: 5, footfallMinScale: 0.2,
  },
  legs: { scapulaFollow: 0.35, swingCurlDeg: 35, maxReach: 0.995, limitMarginDeg: 4, envelopeDrop: 0.09 },
  look: {
    yawLimitDeg: 100, pitchLimitDeg: 40, headOmega: 5, eyeOmega: 28, eyeLimitDeg: 25, leadGain: 0.35, aheadDist: 6,
    idleCameraDelay: 1.5, glanceMin: 3, glanceMax: 7, glanceHold: 1.2, weights: [0.12, 0.18, 0.22, 0.23, 0.25],
  },
  tail: {
    omegaBase: 14, omegaTip: 6, zeta: 0.45, droopDeg: 1.5, turnGain: 0.1, latAccelGain: 0.02, vertAccelGain: 0.015,
    gallopRaiseDeg: 2.5, clearance: 0.04,
  },
  ears: { omega: 16, zeta: 0.35, twitchMin: 1.5, twitchMax: 5, twitchImpulse: 5, gallopBackDeg: 25 },
  fins: { omega: 12, zeta: 0.4, flutterDeg: 3, flutterHz: 3 },
  breath: { calmPerMin: 12, exertedPerMin: 40, recoverTime: 20, amplitudeDeg: 0.8 },
  climb: {
    climbMinDeg: 45, wallMinDeg: 70, climbSpeed: 1.8, scrambleSpeed: 3, maxTiltDeg: 60, cadenceScale: 0.8, strideScale: 0.7,
    swingScale: 1.5, wingsOpen: 0.2, ledgeMax: 2.5, scrambleTime: 0.9, dropMin: 1.5, hopUpSpeed: 1.2, probeAhead: 1.2,
  },
  camera: {
    distance: 8, minDistance: 4, maxDistance: 18, pitchDeg: 18, minPitchDeg: -10, maxPitchDeg: 70, sensitivity: 0.0025,
    wheelScale: 0.0012, followOmega: 8, lookAhead: 0.25, recentreDelay: 2, recentreOmega: 1.5, climbPitchDeg: 15,
    radius: 0.3, easeOutOmega: 2, fadeNear: 0.5, fadeFar: 1.2, chestHeight: 1.25,
  },
};

export const TUNING_URL = 'assets/characters/toothless/motion-tuning.json';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends number[] ? number[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Two-level merge (section → field). Unknown sections/fields are ignored; arrays are replaced. */
export function mergeTuning(base: MotionTuning, patch: DeepPartial<MotionTuning> | undefined): MotionTuning {
  const out = structuredClone(base);
  if (!patch) return out;
  const sections = out as unknown as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(patch)) {
    const target = sections[section];
    if (!target || typeof values !== 'object' || values === null) continue;
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (k in target && v !== undefined) target[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return out;
}

export async function loadTuning(url = TUNING_URL): Promise<MotionTuning> {
  try {
    const r = await fetch(url);
    return mergeTuning(DEFAULT_TUNING, r.ok ? ((await r.json()) as DeepPartial<MotionTuning>) : undefined);
  } catch {
    return mergeTuning(DEFAULT_TUNING, undefined);
  }
}
