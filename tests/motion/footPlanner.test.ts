import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FootPlanner, type PlannerBody, type Foothold } from '../../src/characters/dragon/motion/footPlanner';
import { GaitEngine } from '../../src/characters/dragon/motion/gait';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { rotY } from '../../src/characters/dragon/motion/math';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, flatWorld, floor, rampWorld, stepWorld } from '../fixtures/worlds';
import { CollisionWorld } from '../../src/world/collision';

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
  it('leaves an over-stretched paw planted while a scripted action owns the paws (autoStep off)', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    p.reset(bodyAt());
    const strained = [0, 0, 0, DEFAULT_TUNING.planner.overstretch + 0.1];
    p.autoStep = false;
    for (let k = 0; k < 10; k++) {
      g.update(0, DT);
      p.update(bodyAt(), g, strained, DT);
    }
    expect(p.paws[3].planted).toBe(true);
    p.autoStep = true; // ordinary locomotion steps it at once
    g.update(0, DT);
    p.update(bodyAt(), g, strained, DT);
    expect(p.paws[3].planted).toBe(false);
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
  it('accepts a ramp foothold whose rise the slope explains, and still rejects a wall top', () => {
    const ramp = rampWorld(30, 2);
    const p = new FootPlanner(rig, ramp, DEFAULT_TUNING.planner);
    const from = ramp.groundAt(0, 3, 10, 20)!;
    const target = V(0, from.point.y, 4.2); // 1.2 m on up the ramp: a 0.69 m rise, past maxStepUp
    expect(p.project(target, bodyAt(), true, from.point.y, foothold()).ok).toBe(false);
    const ctx = { from: from.point.clone(), fromNormal: from.normal.clone(), hip: null };
    const f = p.project(target, bodyAt(), true, from.point.y, foothold(), ctx);
    expect(f.ok).toBe(true);
    expect(f.point.y - from.point.y).toBeGreaterThan(DEFAULT_TUNING.planner.maxStepUp);
    expect(f.normal.y).toBeCloseTo(Math.cos(Math.PI / 6), 3);
    const wall = new FootPlanner(rig, stepWorld(1.0, 1), DEFAULT_TUNING.planner);
    const flatCtx = { from: V(0, 0, 0.6), fromNormal: V(0, 1, 0), hip: null };
    expect(wall.project(V(0, 0, 2), bodyAt(), true, 0, foothold(), flatCtx).ok).toBe(false);
  });
  it('prefers footholds within reach of the joint at touchdown, and still lands on a surface when none is', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const ctx = { from: V(0, 0, 0), fromNormal: V(0, 1, 0), hip: null, reachFrom: V(0, 0.9, 0), reach: 1.3 };
    // the target 1 m ahead is 1.345 m from the joint; the candidate 12 cm short of it is within 1.3 m
    const near = p.project(V(0, 0, 1), bodyAt(), true, 0, foothold(), ctx);
    expect(near.ok).toBe(true);
    expect(near.point.z).toBeCloseTo(1 - DEFAULT_TUNING.planner.candidateOffset, 9);
    // nothing within reach: the nearest surface point, flagged, never the raw target (here 0.3 m in the air)
    const far = p.project(V(0, 0.3, 1), bodyAt(), true, 0, foothold(), { ...ctx, reach: 0.5 });
    expect(far.ok).toBe(false);
    expect(far.point.y).toBeCloseTo(0, 9);
    expect(far.point.z).toBeCloseTo(1, 9);
  });
  it('starts foothold rays above the hip, so a steep slope never hides the surface it is looking for', () => {
    const ramp = rampWorld(45, 2);
    const p = new FootPlanner(rig, ramp, DEFAULT_TUNING.planner);
    const surface = ramp.groundAt(0, 3.5, 20, 40)!.point.y; // 1.5 m up the 45° ramp
    const target = V(0, 0, 3.5); // body ground height: the ray from castUp above it starts under the slab
    const blind = p.project(target, bodyAt(), false, 0, foothold());
    expect(Math.abs(blind.point.y - surface)).toBeGreaterThan(0.5);
    const ctx = { from: V(0, 0, 1.5), fromNormal: V(0, 1, 0), hip: V(0, 1.0 + surface, 3.2) };
    const f = p.project(target, bodyAt(), false, 0, foothold(), ctx);
    expect(f.point.y).toBeCloseTo(surface, 6);
  });
  it('sizes a swing arc to clear a riser just ahead of the paw', () => {
    const world = stepWorld(0.25, 1);
    const p = new FootPlanner(rig, world, DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const paw = p.paws[1];
    paw.pos.set(0, 0, 0.9); // 10 cm short of the riser
    p.forceStep(1, V(0, 0.25, 2), V(0, 1, 0), 0.3, 0.05);
    const q = V(0, 0, 0);
    for (let k = 1; k < 200; k++) {
      paw.s = k / 200;
      p.swingPoint(1, q);
      const g = world.groundAt(q.x, q.z, 5, 10)!;
      expect(q.y).toBeGreaterThanOrEqual(g.point.y - 1e-9);
    }
  });
  it('lands exactly on the surface when retargeting stops with the target hanging between two treads', () => {
    const world = stepWorld(0.25, 1);
    const p = new FootPlanner(rig, world, DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    const paw = p.paws[1];
    p.forceStep(1, V(0.34, 0.12, 1.3), V(0, 1, 0), 0.3, 0.1); // a blend of a floor and a step foothold
    paw.forced = false; // an ordinary gait swing, past the retarget freeze
    paw.scripted = false;
    paw.s = DEFAULT_TUNING.planner.freezeRetargetAt;
    let guard = 0;
    while (!paw.justPlanted && guard++ < 120) {
      g.update(0, DT);
      p.update(bodyAt(), g, SLACK, DT);
    }
    expect(paw.justPlanted).toBe(true);
    expect(paw.pos.y).toBeCloseTo(0.25, 9);
  });
  it('raises a swing\'s arc, smoothly, when its foothold moves down a tread mid-swing', () => {
    const world = stepWorld(0.25, 1); // a tread at y = 0.25 from z = 1
    const t = DEFAULT_TUNING.planner;
    const p = new FootPlanner(rig, world, t);
    p.reset(bodyAt()); // standing: paw 1's neutral spot (z ≈ 0.7) is on the floor below the tread
    const g = gaitOf();
    const paw = p.paws[1];
    paw.pos.set(paw.pos.x, 0.25, 1.4);
    p.forceStep(1, V(paw.pos.x, 0.25, 1.6), V(0, 1, 0), 0.3, 0.05); // a flat step along the tread...
    paw.scripted = false; // ...as an ordinary corrective step, so it retargets toward the floor spot
    const lift0 = paw.lift;
    const q = V(0, 0, 0);
    let guard = 0;
    let prev = paw.lift;
    while (!paw.justPlanted && guard++ < 120) {
      g.update(0, DT);
      p.update(bodyAt(), g, SLACK, DT);
      expect(paw.lift - prev).toBeLessThanOrEqual(t.liftRate * DT + 1e-12); // grows no faster than liftRate
      prev = paw.lift;
      p.swingPoint(1, q);
      expect(q.y).toBeGreaterThanOrEqual(world.groundAt(q.x, q.z, 5, 10)!.point.y); // clears the tread's edge
    }
    expect(paw.justPlanted).toBe(true);
    expect(paw.pos.y).toBeCloseTo(0, 9); // down on the floor
    expect(paw.lift).toBeGreaterThan(lift0);
  });
  it('carries a scripted swing wherever it is put each step, and plants it there when the swing ends', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    p.reset(bodyAt());
    p.forceStep(2, V(0, 0, 3), V(0, 1, 0), 0.25, 0.1);
    const q = V(0, 0, 0);
    let guard = 0;
    let k = 0;
    while (!p.paws[2].justPlanted && guard++ < 120) {
      const put = V(-0.3, 0.5 * Math.sin(k * 0.2), 0.04 * k++); // a path of the caller's own, nothing like an arc
      p.carry(2, put, V(0, 1, 0));
      expect(p.swingPoint(2, q).distanceTo(put)).toBeLessThan(1e-12);
      expect(p.support(2)).toBeCloseTo(put.y, 12);
      g.update(0, DT);
      p.update(bodyAt(), g, SLACK, DT);
    }
    expect(p.paws[2].justPlanted).toBe(true);
    expect(k).toBe(Math.ceil(0.25 / DT)); // on the swing's own schedule
    expect(p.paws[2].pos.distanceTo(V(-0.3, 0.5 * Math.sin((k - 1) * 0.2), 0.04 * (k - 1)))).toBeLessThan(1e-12);
  });
  it('reports how far a swing will land beyond its leg\'s reach, so the body can lower for it in time', () => {
    const p = new FootPlanner(rig, stepWorld(0.6, 1), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    const hips = [V(0.29, 0.97, -0.62), V(0.31, 0.95, 0.74), V(-0.29, 0.97, -0.62), V(-0.31, 0.95, 0.74)];
    const reach = [1.28, 1.04, 1.28, 1.04];
    p.setLegs(hips, reach);
    expect(p.landingShortfall(1, 0.9)).toBe(0); // planted
    for (let k = 0; k < 120; k++) g.update(1.4, DT);
    const body = bodyAt({ velocity: V(0, 0, 1.4) });
    p.predictTarget(1, body, g, 0.2, V(0, 0, 0)); // the joint at touchdown, as the planner predicts it
    p.forceStep(1, V(0.34, -0.3, 0.9), V(0, 1, 0), 0.3, 0.1); // a landing 1.25 m below the shoulder...
    p.paws[1].scripted = false; // ...on an ordinary swing
    const d = p.paws[1].to.distanceTo(V(0.31, 0.95, 0.74 + 1.4 * 0.2));
    expect(p.landingShortfall(1, 0.9)).toBeCloseTo(d - 0.9 * 1.04, 6);
    p.paws[1].scripted = true; // a scripted action keeps its paws in reach itself
    expect(p.landingShortfall(1, 0.9)).toBe(0);
  });
  it('clamps the landing reach against the real ground under the target (a side slope)', () => {
    // 20° side slope rising toward +X (his left at heading 0): the right paws' ground is lower than the body's
    const slope = CollisionWorld.fromObjects([floor(), box(12, 0.4, 20, 0, 1.6, 0, 0, 0, (20 * Math.PI) / 180)]);
    const p = new FootPlanner(rig, slope, DEFAULT_TUNING.planner);
    const centre = slope.groundAt(0, 0, 10, 20)!.point.y;
    const rise = Math.tan((20 * Math.PI) / 180);
    // each hip 0.85 m above the ground under its own paw: reachable, with a little room for a lead
    const hips = [V(0.29, centre + 0.33 * rise + 0.85, -0.62), V(0.31, centre + 0.34 * rise + 0.85, 0.74),
      V(-0.29, centre - 0.33 * rise + 0.85, -0.62), V(-0.31, centre - 0.34 * rise + 0.85, 0.74)];
    const reach = [1.28, 1.04, 1.28, 1.04];
    p.setLegs(hips, reach);
    const g = gaitOf();
    for (let k = 0; k < 120; k++) g.update(3.2, DT);
    const body = bodyAt({ pos: V(0, centre, 0), velocity: V(0, 0, 3.2) });
    for (const i of [1, 3]) {
      const t = p.predictTarget(i, body, g, 0, V(0, 0, 0));
      const ground = slope.groundAt(t.x, t.z, 10, 20)!.point;
      // within 1 mm: each clamp pass re-measures the ground it moved the target onto (converging, not exact)
      expect(ground.distanceTo(hips[i])).toBeLessThanOrEqual(DEFAULT_TUNING.planner.reachFrac * reach[i] + 1e-3);
    }
  });
  it('retargets a corrective step when he turns mid-step, but never a scripted one', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    p.reset(bodyAt());
    const body = bodyAt({ pos: V(0, 0, 0.4) }); // stance now off-centre: a standing correction starts
    g.update(0, DT);
    p.update(body, g, SLACK, DT);
    const i = p.paws.findIndex((paw) => !paw.planted);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.paws[i].scripted).toBe(false);
    const turned = bodyAt({ pos: V(0, 0, 0.4), heading: 0.8 }); // he swings round before the paw lands
    let guard = 0;
    while (!p.paws[i].justPlanted && guard++ < 120) {
      g.update(0, DT);
      p.update(turned, g, SLACK, DT);
    }
    const n = p.neutralWorld(i, turned.pos, turned.heading, V(0, 0, 0));
    expect(Math.hypot(p.paws[i].pos.x - n.x, p.paws[i].pos.z - n.z)).toBeLessThan(0.05);
    // a scripted step lands exactly where it was sent, whatever the body does
    const target = V(0.5, 0, 1.2);
    p.forceStep(1, target, V(0, 1, 0), 0.3, 0.1);
    guard = 0;
    while (!p.paws[1].justPlanted && guard++ < 120) {
      g.update(0, DT);
      p.update(turned, g, SLACK, DT);
    }
    expect(p.paws[1].pos.distanceTo(target)).toBeLessThan(1e-9);
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
