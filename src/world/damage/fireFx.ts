import * as THREE from 'three';
import type { BlastEvent, CollapseEvent, WorldEvents } from '../events';
import type { ForceUniforms } from '../forceField';
import { Particles } from '../../fx/particles';
import { mulberry32 } from '../../core/rng';
import { addCompileHook } from '../../render/materials';
import { airAt, FireSim, type Air, type FireOptions, type FireTuning, DEFAULT_FIRE, type FireTrees } from './fire';

export interface FireFxTuning {
  /** Flame tongues per burning cell, their height (m) at full flame, and the flame colour's HDR gain (it blooms). */
  flamesPerCell: number;
  flameHeight: number;
  glow: number;
  /** Smoke puffs per second from a cell at full flame (shared out under `smokeBudget` puffs a second in all). */
  smokeRate: number;
  smokeBudget: number;
  /** Puffs' rise (m/s), their life (s), and their size (m) at birth and growth (m/s). */
  smokeRise: number;
  smokeLife: number;
  smokeSize: number;
  smokeGrow: number;
  /** Embers a second from a cell at full flame. */
  emberRate: number;
  /** A blast's burst: sparks, and burning firebrands (each trailing smoke, maybe lighting the grass it lands in). */
  sparks: number;
  brands: number;
}

export const DEFAULT_FIRE_FX: FireFxTuning = {
  flamesPerCell: 2, flameHeight: 2.6, glow: 1.7,
  smokeRate: 0.8, smokeBudget: 110, smokeRise: 2.8, smokeLife: 7, smokeSize: 0.8, smokeGrow: 0.42,
  emberRate: 5, sparks: 160, brands: 7,
};

const MAX_PUFFS = 1100;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _air: Air = { x: 0, z: 0, fan: 0 };
const UP = new THREE.Vector3(0, 1, 0);

/** Flame colours up a tongue (linear): white-gold at the root, orange, red at the tip. */
const ROOT = new THREE.Color(1.0, 0.72, 0.2);
const MID = new THREE.Color(1.0, 0.3, 0.02);
const TIP = new THREE.Color(0.62, 0.07, 0.01);

/**
 * A flame tongue (unit height, ~0.5 wide): a faceted teardrop of three twisted pentagonal rings closing to a tip,
 * flat-coloured per face from gold at the root to red at the tip. y runs 0…1 up it for the flicker and the bend.
 */
export function flameGeometry(seed = 5): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const rings = [[0, 0.3], [0.22, 0.5], [0.5, 0.36], [0.78, 0.17]] as const;
  const sides = 5;
  const pts: THREE.Vector3[][] = rings.map(([y, r], k) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + k * 0.55;
      const rr = r * (0.85 + 0.3 * rnd());
      return new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr);
    }));
  const tip = new THREE.Vector3(0.04, 1, -0.03);
  const bottom = new THREE.Vector3(0, -0.02, 0);
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const y = (a.y + b.y + c.y) / 3;
    _c.copy(ROOT).lerp(MID, THREE.MathUtils.smoothstep(y, 0.05, 0.45)).lerp(TIP, THREE.MathUtils.smoothstep(y, 0.5, 0.95));
    _c.multiplyScalar(0.82 + 0.36 * rnd()); // facets: each face its own shade
    for (let w = 0; w < 3; w++) col.push(_c.r, _c.g, _c.b);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tri(bottom, pts[0][j], pts[0][i]);
    for (let k = 0; k < rings.length - 1; k++) {
      tri(pts[k][i], pts[k][j], pts[k + 1][i]);
      tri(pts[k][j], pts[k + 1][j], pts[k + 1][i]);
    }
    tri(pts[rings.length - 1][i], pts[rings.length - 1][j], tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A smoke puff: a jittered icosahedron (unit radius), flat-shaded so the sun picks out its facets. */
export function puffGeometry(seed = 9): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.8 + 0.4 * rnd());
    p.setXYZ(i, p.getX(i) * jitter.get(key)!, p.getY(i) * jitter.get(key)! * 0.85, p.getZ(i) * jitter.get(key)!);
  }
  g.computeVertexNormals();
  return g;
}

interface Brand {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  puff: number;
}

/** A source of smoke with no flames: a wrecked building, a smouldering spot. */
interface Smoulder {
  x: number;
  y: number;
  z: number;
  left: number;
  life: number;
  rate: number;
  acc: number;
}

