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
    /** Samples along a swing path when sizing its lift to clear the ground (risers between samples are bisected). */
    swingProbes: number;
    /** Cap (m) on a swing's peak lift. */
    maxLift: number;
    /** How fast (m/s) a swing's lift may grow mid-swing when its foothold moves (a late change must not pop the paw). */
    liftRate: number;
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
    /** Speed (m/s) at which the gait crouch and bob reach full strength; they fade in below it. */
    crouchFullSpeed: number;
    /**
     * Share (0–1) of the side-slope roll of the supports the body follows. A real animal keeps its body flatter than a
     * side slope and reaches down with its downhill legs.
     */
    rollFollow: number;
    /** Half-life (s) of the gait crouch's release as he slows: he rises back to standing height gradually. */
    crouchRelease: number;
    /** Extra radius (m) the body proxies keep clear of walls, for the pose changes a step's slide cannot predict. */
    proxySkin: number;
    /** 0–1: ride on the paws' supports (0) or the terrain under the hips and shoulders (1); never below the terrain. */
    terrainFollow: number;
    /** Spacing (m) of the three terrain probes along his heading under the hips and shoulders (stairs read as ramps). */
    terrainSpan: number;
    /** Share of a leg's reach a swing may land at (from the joint at touchdown) before the body lowers for it. */
    landingReach: number;
    /**
     * Terrain further than this (m) below the paws is the far side of a drop, never ridden down to. Deeper than the
     * fall of a stride on a descending ramp (he rides the ramp ahead of his trailing paws).
     */
    terrainDrop: number;
  };
  legs: { scapulaFollow: number; swingCurlDeg: number; maxReach: number; limitMarginDeg: number; envelopeDrop: number };
  look: {
    yawLimitDeg: number; pitchLimitDeg: number; headOmega: number; eyeOmega: number; eyeLimitDeg: number;
    leadGain: number; aheadDist: number; idleCameraDelay: number; glanceMin: number; glanceMax: number; glanceHold: number;
    weights: number[];
    /** Distance (m) of the idle-glance look target from the head. */
    glanceDist: number;
    /** Half-range (deg) of a random idle glance's yaw, sampled uniformly in ±this. */
    glanceYawRangeDeg: number;
    /** Half-range (deg) of a random idle glance's pitch, sampled uniformly in ±this. */
    glancePitchRangeDeg: number;
    /** Speed (m/s) above which the head looks along the travel direction; slower, he counts as idle (glances, camera). */
    travelSpeed: number;
  };
  tail: {
    omegaBase: number; omegaTip: number; zeta: number; droopDeg: number; turnGain: number;
    latAccelGain: number; vertAccelGain: number; gallopRaiseDeg: number; clearance: number;
    /** Fallback tail radius (m) used only if the rig defines no tail proxies. */
    defaultRadius: number;
    /** Half-life (s) of the smoothing on the pelvis vertical acceleration that lags the tail (vertAccelGain). */
    vertAccelHalfLife: number;
  };
  ears: { omega: number; zeta: number; twitchMin: number; twitchMax: number; twitchImpulse: number; gallopBackDeg: number };
  fins: {
    omega: number; zeta: number; flutterDeg: number; flutterHz: number;
    /** Phase offset (rad) between successive fin ribs' flutter, for a travelling-wave look. */
    phaseStep: number;
    /** Speed (m/s) at which fin flutter reaches full amplitude; it ramps in below this. */
    flutterFullSpeed: number;
    /** Seconds between random fin/hip-wing twitches (spec §6.9); the next one is scheduled uniformly in [twitchMin, twitchMax). */
    twitchMin: number;
    twitchMax: number;
    /** Velocity impulse (rad/s) applied to one randomly chosen fin/hip-wing spring at each twitch. */
    twitchImpulse: number;
  };
  breath: {
    calmPerMin: number; exertedPerMin: number; recoverTime: number; amplitudeDeg: number;
    /** Speed (m/s) at which exertion (and breath rate) reaches its maximum, absent an explicit `exertion` input. */
    exertionFullSpeed: number;
  };
  climb: {
    climbMinDeg: number; wallMinDeg: number; climbSpeed: number; scrambleSpeed: number; maxTiltDeg: number;
    cadenceScale: number; strideScale: number; swingScale: number; wingsOpen: number;
    /**
     * dropMin: he hops down drops deeper than this (m). At most planner.maxStepDown, or deeper drops strand his paws;
     * no deeper than a step up, or walking down one his forepaws' swing and his chest catch the edge.
     * hopUpSpeed: a hop's least upward launch speed (m/s); it leaps higher when the hind paws need it to clear the edge.
     */
    ledgeMax: number; scrambleTime: number; dropMin: number; hopUpSpeed: number; probeAhead: number;
    /** How far ahead of the forepaws (m) the ground is probed for a drop: he hops down once they reach the edge. */
    dropAhead: number;
    /** How far past the edge (m) the rearmost paws land when he hops down. */
    hopClear: number;
    /** How far past the lip (m) a scramble-up lands his body origin on the ledge top. */
    scrambleLand: number;
    /** A ledge top must be flat to within this (m) under all four landing paws to be scrambled onto. */
    topFlatness: number;
    /** Half-life (s) of climb mode's settings easing in on a climbable slope and out off it. */
    blendTime: number;
    /** The highest drop (m) he hops down; at a deeper one he stops at the edge. */
    dropMax: number;
    /** How far past the lip (m) the forepaws grip the top in a scramble. */
    scrambleGrip: number;
    /** The body's tilt springs while climbing (rad/s; body.tiltOmega otherwise): cresting a face it pitches 60° in a stride. */
    tiltOmega: number;
    /** A hop's least forward speed (m/s): he leaps clear of the edge, however slowly he walked up to it. */
    hopSpeed: number;
    /** A hop's greatest forward speed (m/s): he leaps further, up to this, to land all four paws beyond a gap. */
    hopSpeedMax: number;
    /** How far (m) the hind paws draw up toward the body in a hop's flight, to pass over the edge. */
    hopTuck: number;
    /** Time (s) the paws take to gather from the take-off stance into the flight pose. */
    hopGather: number;
    /** Time (s) before touchdown the paws reach down for their landing spots. */
    hopReach: number;
    /** Nose-down pitch (deg) at the middle of a hop. */
    hopPitchDeg: number;
  };
  /** The scramble-up's choreography: times are fractions of climb.scrambleTime, distances (m) relative to the lip. */
  scramble: {
    /** Hook pose: shoulders this far in front of the face and above the lip; pitch capped. */
    hookBack: number; hookUp: number; maxPitchDeg: number;
    /** The forepaws hook the lip here; the body rises this much mid-leap; the pitch is reached by this share of it. */
    leapEnd: number; leapUp: number; pitchLead: number;
    /** The pull-up ends here; the hind paws land on the top here. */
    pullEnd: number; hindLand: number;
    /** Pull-up path: rises this share of the way up first, edging this far in; reaches the over pose from this far back. */
    pullRise: number; pullAhead: number; overReach: number; pullPitchDeg: number; overPitchLeadDeg: number;
    /** Over the lip: the pelvis this far behind the face and above the top, at this pitch. */
    overBack: number; overUp: number; overPitchDeg: number;
    /**
     * The forepaws step on to the top under the shoulders over [foreStep1, foreStep1End], then on to their stance over
     * [foreStep2, stepEnd], with this lift.
     */
    foreStep1: number; foreStep1End: number; foreStep2: number; stepEnd: number; stepLift: number;
    /** Paths keep this far in front of the face and above the lip. */
    clear: number;
    /**
     * Paw paths, in swing progress: up to the peak and in to the face by rise, over the lip until cross, down on to the
     * spot from drop. Forepaws (fore*) and hind paws (hind*).
     */
    foreRise: number; foreCross: number; foreDrop: number; hindRise: number; hindCross: number; hindDrop: number;
  };
  camera: {
    distance: number; minDistance: number; maxDistance: number; pitchDeg: number; minPitchDeg: number; maxPitchDeg: number;
    sensitivity: number; wheelScale: number; followOmega: number; lookAhead: number;
    recentreDelay: number; recentreOmega: number; climbPitchDeg: number; radius: number; easeOutOmega: number;
    fadeNear: number; fadeFar: number; chestHeight: number;
    /** Natural frequency (rad/s) of the critically damped spring that raises the pitch while he climbs. */
    climbPitchOmega: number;
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
    forcedLift: 0.09, overstretch: 0.97, clearance: 0.05, minSwingTime: 0.12, maxAirborne: 2, maxStepUp: 0.6, maxStepDown: 0.6,
    reachFrac: 0.9, sideLead: 0.2, strainLookahead: 3, leadEnvelopeFrac: 0.9, overstretchSwingMax: 0.4,
    swingProbes: 12, maxLift: 0.6, liftRate: 4,
  },
  body: {
    heightOmega: 14, tiltOmega: 10, maxTiltDeg: 35, crouchWalk: 0.03, crouchTrot: 0.09, crouchGallop: 0.16,
    footfallImpulse: 0.12, bobWalk: 0.012, bobTrot: 0.02, rockGallopDeg: 3, flexGallopDeg: 6,
    leanGain: 0.8, maxLeanDeg: 18, accelPitchDeg: 0.5, maxAccelPitchDeg: 6, bendGain: 0.25, maxBendDeg: 25, shortfallLower: 1,
    terrainLookahead: 0.15, wallNormalY: 0.64, bendShare: [0.2, 0.25, 0.3, 0.25], footfallFullSpeed: 5, footfallMinScale: 0.2,
    crouchFullSpeed: 1, rollFollow: 1, crouchRelease: 0.3, proxySkin: 0.04, terrainFollow: 1, terrainSpan: 0.4, landingReach: 0.95, terrainDrop: 1.0,
  },
  legs: { scapulaFollow: 0.35, swingCurlDeg: 35, maxReach: 0.995, limitMarginDeg: 4, envelopeDrop: 0.09 },
  look: {
    yawLimitDeg: 100, pitchLimitDeg: 40, headOmega: 5, eyeOmega: 28, eyeLimitDeg: 25, leadGain: 0.35, aheadDist: 6,
    idleCameraDelay: 1.5, glanceMin: 3, glanceMax: 7, glanceHold: 1.2, weights: [0.12, 0.18, 0.22, 0.23, 0.25],
    glanceDist: 5, glanceYawRangeDeg: 60, glancePitchRangeDeg: 15, travelSpeed: 0.2,
  },
  tail: {
    omegaBase: 14, omegaTip: 6, zeta: 0.45, droopDeg: 1.5, turnGain: 0.1, latAccelGain: 0.02, vertAccelGain: 0.015,
    gallopRaiseDeg: 2.5, clearance: 0.04, defaultRadius: 0.05, vertAccelHalfLife: 0.05,
  },
  ears: { omega: 16, zeta: 0.35, twitchMin: 1.5, twitchMax: 5, twitchImpulse: 5, gallopBackDeg: 25 },
  fins: { omega: 12, zeta: 0.4, flutterDeg: 3, flutterHz: 3, phaseStep: 0.7, flutterFullSpeed: 5, twitchMin: 2, twitchMax: 6, twitchImpulse: 3 },
  breath: { calmPerMin: 12, exertedPerMin: 40, recoverTime: 20, amplitudeDeg: 0.8, exertionFullSpeed: 10 },
  climb: {
    climbMinDeg: 45, wallMinDeg: 70, climbSpeed: 1.8, scrambleSpeed: 3, maxTiltDeg: 60, cadenceScale: 0.8, strideScale: 0.7,
    swingScale: 1.5, wingsOpen: 0.2, ledgeMax: 2.5, scrambleTime: 0.9, dropMin: 0.6, hopUpSpeed: 1.2, probeAhead: 1.2,
    dropAhead: 0.35, hopClear: 0.3, scrambleLand: 0.9, topFlatness: 0.15, blendTime: 0.12, dropMax: 3,
    scrambleGrip: 0.12, tiltOmega: 14, hopSpeed: 3.5, hopSpeedMax: 6, hopTuck: 0.3, hopGather: 0.15, hopReach: 0.25, hopPitchDeg: 10,
  },
  scramble: {
    hookBack: 0.45, hookUp: 0.5, maxPitchDeg: 40, leapEnd: 0.3, leapUp: 0.1, pitchLead: 0.6, pullEnd: 0.65, hindLand: 0.85,
    pullRise: 0.62, pullAhead: 0.05, overReach: 0.5, pullPitchDeg: 10, overPitchLeadDeg: 15, overBack: -0.45, overUp: 0.4,
    overPitchDeg: 20, foreStep1: 0.47, foreStep1End: 0.62, foreStep2: 0.76, stepEnd: 0.9, stepLift: 0.12, clear: 0.15,
    foreRise: 0.6, foreCross: 0.85, foreDrop: 0.8, hindRise: 0.75, hindCross: 0.92, hindDrop: 0.88,
  },
  camera: {
    distance: 8, minDistance: 4, maxDistance: 18, pitchDeg: 18, minPitchDeg: -10, maxPitchDeg: 70, sensitivity: 0.0025,
    wheelScale: 0.0012, followOmega: 8, lookAhead: 0.25, recentreDelay: 2, recentreOmega: 1.5, climbPitchDeg: 15,
    radius: 0.3, easeOutOmega: 2, fadeNear: 0.5, fadeFar: 1.2, chestHeight: 1.25, climbPitchOmega: 3,
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
