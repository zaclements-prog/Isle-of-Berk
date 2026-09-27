import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FootPlanner, type PlannerBody, type Foothold } from '../../src/characters/dragon/motion/footPlanner';
import { GaitEngine } from '../../src/characters/dragon/motion/gait';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { rotY } from '../../src/characters/dragon/motion/math';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { flatWorld, rampWorld, stepWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rig = toothlessFixtureRig();
const gaitOf = () => new GaitEngine(DEFAULT_TUNING.gait);
const bodyAt = (b: Partial<PlannerBody> = {}): PlannerBody => ({
  pos: V(0, 0, 0), heading: 0, velocity: V(0, 0, 0), yawRate: 0, up: V(0, 1, 0), ...b,
});
const foothold = (): Foothold => ({ point: V(0, 0, 0), normal: V(0, 1, 0), ok: false });
const SLACK = [0, 0, 0, 0];

describe('FootPlanner', () => {
  it('plants all four paws at the neutral stance on reset', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    p.paws.forEach((paw, i) => {
      expect(paw.planted).toBe(true);
      expect(paw.pos.distanceTo(p.neutral[i])).toBeLessThan(1e-6);
    });
  });
  it('predicts Raibert landing targets for straight motion', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(3.2, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 3.2) }), g, 0.2, V(0, 0, 0));
    const lead = 3.2 * 0.2 + 3.2 * g.stanceDuration * DEFAULT_TUNING.planner.raibertGain;
    expect(t.distanceTo(p.neutral[1].clone().add(V(0, 0, lead)))).toBeLessThan(1e-9);
  });
  it('clamps the landing lead to the leg\'s reach envelope', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.setEnvelope([0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2]);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(9, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 9) }), g, 0.1, V(0, 0, 0));
    expect(t.z - p.neutral[1].z - 0.9).toBeCloseTo(0.18, 9);
  });
  it('steps a planted paw early when its leg is about to over-stretch', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    g.update(0, DT);
    p.update(bodyAt(), g, [0.99, 0, 0, 0], DT);
    expect(p.paws[0].planted).toBe(false);
    expect(p.paws[0].justLifted).toBe(true);
  });
  it('takes scripted steps and pauses automatic stepping while autoStep is off', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    p.autoStep = false;
    const target = p.neutral[1].clone().add(V(0, 0, 0.3));
    p.forceStep(1, target, V(0, 1, 0), 0.3, 0.2);
    let apex = 0;
    for (let k = 0; k < 60; k++) {
      g.update(3, DT);
      p.update(bodyAt({ pos: V(0, 0, 1) }), g, SLACK, DT);
      apex = Math.max(apex, p.swingPoint(1, V(0, 0, 0)).y);
      expect(p.paws[0].planted && p.paws[2].planted && p.paws[3].planted).toBe(true);
    }
    expect(p.paws[1].planted).toBe(true);
    expect(p.paws[1].pos.distanceTo(target)).toBeLessThan(1e-9);
    expect(apex).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });
  it('keeps landing targets within reach of the predicted hip', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const hips = p.neutral.map((n) => n.clone().add(V(0, 0.95, 0)));
    p.setLegs(hips, [1.2, 1.2, 1.2, 1.2]);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(9, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 9) }), g, 0.1, V(0, 0, 0));
    const hip = hips[1].clone().add(V(0, 0, 0.9));
    expect(t.distanceTo(hip)).toBeLessThanOrEqual(DEFAULT_TUNING.planner.reachFrac * 1.2 + 1e-9);
    expect(t.z - p.neutral[1].z - 0.9).toBeGreaterThan(0.1); // still leads, just not out of reach
  });
  it('predicts landing targets through a turn', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const t = p.predictTarget(0, bodyAt({ yawRate: 1 }), gaitOf(), 0.3, V(0, 0, 0));
    expect(t.distanceTo(rotY(p.neutral[0], 0.3, V(0, 0, 0)))).toBeLessThan(1e-9);
  });
  it('rejects footholds steeper than 75°', () => {
    const p = new FootPlanner(rig, rampWorld(80, 2), DEFAULT_TUNING.planner);
    const f = p.project(V(0, 0, 2.05), bodyAt(), true, 0, foothold());
    expect(f.normal.y).toBeGreaterThan(0.99);
    expect(f.point.z).toBeLessThan(2);
  });
  it('moves off edges when a solid spot is nearby', () => {
    const p = new FootPlanner(rig, stepWorld(0.5, 1), DEFAULT_TUNING.planner);
    const f = p.project(V(0, 0, 1.03), bodyAt(), true, 0, foothold());
    expect(f.ok).toBe(true);
    expect(f.point.y).toBeCloseTo(0.5, 6);
    expect(f.point.z).toBeGreaterThan(1.1);
  });
  it('rejects footholds beyond the step-height limits', () => {
    const p = new FootPlanner(rig, stepWorld(1.0, 1), DEFAULT_TUNING.planner);
    expect(p.project(V(0, 0, 2), bodyAt(), true, 0, foothold()).ok).toBe(false);
  });
  it('walks: alternates stance and swing, keeps planted paws fixed, lifts swings and strides with the body', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    const body = { pos: V(0, 0, 0), heading: 0, velocity: V(0, 0, 1.4), yawRate: 0, up: V(0, 1, 0) };
    p.reset(body);
    const lifts = [0, 0, 0, 0];
    const plants: THREE.Vector3[][] = [[], [], [], []];
    const apex = [0, 0, 0, 0];
    const locked = p.paws.map((paw) => paw.pos.clone());
    const q = V(0, 0, 0);
    for (let k = 0; k < 480; k++) {
      body.pos.addScaledVector(body.velocity, DT);
      g.update(1.4, DT);
      p.update(body, g, SLACK, DT);
      p.paws.forEach((paw, i) => {
        if (paw.justLifted) lifts[i]++;
        if (paw.justPlanted) {
          plants[i].push(paw.pos.clone());
          locked[i].copy(paw.pos);
        }
        if (paw.planted) expect(paw.pos.distanceTo(locked[i])).toBe(0);
        else apex[i] = Math.max(apex[i], p.swingPoint(i, q).y);
      });
    }
    for (let i = 0; i < 4; i++) {
      expect(lifts[i]).toBeGreaterThanOrEqual(3);
      expect(apex[i]).toBeGreaterThan(0.1);
      const strides = plants[i].slice(1).map((pt, k) => pt.distanceTo(plants[i][k]));
      const mean = strides.reduce((a, b) => a + b, 0) / strides.length;
      expect(Math.abs(mean - g.strideLength) / g.strideLength).toBeLessThan(0.1);
    }
  });
  it('re-centres the stance with one corrective step at a time when standing', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    p.reset(bodyAt());
    const body = bodyAt({ pos: V(0, 0, 0.5), heading: 0.4 });
    let maxAirborne = 0;
    for (let k = 0; k < 480; k++) {
      g.update(0, DT);
      p.update(body, g, SLACK, DT);
      maxAirborne = Math.max(maxAirborne, p.paws.filter((paw) => !paw.planted).length);
    }
    expect(maxAirborne).toBe(1);
    p.paws.forEach((paw, i) => {
      const n = p.neutralWorld(i, body.pos, body.heading, V(0, 0, 0));
      expect(Math.hypot(paw.pos.x - n.x, paw.pos.z - n.z)).toBeLessThanOrEqual(DEFAULT_TUNING.planner.forcedStepDist + 1e-9);
    });
  });
  it('aligns the paw to the surface at plant', () => {
    const world = rampWorld(15);
    const p = new FootPlanner(rig, world, DEFAULT_TUNING.planner);
    p.reset(bodyAt({ pos: V(0, 0, 0) })); // plant off the ramp first, so landing on it is a real swing
    const body = bodyAt({ pos: V(0, 0, 3) }); // pulls leg 0's neutral stance onto the ramp face
    const g = gaitOf();
    g.update(0, DT);
    p.update(body, g, [0.99, 0, 0, 0], DT); // over-stretch forces an early swing toward the ramp
    expect(p.paws[0].planted).toBe(false);
    let guard = 0;
    while (!p.paws[0].justPlanted && guard++ < 80) {
      g.update(0, DT);
      p.update(body, g, SLACK, DT);
    }
    expect(p.paws[0].justPlanted).toBe(true);
    const hit = world.groundAt(p.paws[0].pos.x, p.paws[0].pos.z, p.paws[0].pos.y + 1, 2);
    if (!hit) throw new Error('expected the ramp fixture to have ground under the landed paw');
    expect(hit.normal.y).toBeLessThan(0.99); // sanity: actually landed on the sloped face, not flat ground
    expect(Math.abs(p.paws[0].normal.x - hit.normal.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.paws[0].normal.y - hit.normal.y)).toBeLessThan(1e-6);
    expect(Math.abs(p.paws[0].normal.z - hit.normal.z)).toBeLessThan(1e-6);
  });
  it('blends smoothly when the target moves mid-swing', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    const body = { pos: V(0, 0, 0), heading: 0, velocity: V(0, 0, 1.4), yawRate: 0, up: V(0, 1, 0) };
    p.reset(body);
    const LEG = 1;
    const q = V(0, 0, 0);
    let guard = 0;
    while (p.paws[LEG].planted && guard++ < 240) {
      body.pos.addScaledVector(body.velocity, DT);
      g.update(body.velocity.length(), DT);
      p.update(body, g, SLACK, DT);
    }
    expect(p.paws[LEG].planted).toBe(false); // sanity: a swing actually started
    let prevPoint = p.swingPoint(LEG, q).clone();
    let maxBefore = 0;
    const afterDeltas: number[] = [];
    let changed = false;
    const targetBeforeChange = V(0, 0, 0);
    guard = 0;
    while (p.paws[LEG].s < 1 && guard++ < 240) {
      if (!changed && p.paws[LEG].s >= 0.5) {
        targetBeforeChange.copy(p.paws[LEG].to);
        body.velocity.set(0, 0, 2.4); // sudden command change mid-swing
        changed = true;
      }
      body.pos.addScaledVector(body.velocity, DT);
      g.update(body.velocity.length(), DT);
      p.update(body, g, SLACK, DT);
      const pt = p.swingPoint(LEG, q).clone();
      const d = pt.distanceTo(prevPoint);
      if (changed) afterDeltas.push(d);
      else maxBefore = Math.max(maxBefore, d);
      prevPoint = pt;
    }
    expect(changed).toBe(true); // sanity: the change landed mid-swing, before freezeRetargetAt
    expect(p.paws[LEG].to.distanceTo(targetBeforeChange)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...afterDeltas)).toBeLessThanOrEqual(3 * maxBefore);
    expect(p.paws[LEG].planted).toBe(true);
    expect(p.paws[LEG].pos.distanceTo(p.paws[LEG].to)).toBeLessThan(1e-9);
  });
});