const hash = (k: number, s: number) => {
  const h = Math.sin(k * 12.9898 + s * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

export interface FireFxOptions {
  ground: (x: number, z: number) => number;
  force?: ForceUniforms | null;
  events?: WorldEvents | null;
  trees?: (FireTrees & { burnProgress(i: number): number }) | null;
}

/**
 * How a fire looks (fits the low-poly island): faceted flame tongues that flicker and lean with the wind and away from
 * the dragon's downwash, glowing ember beds under them, rising embers, and smoke columns of faceted puffs that drift
 * downwind, are blown flat and outward by the downwash, and fade. A blast throws a burst of sparks and a few burning
 * firebrands that trail smoke (and can start a fire where they land); felled logs and wrecked buildings smoke a while.
 */
export class FireFx {
  readonly root = new THREE.Group();
  readonly flames: THREE.InstancedMesh;
  readonly beds: THREE.InstancedMesh;
  readonly puffs: THREE.InstancedMesh;
  readonly embers: Particles;
  readonly sparks: Particles;
  readonly brands: Brand[] = [];
  readonly uniforms = { uFireTime: { value: 0 } };
  private readonly flameAttr: THREE.InstancedBufferAttribute;
  private readonly puffAlpha: THREE.InstancedBufferAttribute;
  private readonly smoulders: Smoulder[] = [];
  // smoke puffs (packed at the front)
  private nPuffs = 0;
  private readonly pp = new Float32Array(MAX_PUFFS * 3);
  private readonly pv = new Float32Array(MAX_PUFFS * 3);
  private readonly pAge = new Float32Array(MAX_PUFFS);
  private readonly pLife = new Float32Array(MAX_PUFFS);
  private readonly pSize = new Float32Array(MAX_PUFFS);
  private readonly pGrow = new Float32Array(MAX_PUFFS);
  private readonly pAlpha = new Float32Array(MAX_PUFFS);
  private readonly pSpin = new Float32Array(MAX_PUFFS);
  private readonly pCol = new Float32Array(MAX_PUFFS * 3);
  private readonly smokeAcc = new Map<number, number>();
  private readonly rnd = mulberry32(31);
  private readonly offs: (() => void)[] = [];
  private emberAcc = 0;

  constructor(readonly sim: FireSim, readonly o: FireFxOptions, readonly t: FireFxTuning = DEFAULT_FIRE_FX) {
    this.root.name = 'Fire';
    const cap = sim.t.maxBurning * t.flamesPerCell + sim.t.maxTrees * 8 + 64;
    // flames
    const fg = flameGeometry();
    this.flameAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('aFlame', this.flameAttr);
    const fm = new THREE.MeshBasicMaterial({ name: 'fire-flame', vertexColors: true, color: new THREE.Color(t.glow, t.glow, t.glow), side: THREE.DoubleSide });
    const u = this.uniforms;
    addCompileHook(fm, 'fireFlame', (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aFlame;\nuniform float uFireTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // aFlame: (phase, bend x, bend z, flicker). The tongue licks up and down and wavers, and leans by the bend (in its own
  // frame, of its height) the more toward its tip.
  float ph = aFlame.x;
  float y = clamp(position.y, 0.0, 1.0);
  float tm = uFireTime;
  float lick = 1.0 + aFlame.w * (0.26 * sin(tm * 9.0 + ph) + 0.14 * sin(tm * 15.7 + ph * 1.7) + 0.08 * sin(tm * 23.0 + ph * 3.1));
  transformed.y *= lick;
  transformed.xz *= 1.0 + 0.14 * sin(tm * 12.3 + ph * 2.3 + y * 5.0);
  transformed.xz += aFlame.yz * y * y * lick;
  transformed.xz += vec2(sin(tm * 6.1 + ph + y * 3.0), cos(tm * 5.3 + ph * 1.3 + y * 2.6)) * 0.1 * y * aFlame.w;
}`);
    });
    this.flames = new THREE.InstancedMesh(fg, fm, cap);
    this.flames.name = 'flames';
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    // ember beds: a glowing hexagon on the ground under the flames
    const bg = new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2);
    const bm = new THREE.MeshBasicMaterial({
      name: 'fire-bed', color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false,
    });
    this.beds = new THREE.InstancedMesh(bg, bm, sim.t.maxBurning + 64);
    this.beds.name = 'emberBeds';
    this.beds.count = 0;
    this.beds.frustumCulled = false;
    this.beds.setColorAt(0, _c.setRGB(0, 0, 0));
    // smoke
    const pg = puffGeometry();
    this.puffAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aAlpha', this.puffAlpha);
    // a little warm self-light, so the shadowed facets read as smoke in the golden light rather than sky-blue
    const pm = new THREE.MeshStandardMaterial({ name: 'fire-smoke', flatShading: true, roughness: 1, metalness: 0, transparent: true, depthWrite: false, emissive: new THREE.Color(0.05, 0.032, 0.018) });
    addCompileHook(pm, 'fireSmoke', (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vPuffAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPuffAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPuffAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vPuffAlpha;');
    });
    this.puffs = new THREE.InstancedMesh(pg, pm, MAX_PUFFS);
    this.puffs.name = 'smoke';
    this.puffs.count = 0;
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 9;
    this.puffs.setColorAt(0, _c.setRGB(0.5, 0.5, 0.5));
    // embers rise on the heat; a blast's sparks fly and fall
    this.embers = new Particles({ capacity: 900, additive: true, maxPixels: 7, fadeNear: 70, fadeFar: 240, gravity: -1.3, drag: 0.9 });
    this.sparks = new Particles({ capacity: 900, additive: true, maxPixels: 8, fadeNear: 70, fadeFar: 240, gravity: 8, drag: 0.7 });
    this.embers.points.name = 'embers';
    this.sparks.points.name = 'sparks';
    this.root.add(this.beds, this.flames, this.puffs, this.embers.points, this.sparks.points);
    if (o.events) {
      this.offs.push(o.events.on('blast', (e) => this.blast(e)));
      this.offs.push(o.events.on('collapse', (e) => this.collapse(e)));
    }
  }

  get smoke(): number {
    return this.nPuffs;
  }

  /** A blast: a burst of sparks and a few burning firebrands thrown out of it, trailing smoke. */
  blast(e: BlastEvent): void {
    const g = this.o.ground(e.point.x, e.point.z);
    if (e.point.y - g > e.radius) return;
    const rnd = this.rnd;
    const k = Math.sqrt(Math.min(3, e.power));
    const n = Math.min(this.t.sparks * e.power, 500);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const el = 0.35 + rnd() * 1.1;
      const sp = (5 + 17 * rnd() ** 1.5) * k;
      _v.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(sp);
      _p.set(e.point.x, e.point.y + 0.4, e.point.z);
      _c.setRGB(4, 1.5 + rnd(), 0.35).multiplyScalar(0.6 + 0.6 * rnd());
      this.sparks.emit({ pos: _p, vel: _v, life: 0.6 + 1.5 * rnd(), size: 0.07 + 0.08 * rnd(), grow: 0, color: _c, alpha: 1 });
    }
    const nb = Math.round(this.t.brands * Math.min(2, e.power));
    for (let i = 0; i < nb; i++) {
      const a = rnd() * Math.PI * 2;
      const el = 0.7 + rnd() * 0.6;
      const sp = (8 + 8 * rnd()) * k;
      this.brands.push({
        pos: new THREE.Vector3(e.point.x + Math.cos(a), e.point.y + 0.5, e.point.z + Math.sin(a)),
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(sp),
        age: 0, puff: 0,
      });
    }
    // a pall of smoke over the blast itself, thicker than the dust
    for (let i = 0; i < 6 * k; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * e.radius * 0.5;
      this.emitPuff(e.point.x + Math.cos(a) * r, e.point.y + 0.5 + rnd() * 2, e.point.z + Math.sin(a) * r, 0.08, 1.1 + rnd() * 0.6, 5, 0.45, 1.6);
    }
  }

  /** A building broken apart: its wreck smokes for a while. */
  collapse(e: CollapseEvent): void {
    this.smoulders.push({ x: e.point.x, y: e.point.y + 1, z: e.point.z, left: 14, life: 14, rate: 5, acc: 0 });
  }

  private emitPuff(x: number, y: number, z: number, shade: number, size: number, life: number, alpha: number, rise: number): void {
    if (this.nPuffs >= MAX_PUFFS) return;
    const i = this.nPuffs++;
    const r = this.rnd;
    this.pp[i * 3] = x;
    this.pp[i * 3 + 1] = y;
    this.pp[i * 3 + 2] = z;
    this.pv[i * 3] = (r() - 0.5) * 0.6;
    this.pv[i * 3 + 1] = rise * (0.7 + 0.6 * r());
    this.pv[i * 3 + 2] = (r() - 0.5) * 0.6;
    this.pAge[i] = 0;
    this.pLife[i] = life * (0.75 + 0.5 * r());
    this.pSize[i] = size * (0.75 + 0.5 * r());
    this.pGrow[i] = this.t.smokeGrow * (0.7 + 0.6 * r());
    this.pAlpha[i] = alpha;
    this.pSpin[i] = r() * 6.28;
    // grey smoke, a little warm (golden-hour haze, ash); dark from burning wood
    this.pCol[i * 3] = shade * 1.08;
    this.pCol[i * 3 + 1] = shade;
    this.pCol[i * 3 + 2] = shade * 0.92;
  }

  update(dt: number, camera?: THREE.PerspectiveCamera, viewportHeight?: number): void {
    if (camera && viewportHeight) {
      this.embers.setView(camera, viewportHeight);
      this.sparks.setView(camera, viewportHeight);
    }
    this.uniforms.uFireTime.value += dt;
    const sim = this.sim;
    const ft: FireTuning = sim.t;
    const t = this.t;
    const force = this.o.force;
    const rnd = this.rnd;
    const wx = ft.wind[0];
    const wz = ft.wind[1];
    let nf = 0;
    let nb = 0;
    const flame = (x: number, y: number, z: number, h: number, w: number, bx: number, bz: number, ph: number, flick: number) => {
      if (nf >= this.flames.instanceMatrix.count) return;
      const yaw = ph * 2.1;
      // the bend is a world displacement of the tip (as a fraction of the height): into the flame's own frame
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const lx = (c * bx - s * bz) * (h / w);
      const lz = (s * bx + c * bz) * (h / w);
      _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(w, h, w));
      this.flames.setMatrixAt(nf, _m);
      this.flameAttr.setXYZW(nf, ph * 7.3, lx, lz, flick);
      nf++;
    };
    const air = (x: number, y: number, z: number, reach = 6) => (force ? airAt(force, x, y, z, _air, reach) : ((_air.x = 0), (_air.z = 0), (_air.fan = 0), _air));
    // smoke is shared out over the burning cells so a big fire doesn't flood the pool
    const nCells = sim.burning.length + sim.burningTrees.length * 3 + sim.logs.length;
    const smokeK = Math.min(1, t.smokeBudget / Math.max(1, nCells * t.smokeRate));
    const emberK = Math.min(1, 220 / Math.max(1, nCells * t.emberRate));
    for (const k of sim.burning) {
      const I = sim.intensity(k);
      if (I <= 0.01) continue;
      sim.center(k, _p);
      const cx = _p.x;
      const cy = _p.y;
      const cz = _p.z;
      air(cx, cy, cz);
      const fan = Math.min(1.2, _air.fan);
      // tongues lean downwind and hard away from the downwash, and lie lower the harder they're fanned
      const bx = wx * 0.22 + _air.x * 1.3;
      const bz = wz * 0.22 + _air.z * 1.3;
      const lean = Math.hypot(bx, bz);
      // a breeze leans them a little; the downwash can lay them nearly flat
      const maxLean = 1 + 0.7 * Math.min(1, fan);
      const cl = lean > maxLean ? maxLean / lean : 1;
      for (let f = 0; f < t.flamesPerCell; f++) {
        const hx = hash(k, f + 1);
        const hz = hash(k, f + 7);
        const h = t.flameHeight * (0.35 + 0.75 * I) * (0.65 + 0.6 * hash(k, f + 3)) * (1 - 0.3 * Math.min(1, fan));
        const w = Math.max(0.16, h * 0.4) * (1 + 0.35 * fan);
        flame(cx + (hx - 0.5) * ft.cell * 0.8, cy - 0.05, cz + (hz - 0.5) * ft.cell * 0.8, h, w, bx * cl, bz * cl, hash(k, f + 11), 1 + fan * 0.6);
      }
      if (nb < this.beds.instanceMatrix.count) {
        const r = ft.cell * (0.45 + 0.2 * I) * (1 + 0.3 * fan);
        _m.compose(_v.set(cx, cy + 0.06, cz), _q.setFromAxisAngle(UP, hash(k, 2) * 3), _s.set(r, 1, r));
        this.beds.setMatrixAt(nb, _m);
        // a dull red glow over the char (additive: on unburnt grass it would read as a pale orange tile)
        _c.setRGB(0.6, 0.12, 0.015).multiplyScalar(Math.min(1, sim.age[k] / 2.5) * (0.4 + 0.6 * I) * (1 + 0.6 * fan));
        this.beds.setColorAt(nb++, _c);
      }
      // smoke and embers
      const acc = (this.smokeAcc.get(k) ?? hash(k, 5)) + dt * t.smokeRate * I * smokeK;
      if (acc >= 1) {
        this.emitPuff(cx + (rnd() - 0.5) * 1.5, cy + 1 + rnd() * 0.8, cz + (rnd() - 0.5) * 1.5, 0.14 + 0.06 * rnd(), t.smokeSize * (0.8 + 0.5 * I), t.smokeLife, 0.55, t.smokeRise);
        this.smokeAcc.set(k, acc - 1);
      } else this.smokeAcc.set(k, acc);
      this.emberAcc += dt * t.emberRate * I * emberK * (1 + fan);
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        this.ember(cx + (rnd() - 0.5) * ft.cell, cy + 0.3 + rnd() * 1.5, cz + (rnd() - 0.5) * ft.cell, _air, 1);
      }
    }
    if (this.smokeAcc.size > sim.t.maxBurning * 4) {
      for (const k of this.smokeAcc.keys()) if (!sim.burning.includes(k)) this.smokeAcc.delete(k);
    }
    // burning trees: tongues up the crown, climbing as it catches and dying back as it burns out
    const trees = this.o.trees;
    if (trees) {
      for (const ti of sim.burningTrees) {
        const pr = trees.burnProgress(ti);
        const base = trees.base(ti);
        const H = trees.height(ti);
        const I = Math.min(1, pr * 5) * (1 - THREE.MathUtils.smoothstep(pr, 0.65, 1));
        if (I <= 0.02) continue;
        const top = Math.min(1, pr * 3); // how far up the crown the fire has climbed
        for (let f = 0; f < 7; f++) {
          const a = hash(ti, f) * Math.PI * 2;
          const y = (0.12 + 0.62 * top * hash(ti, f + 20)) * H;
          const r = (1 - y / H) * 0.32 * H * 0.85;
          const fx = base.x + Math.cos(a) * r;
          const fz = base.z + Math.sin(a) * r;
          // each tongue takes the air where it is: under a hovering dragon the crown's flames splay out from him
          air(fx, base.y + y * 0.5, fz, 12);
          const fan = Math.min(1.2, _air.fan);
          let bx = wx * 0.25 + _air.x * 1.5;
          let bz = wz * 0.25 + _air.z * 1.5;
          const lean = Math.hypot(bx, bz);
          const maxLean = 0.8 + 0.8 * Math.min(1, fan);
          if (lean > maxLean) {
            bx *= maxLean / lean;
            bz *= maxLean / lean;
          }
          const h = (1.4 + 2.3 * hash(ti, f + 30)) * I * (H / 9) * (1 - 0.25 * Math.min(1, fan));
          flame(fx, base.y + y, fz, h, Math.max(0.4, h * 0.5), bx, bz, hash(ti, f + 40), 1.2 + 0.5 * fan);
        }
        air(base.x, base.y + H * 0.3, base.z, 12);
        const acc = (this.smokeAcc.get(-1 - ti) ?? 0) + dt * 3 * I * smokeK;
        if (acc >= 1) {
          this.emitPuff(base.x + (rnd() - 0.5) * 2, base.y + H * (0.6 + 0.4 * top), base.z + (rnd() - 0.5) * 2, 0.07 + 0.04 * rnd(), 1.2, t.smokeLife * 1.2, 0.5, t.smokeRise * 1.3);
          this.smokeAcc.set(-1 - ti, acc - 1);
        } else this.smokeAcc.set(-1 - ti, acc);
        this.emberAcc += dt * 14 * I * emberK;
        while (this.emberAcc >= 1) {
          this.emberAcc -= 1;
          this.ember(base.x + (rnd() - 0.5) * 3, base.y + H * (0.3 + 0.6 * rnd() * top), base.z + (rnd() - 0.5) * 3, _air, 1.4);
        }
      }
    }
    // smouldering logs: a lick of flame or two and a wisp of dark smoke while they last
    for (const [li, L] of sim.logs.entries()) {
      const y = this.o.ground(L.x, L.z);
      const I = Math.min(1, L.left / 4);
      air(L.x, y, L.z);
      flame(L.x, y + 0.2, L.z, 0.9 * I, 0.45, wx * 0.2 + _air.x, wz * 0.2 + _air.z, hash(li, 3), 1);
      const acc = (this.smokeAcc.get(-1e6 - li) ?? 0) + dt * 2.2 * smokeK;
      if (acc >= 1) {
        this.emitPuff(L.x + (rnd() - 0.5) * 2, y + 0.6, L.z + (rnd() - 0.5) * 2, 0.1, 0.6, t.smokeLife * 0.8, 0.4, t.smokeRise);
        this.smokeAcc.set(-1e6 - li, acc - 1);
      } else this.smokeAcc.set(-1e6 - li, acc);
    }
    // wrecks smoke
    for (let i = this.smoulders.length - 1; i >= 0; i--) {
      const s = this.smoulders[i];
      s.left -= dt;
      if (s.left <= 0) {
        this.smoulders.splice(i, 1);
        continue;
      }
      s.acc += dt * s.rate * (s.left / s.life);
      while (s.acc >= 1) {
        s.acc -= 1;
        this.emitPuff(s.x + (rnd() - 0.5) * 6, s.y + rnd(), s.z + (rnd() - 0.5) * 6, 0.12 + 0.05 * rnd(), 1.1, t.smokeLife, 0.4, t.smokeRise);
      }
    }
    // firebrands: ballistic, a bright ember trailing smoke; landing in fuel it may start a fire
    for (let i = this.brands.length - 1; i >= 0; i--) {
      const b = this.brands[i];
      b.age += dt;
      b.vel.y -= 9.81 * dt;
      b.vel.multiplyScalar(Math.exp(-0.25 * dt));
      b.pos.addScaledVector(b.vel, dt);
      _c.setRGB(4, 1.6, 0.4);
      this.sparks.emit({ pos: b.pos, vel: _v.set(0, 0, 0), life: 0.25, size: 0.22, grow: -0.4, color: _c, alpha: 1 });
      b.puff += dt;
      if (b.puff > 0.06) {
        b.puff = 0;
        this.emitPuff(b.pos.x, b.pos.y, b.pos.z, 0.07, 0.22, 1.8, 0.5, 0.3);
      }
      const g = this.o.ground(b.pos.x, b.pos.z);
      if (b.pos.y <= g || b.age > 6) {
        if (b.pos.y <= g + 0.5) sim.igniteAt(b.pos.x, b.pos.z, 0.5);
        this.brands.splice(i, 1);
      }
    }
    this.flames.count = nf;
    this.flames.instanceMatrix.needsUpdate = true;
    this.flameAttr.needsUpdate = true;
    this.beds.count = nb;
    this.beds.instanceMatrix.needsUpdate = true;
    if (this.beds.instanceColor) this.beds.instanceColor.needsUpdate = true;
    this.updatePuffs(dt);
    this.embers.update(dt);
    this.sparks.update(dt);
  }

  private ember(x: number, y: number, z: number, a: Air, k: number): void {
    const r = this.rnd;
    const ft = this.sim.t;
    _v.set(
      ft.wind[0] * ft.windSpeed + a.x * 6 + (r() - 0.5) * 1.6,
      (1.5 + 2.5 * r()) * k * (1 - 0.6 * Math.min(1, a.fan)),
      ft.wind[1] * ft.windSpeed + a.z * 6 + (r() - 0.5) * 1.6,
    );
    _c.setRGB(3.2, 1.0 + 0.8 * r(), 0.22);
    this.embers.emit({ pos: _p.set(x, y, z), vel: _v, life: 1.2 + 2 * r(), size: 0.06 + 0.07 * r(), grow: 0, color: _c, alpha: 1 });
  }

  private updatePuffs(dt: number): void {
    const ft = this.sim.t;
    const force = this.o.force;
    let i = 0;
    while (i < this.nPuffs) {
      this.pAge[i] += dt;
      if (this.pAge[i] >= this.pLife[i]) {
        this.killPuff(i);
        continue;
      }
      const p = i * 3;
      const x = this.pp[p];
      const y = this.pp[p + 1];
      const z = this.pp[p + 2];
      // buoyant, slowing as it cools; carried downwind (more higher up); the downwash flattens it and blows it out
      const age = this.pAge[i] / this.pLife[i];
      const above = y - this.o.ground(x, z);
      const wind = ft.windSpeed * (1 + Math.min(1.5, above / 12));
      let ax = (ft.wind[0] * wind - this.pv[p]) * 0.8;
      let ay = (this.t.smokeRise * (1 - 0.6 * age) - this.pv[p + 1]) * 0.6;
      let az = (ft.wind[1] * wind - this.pv[p + 2]) * 0.8;
      if (force) {
        airAt(force, x, y, z, _air, 14);
        ax += _air.x * 26;
        az += _air.z * 26;
        ay -= _air.fan * 14 * (above > 1 ? 1 : 0);
      }
      this.pv[p] += ax * dt;
      this.pv[p + 1] += ay * dt;
      this.pv[p + 2] += az * dt;
      this.pp[p] += this.pv[p] * dt;
      this.pp[p + 1] = Math.max(this.pp[p + 1] + this.pv[p + 1] * dt, this.o.ground(x, z) + 0.3);
      this.pp[p + 2] += this.pv[p + 2] * dt;
      this.pSize[i] += this.pGrow[i] * dt;
      this.pSpin[i] += dt * 0.3;
      // fades in fast, out slowly
      const a = this.pAlpha[i] * Math.min(1, this.pAge[i] / 0.35) * (1 - age) ** 1.5;
      _m.compose(_v.set(this.pp[p], this.pp[p + 1], this.pp[p + 2]), _q.setFromAxisAngle(_s.set(0.3, 1, 0.2).normalize(), this.pSpin[i]), _s.setScalar(this.pSize[i]));
      this.puffs.setMatrixAt(i, _m);
      // fresh smoke glows a little from the flames under it, then greys
      const warm = Math.max(0, 1 - this.pAge[i] / 0.8);
      _c.setRGB(this.pCol[p] + warm * 0.35, this.pCol[p + 1] + warm * 0.1, this.pCol[p + 2]);
      this.puffs.setColorAt(i, _c);
      this.puffAlpha.setX(i, a);
      i++;
    }
    this.puffs.count = this.nPuffs;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
    this.puffAlpha.needsUpdate = true;
  }

  private killPuff(i: number): void {
    const j = --this.nPuffs;
    if (i === j) return;
    for (const a of [this.pp, this.pv, this.pCol]) a.copyWithin(i * 3, j * 3, j * 3 + 3);
    for (const a of [this.pAge, this.pLife, this.pSize, this.pGrow, this.pAlpha, this.pSpin]) a[i] = a[j];
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const m of [this.flames, this.beds, this.puffs]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
    this.embers.dispose();
    this.sparks.dispose();
  }
}

/** The fire simulation and its look together, with the CPU cost of its last update (ms). */
export class Fire {
  readonly sim: FireSim;
  readonly fx: FireFx;
  readonly root: THREE.Group;
  lastMs = 0;

  constructor(o: FireOptions & { trees?: FireFxOptions['trees'] }, t: FireTuning = DEFAULT_FIRE, fx: FireFxTuning = DEFAULT_FIRE_FX) {
    this.sim = new FireSim(o, t);
    // the look subscribes after the simulation, so a blast's fire is lit before its sparks fly
    this.fx = new FireFx(this.sim, { ground: o.ground, force: o.force, events: o.events, trees: o.trees }, fx);
    this.root = this.fx.root;
  }

  update(dt: number, camera?: THREE.PerspectiveCamera, viewportHeight?: number): void {
    const t0 = performance.now();
    // the spread ticks four times a second: a long frame (a stepped capture, a hitch) is simulated in short steps
    const n = Math.ceil(dt / 0.05);
    for (let i = 0; i < n; i++) this.sim.update(dt / n);
    this.fx.update(dt, camera, viewportHeight);
    this.lastMs = performance.now() - t0;
  }

  stats(): { burning: number; trees: number; logs: number; lit: number; flames: number; smoke: number; embers: number; ms: number } {
    return {
      burning: this.sim.burningCount, trees: this.sim.burningTrees.length, logs: this.sim.logs.length, lit: this.sim.lit,
      flames: this.fx.flames.count, smoke: this.fx.smoke, embers: this.fx.embers.count + this.fx.sparks.count, ms: +this.lastMs.toFixed(3),
    };
  }

  dispose(): void {
    this.sim.dispose();
    this.fx.dispose();
  }
}
