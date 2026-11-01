import * as THREE from 'three';
import type { BlastEvent, WorldEvents } from '../events';
import { Particles } from '../../fx/particles';
import { mulberry32 } from '../../core/rng';

export interface EjectaTuning {
  /** Clods thrown per unit of blast power, their size range (m) and launch speed range (m/s) at power 1. */
  clods: number;
  clodSize: [number, number];
  clodSpeed: [number, number];
  /** Bounce (0…1) and the sliding friction (1/s) on the ground; a clod rests for `rest` s, then sinks in over `sink` s. */
  bounce: number;
  friction: number;
  rest: number;
  sink: number;
  /** Fine dirt spray and dust-cloud puffs per unit of power. */
  spray: number;
  dust: number;
}

export const DEFAULT_EJECTA: EjectaTuning = {
  clods: 110, clodSize: [0.12, 0.55], clodSpeed: [7, 18], bounce: 0.3, friction: 4, rest: 14, sink: 3, spray: 420, dust: 34,
};

/** What the ejecta reads of the ground: its height, and how rocky it is there (0 soil … 1 bare rock). */
export interface EjectaGround {
  height: (x: number, z: number) => number;
  rock?: (x: number, z: number) => number;
}

interface Clod {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  spin: THREE.Vector3;
  size: number;
  rest: number;
  slot: number;
}

const SOIL = [new THREE.Color(0.2, 0.13, 0.08), new THREE.Color(0.3, 0.21, 0.13), new THREE.Color(0.14, 0.1, 0.07)];
const TURF = new THREE.Color(0.2, 0.3, 0.1);
const STONE = new THREE.Color(0.36, 0.35, 0.33);
const SPRAY = new THREE.Color(0.13, 0.09, 0.06);
const DUST = new THREE.Color(0.42, 0.34, 0.25);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** A clod: a squashed, jittered icosahedron (unit size), flat-shaded. */
export function clodGeometry(seed = 3): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    // the same corner moves the same way in every face that shares it, so the clod stays closed
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.75 + 0.5 * rnd());
    const k = jitter.get(key)!;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The soil a blast throws (world-interaction plan §4, the crater's look): clods of earth, turf and stone flung out of
 * the crater on ballistic arcs that bounce, roll to rest and sink back in; a fountain of fine dirt; and a dust cloud
 * that billows out and drifts up. Clods meet only the heightfield (no collision cost), drawn as one instanced mesh;
 * the spray and dust are two particle pools.
 */
export class Ejecta {
  readonly root = new THREE.Group();
  readonly clodMesh: THREE.InstancedMesh;
  readonly spray: Particles;
  readonly dust: Particles;
  readonly clods: Clod[] = [];
  private readonly free: number[] = [];
  private readonly rng = mulberry32(17);
  private readonly off: () => void;

  constructor(private readonly ground: EjectaGround, events: WorldEvents | null, readonly t: EjectaTuning = DEFAULT_EJECTA, capacity = 600) {
    this.root.name = 'Ejecta';
    const mat = new THREE.MeshStandardMaterial({ name: 'clods', flatShading: true, roughness: 0.95, metalness: 0 });
    this.clodMesh = new THREE.InstancedMesh(clodGeometry(), mat, capacity);
    this.clodMesh.name = 'clods';
    this.clodMesh.castShadow = this.clodMesh.receiveShadow = true;
    this.clodMesh.frustumCulled = false;
    for (let k = capacity - 1; k >= 0; k--) {
      this.clodMesh.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.clodMesh.setColorAt(k, SOIL[0]);
      this.free.push(k);
    }
    this.spray = new Particles({ capacity: 3000, additive: false, maxPixels: 16, fadeNear: 90, fadeFar: 260, gravity: 9.81, drag: 0.5 });
    this.dust = new Particles({ capacity: 400, additive: false, maxPixels: 900, fadeNear: 140, fadeFar: 420, gravity: -0.25, drag: 1.4 });
    this.spray.points.name = 'dirtSpray';
    this.dust.points.name = 'dust';
    this.root.add(this.clodMesh, this.spray.points, this.dust.points);
    this.off = events?.on('blast', (e) => this.blast(e)) ?? (() => {});
  }

  get live(): number {
    return this.clods.length;
  }

  blast(e: BlastEvent): void {
    const g = this.ground;
    const above = e.point.y - g.height(e.point.x, e.point.z);
    if (above > e.radius) return;                                // an air burst throws no soil
    const k = 1 - Math.max(0, above) / e.radius;
    const power = e.power * k;
    const rnd = this.rng;
    const rock = g.rock?.(e.point.x, e.point.z) ?? 0;
    const reach = 0.5 * e.radius;
    const speedK = Math.sqrt(power);
    // clods: from inside the crater, outward and up (steeper near the centre), earth with a skin of turf, or stone
    const n = Math.min(this.t.clods * power, 240);
    for (let i = 0; i < n; i++) {
      const slot = this.free.pop();
      if (slot === undefined) this.recycleOldest();
      const s = slot ?? this.free.pop();
      if (s === undefined) break;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * reach * 0.6;
      const pos = new THREE.Vector3(e.point.x + Math.cos(a) * r, 0, e.point.z + Math.sin(a) * r);
      pos.y = g.height(pos.x, pos.z) + 0.2;
      const elev = THREE.MathUtils.lerp(1.25, 0.6, r / (reach * 0.6 + 1e-6)) + (rnd() - 0.5) * 0.35;
      const sp = THREE.MathUtils.lerp(this.t.clodSpeed[0], this.t.clodSpeed[1], rnd() ** 1.5) * speedK;
      const vel = new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)).multiplyScalar(sp);
      const size = THREE.MathUtils.lerp(this.t.clodSize[0], this.t.clodSize[1], rnd() ** 2) * Math.min(1.6, 0.8 + 0.25 * power);
      const spin = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(18 / (0.5 + size * 4));
      const c: Clod = { pos, vel, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)), spin, size, rest: 0, slot: s };
      const pick = rnd();
      _c.copy(rock > pick ? STONE : pick > 0.82 && rock < 0.3 ? TURF : SOIL[Math.floor(rnd() * SOIL.length)]);
      _c.multiplyScalar(0.85 + 0.3 * rnd());
      this.clodMesh.setColorAt(s, _c);
      this.clods.push(c);
    }
    if (this.clodMesh.instanceColor) this.clodMesh.instanceColor.needsUpdate = true;
    // the fine dirt: a fountain thrown hard and high, falling back over a second or so
    const nSpray = Math.min(this.t.spray * power, 1200);
    for (let i = 0; i < nSpray; i++) {
      const a = rnd() * Math.PI * 2;
      const elev = 0.75 + rnd() * 0.75;
      const sp = (5 + 15 * rnd()) * speedK;
      _v.set(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)).multiplyScalar(sp);
      _p.set(e.point.x + Math.cos(a) * reach * 0.3 * rnd(), e.point.y + 0.2, e.point.z + Math.sin(a) * reach * 0.3 * rnd());
      _c.copy(rock > rnd() ? STONE : SPRAY).multiplyScalar(0.8 + 0.4 * rnd());
      this.spray.emit({ pos: _p, vel: _v, life: 0.9 + 1.1 * rnd(), size: 0.09 + 0.14 * rnd(), grow: 0, color: _c, alpha: 1 });
    }
    // the dust: a plume thrown straight up out of the crater (darker, it's the soil itself), and a cloud rolling out
    // low from it that drifts up as it spreads
    const nDust = Math.min(this.t.dust * Math.sqrt(power), 90);
    for (let i = 0; i < nDust; i++) {
      const a = rnd() * Math.PI * 2;
      const plume = i % 3 === 0;
      const sp = (plume ? 0.5 + 1.5 * rnd() : 1.5 + 5 * rnd()) * speedK;
      _v.set(Math.cos(a) * sp, (plume ? 4 + 6 * rnd() : 0.6 + 2.2 * rnd()) * speedK, Math.sin(a) * sp);
      _p.set(e.point.x + Math.cos(a) * reach * (plume ? 0.15 : 0.4), e.point.y + 0.6 + rnd() * 1.4 * speedK, e.point.z + Math.sin(a) * reach * (plume ? 0.15 : 0.4));
      _c.copy(DUST).multiplyScalar(plume ? 0.55 + 0.25 * rnd() : 0.8 + 0.35 * rnd()).lerp(STONE, rock * 0.6);
      const size = (plume ? 1.4 + 1.2 * rnd() : 2.2 + 2.3 * rnd()) * Math.sqrt(speedK);
      this.dust.emit({ pos: _p, vel: _v, life: 3.5 + 3.5 * rnd(), size, grow: 1.5 + rnd(), color: _c, alpha: plume ? 0.6 : 0.48 });
    }
  }

  update(dt: number, camera?: THREE.PerspectiveCamera, viewportHeight?: number): void {
    if (camera && viewportHeight) {
      this.spray.setView(camera, viewportHeight);
      this.dust.setView(camera, viewportHeight);
    }
    this.spray.update(dt);
    this.dust.update(dt);
    const g = this.ground;
    const t = this.t;
    for (let i = this.clods.length - 1; i >= 0; i--) {
      const c = this.clods[i];
      let sinkK = 1;
      if (c.rest > 0) {
        c.rest += dt;
        if (c.rest > t.rest + t.sink) {
          this.release(i);
          continue;
        }
        // resting, then sinking back into the ground it came from
        sinkK = 1 - Math.max(0, (c.rest - t.rest) / t.sink);
        c.pos.y = g.height(c.pos.x, c.pos.z) + c.size * 0.3 - (1 - sinkK) * c.size * 0.8;
      } else {
        c.vel.y -= 9.81 * dt;
        c.pos.addScaledVector(c.vel, dt);
        _q.setFromAxisAngle(_v.copy(c.spin).normalize(), c.spin.length() * dt);
        c.q.premultiply(_q);
        const floor = g.height(c.pos.x, c.pos.z) + c.size * 0.3;
        if (c.pos.y < floor) {
          c.pos.y = floor;
          const impact = -c.vel.y;
          // a hard landing kicks up a little dust
          if (impact > 6 && this.dust.count < 380 && this.rng() < 0.35) {
            _c.copy(DUST).multiplyScalar(0.9);
            this.dust.emit({ pos: c.pos, vel: _v.set(0, 0.6, 0), life: 1.2 + this.rng(), size: 0.5 + c.size * 2, grow: 0.9, color: _c, alpha: 0.3 });
          }
          c.vel.y = impact * t.bounce;
          const slide = Math.exp(-t.friction * dt * 6);
          c.vel.x *= slide;
          c.vel.z *= slide;
          c.spin.multiplyScalar(0.6);
          if (c.vel.length() < 0.6) c.rest = 1e-6;
        }
      }
      _m.compose(c.pos, c.q, _s.setScalar(c.size * Math.max(0.001, sinkK)));
      this.clodMesh.setMatrixAt(c.slot, _m);
    }
    this.clodMesh.instanceMatrix.needsUpdate = true;
  }

  private release(i: number): void {
    const c = this.clods[i];
    this.clodMesh.setMatrixAt(c.slot, _m.makeScale(0, 0, 0));
    this.free.push(c.slot);
    this.clods.splice(i, 1);
  }

  private recycleOldest(): void {
    if (this.clods.length) this.release(0);
  }

  dispose(): void {
    this.off();
    this.clodMesh.geometry.dispose();
    (this.clodMesh.material as THREE.Material).dispose();
    this.clodMesh.dispose();
    this.spray.dispose();
    this.dust.dispose();
  }
}
