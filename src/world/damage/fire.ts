import * as THREE from 'three';
import type { BlastEvent, FellEvent, WorldEvents } from '../events';
import type { ForceUniforms } from '../forceField';
import type { BurnMask } from './burnMask';
import { mulberry32 } from '../../core/rng';

export interface FireTuning {
  /** Grid cell (m). */
  cell: number;
  /** Hard cap on cells burning at once, and on trees burning at once (the frame budget, not the fuel, bounds a fire). */
  maxBurning: number;
  maxTrees: number;
  /** Of a blast's radius: ground inside `ignite` × radius catches (what the blast didn't char bare). */
  ignite: number;
  /** Seconds a cell of full fuel burns (grass ~1, forest floor more), and the ramp up to full flame. */
  burnTime: number;
  ramp: number;
  /**
   * The heat a fire passes on: each cell catches with its neighbour's heat × `decay`, and nothing catches below
   * `minHeat`. A blast starts at 1, so a fire runs out a bounded number of cells past where it was lit (≈ ln(minHeat) /
   * ln(decay)) unless something re-feeds it. Fanned by the downwash it decays only to `fanDecay`.
   */
  decay: number;
  fanDecay: number;
  minHeat: number;
  /** Chance per second that a burning cell lights a fuelled neighbour, at full flame and fuel. */
  spread: number;
  /** Ground with less fuel than this (0…1) doesn't burn. */
  minFuel: number;
  /** Fuel of the litter on the forest floor, within `forestReach` m of a standing tree (where the ground can burn). */
  forestFuel: number;
  forestReach: number;
  /** Trees: a burning cell lights a tree within `treeReach` m at `treeCatch` per s; a burning tree lights the ground
   * under its crown and trees within `crownReach` m. A blast that scorches a tree past `scorchIgnite` sets it alight. */
  treeReach: number;
  treeCatch: number;
  crownReach: number;
  crownCatch: number;
  scorchIgnite: number;
  /** A felled tree's log smoulders, lighting the ground it lies on with this heat. */
  logHeat: number;
  /** Char (burn-mask scorch) a cell gets when it catches, and when it burns out. */
  charCatch: number;
  charOut: number;
  /** Seconds before burnt ground can burn again (its grass has grown back). */
  regrow: number;
  /** The prevailing wind (unit xz) and how much it pushes the spread and the smoke downwind (m/s). */
  wind: [number, number];
  windSpeed: number;
  /** How much the wind and the downwash bias spread toward where they blow (0 none). */
  windBias: number;
  fanBias: number;
}

export const DEFAULT_FIRE: FireTuning = {
  cell: 2,
  maxBurning: 180,
  maxTrees: 24,
  ignite: 1.15,
  burnTime: 8,
  ramp: 1.5,
  decay: 0.86,
  fanDecay: 0.93,
  minHeat: 0.22,
  spread: 0.24,
  minFuel: 0.12,
  forestFuel: 0.7,
  forestReach: 4.5,
  treeReach: 3.2,
  treeCatch: 0.35,
  crownReach: 5,
  crownCatch: 0.12,
  scorchIgnite: 0.55,
  logHeat: 0.7,
  charCatch: 0.3,
  charOut: 0.9,
  regrow: 160,
  // the grass's wind (grass.ts) blows toward +x, a little +z
  wind: [0.87, 0.49],
  windSpeed: 1.6,
  windBias: 0.6,
  fanBias: 1.6,
};

/** The trees the fire reads and lights (TreeDamage). */
export interface FireTrees {
  readonly count: number;
  state(i: number): string;
  base(i: number): THREE.Vector3;
  height(i: number): number;
  scorchOf(i: number): number;
  key(i: number): string;
  ignite(i: number): boolean;
}

/** The air at a point: its horizontal push (m/s-ish, xz) and how hard it fans a fire (0…). */
export interface Air {
  x: number;
  z: number;
  fan: number;
}

/**
 * The force field's air on the CPU (the same downwash disc and shock rings the grass and trees take in forceAt,
 * forceField.ts), so fire and smoke bend and are fanned the same way the grass flattens. `reach` is how far above the
 * ground the downwash still pushes (smoke higher up is pushed less).
 */
export function airAt(u: ForceUniforms, x: number, y: number, z: number, out: Air, reach = 6): Air {
  out.x = 0;
  out.z = 0;
  out.fan = 0;
  const s = u.uForceDownS.value;
  if (s > 0) {
    const D = u.uForceDown.value;
    const dx = x - D.x;
    const dz = z - D.z;
    const d = Math.hypot(dx, dz);
    const f = s * (1 - THREE.MathUtils.smoothstep(d, 0, D.w * 1.15)) * (1 - THREE.MathUtils.smoothstep(Math.abs(y - D.y), 0, reach));
    // the column of air pushed down spreads out along the ground: weak right under him, strongest part-way out
    const out_ = d > 1e-3 ? 1 / d : 0;
    const radial = Math.min(1, d / (D.w * 0.3 + 1e-3));
    out.x += dx * out_ * f * radial;
    out.z += dz * out_ * f * radial;
    out.fan += f;
  }
  const shocks = u.uForceShock.value;
  const ss = u.uForceShockS.value;
  for (let k = 0; k < shocks.length; k++) {
    const st = ss[k].x;
    if (st <= 0) continue;
    const dx = x - shocks[k].x;
    const dz = z - shocks[k].z;
    const d = Math.hypot(dx, dz);
    const band = Math.exp(-(((d - shocks[k].w) / Math.max(ss[k].y, 0.1)) ** 2)) * st;
    if (d > 1e-3) {
      out.x += (dx / d) * band * 1.6;
      out.z += (dz / d) * band * 1.6;
    }
    out.fan += band;
  }
  return out;
}

export interface FireOptions {
  /**
   * Fuel on the ground, read once per cell: 0 bare … 1 thick grass; negative where nothing can burn at all (water,
   * rock, sand, ground already burnt). Under the trees the forest floor's litter adds its own (`forestFuel`).
   */
  fuel: (x: number, z: number) => number;
  ground: (x: number, z: number) => number;
  /** The grid's square extent: its min corner (x = z) and size (m). */
  start: number;
  size: number;
  burn?: BurnMask | null;
  trees?: FireTrees | null;
  events?: WorldEvents | null;
  /** The shared force field: its downwash fans the fire and bends the flames (null: still air). */
  force?: ForceUniforms | null;
  seed?: number;
}

// cell states
const UNKNOWN = 0;
const FUEL = 1;
const BURNING = 2;
const BURNT = 3;
const NONE = 4;

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const _air: Air = { x: 0, z: 0, fan: 0 };
const _p = new THREE.Vector3();

/**
 * Fire as a simulation (world-interaction plan, the `burn` event): a coarse grid of cells over the island, each
 * unknown (fuel not yet read), fuelled, burning, burnt or bare. A blast lights the grass and forest floor it didn't
 * char bare, and the trees it scorched hard or threw down; a burning cell consumes its fuel, charring the burn mask,
 * and lights fuelled neighbours (more readily downwind and where the downwash fans it) with a little less heat than
 * it caught with, so a fire runs out a bounded way from where it was lit and burns out. Trees near the flames catch,
 * burn for a while and stand burnt. A hard cap on cells (and trees) burning at once keeps a forest from eating the
 * frame. Publishes `burn` events.
 */
export class FireSim {
  readonly t: FireTuning;
  readonly n: number;
  readonly state: Uint8Array;
  /** Fuel left (s of burning at full flame), the fuel it caught with, the heat it caught with, its age burning. */
  readonly fuel: Float32Array;
  readonly fuel0: Float32Array;
  readonly heat: Float32Array;
  readonly age: Float32Array;
  /** Cells burning now (indices), in no order. */
  readonly burning: number[] = [];
  /** Trees burning now (indices) and the heat they caught with. */
  readonly burningTrees: number[] = [];
  readonly treeHeat: Float32Array;
  /** Felled logs smouldering: where they lie, the heat and the seconds left. */
  readonly logs: { x: number; z: number; heat: number; left: number }[] = [];
  time = 0;
  /** Everything ever lit (cells), for tests and the HUD. */
  lit = 0;
  private readonly treeGrid = new Map<number, number[]>();
  private readonly burntQueue: { k: number; at: number }[] = [];
  private readonly rnd: () => number;
  private readonly offs: (() => void)[] = [];
  private tick = 0;
  private wasActive = false;

  constructor(readonly o: FireOptions, t: FireTuning = DEFAULT_FIRE) {
    this.t = t;
    this.n = Math.ceil(o.size / t.cell);
    const nn = this.n * this.n;
    this.state = new Uint8Array(nn);
    this.fuel = new Float32Array(nn);
    this.fuel0 = new Float32Array(nn);
    this.heat = new Float32Array(nn);
    this.age = new Float32Array(nn);
    this.rnd = mulberry32(o.seed ?? 23);
    const trees = o.trees;
    this.treeHeat = new Float32Array(trees?.count ?? 0);
    if (trees) {
      for (let i = 0; i < trees.count; i++) {
        const k = this.cellOf(trees.base(i).x, trees.base(i).z);
        if (k < 0) continue;
        const list = this.treeGrid.get(k) ?? [];
        list.push(i);
        this.treeGrid.set(k, list);
      }
    }
    if (o.events) {
      this.offs.push(o.events.on('blast', (e) => this.blast(e)));
      this.offs.push(o.events.on('fell', (e) => this.felled(e)));
    }
  }

  /** The cell under (x, z), or -1 off the grid. */
  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.o.start) / this.t.cell);
    const j = Math.floor((z - this.o.start) / this.t.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  /** The centre of cell k (on the ground). */
  center(k: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.t.cell;
    const x = this.o.start + ((k % this.n) + 0.5) * c;
    const z = this.o.start + (Math.floor(k / this.n) + 0.5) * c;
    return out.set(x, this.o.ground(x, z), z);
  }

  /** How hard cell k is burning (0…1): ramps up as it catches, dies down as its fuel runs out. */
  intensity(k: number): number {
    if (this.state[k] !== BURNING) return 0;
    const up = THREE.MathUtils.clamp(this.age[k] / this.t.ramp, 0, 1);
    const left = this.fuel[k] / Math.max(1e-3, this.fuel0[k]);
    return up * Math.min(1, left * 2.2) * (0.55 + 0.45 * Math.min(1, this.heat[k] * 1.4)) * Math.min(1, 0.4 + this.fuel0[k] / this.t.burnTime);
  }

  /** Whether cell k has been burnt (and not yet grown back). */
  burnt(k: number): boolean {
    return this.state[k] === BURNT;
  }

  /** Anything still alight: ground, trees or smouldering logs. */
  get active(): boolean {
    return this.burning.length > 0 || this.burningTrees.length > 0 || this.logs.length > 0;
  }

  get burningCount(): number {
    return this.burning.length;
  }

  /** Fuel (0…1) at cell k, read once from the ground and cached. */
  private fuelAt(k: number): number {
    if (this.state[k] === UNKNOWN) {
      this.center(k, _p);
      let f = this.o.fuel(_p.x, _p.z);
      if (f >= 0 && f < this.t.forestFuel && this.forestAt(_p.x, _p.z)) f = this.t.forestFuel;
      if (f >= this.t.minFuel) {
        this.state[k] = FUEL;
        this.fuel0[k] = f;
      } else this.state[k] = NONE;
    }
    return this.state[k] === FUEL ? this.fuel0[k] : 0;
  }

  /** Light cell k with this heat; false if it has no fuel, is burning or burnt, or the cap is reached. */
  igniteCell(k: number, heat: number, kind: 'ignite' | 'spread' = 'spread'): boolean {
    if (k < 0 || heat < this.t.minHeat || this.burning.length >= this.t.maxBurning) return false;
    const f = this.fuelAt(k);
    if (f <= 0) return false;
    this.state[k] = BURNING;
    this.fuel[k] = this.fuel0[k] = f * this.t.burnTime;
    this.heat[k] = Math.min(1, heat);
    // stagger their spread ticks so a ring of cells lit together doesn't pulse
    this.age[k] = -this.rnd() * 0.25;
    this.burning.push(k);
    this.lit++;
    this.center(k, _p);
    this.o.burn?.char(_p.x, _p.z, this.t.cell * 0.75, this.t.charCatch);
    if (kind === 'spread') this.o.events?.emit({ type: 'burn', kind, point: _p.clone(), intensity: heat, time: this.time });
    return true;
  }

  /** Light the ground at (x, z) (a thrown firebrand, a log, a test); true if it caught. */
  igniteAt(x: number, z: number, heat = 1): boolean {
    const ok = this.igniteCell(this.cellOf(x, z), heat, 'ignite');
    if (ok) this.o.events?.emit({ type: 'burn', kind: 'ignite', point: new THREE.Vector3(x, this.o.ground(x, z), z), intensity: heat, time: this.time });
    return ok;
  }

  /** Set tree i alight with this heat (false if it can't burn, or too many trees burn already). */
  igniteTree(i: number, heat: number): boolean {
    const trees = this.o.trees;
    if (!trees || heat < this.t.minHeat || this.burningTrees.length >= this.t.maxTrees) return false;
    if (!trees.ignite(i)) return false;
    this.treeHeat[i] = Math.min(1, heat);
    this.burningTrees.push(i);
    this.o.events?.emit({ type: 'burn', kind: 'tree', point: trees.base(i).clone(), intensity: heat, key: trees.key(i), time: this.time });
    return true;
  }

  /** A blast lights the ground it didn't char bare, and the trees it scorched hard. */
  blast(e: BlastEvent): void {
    const g = this.o.ground(e.point.x, e.point.z);
    if (e.point.y - g > e.radius) return; // an air burst lights nothing
    this.time = Math.max(this.time, e.time);
    const R = e.radius * this.t.ignite;
    const c = this.t.cell;
    let n = 0;
    for (let z = e.point.z - R; z <= e.point.z + R; z += c) {
      for (let x = e.point.x - R; x <= e.point.x + R; x += c) {
        const d = Math.hypot(x - e.point.x, z - e.point.z);
        if (d > R) continue;
        if (this.igniteCell(this.cellOf(x, z), Math.min(1, e.power) * (1 - 0.25 * d / R), 'spread')) n++;
      }
    }
    const trees = this.o.trees;
    if (trees) {
      const reach = e.radius * 1.6 + 2;
      this.forTreesNear(e.point.x, e.point.z, reach, (i) => {
        if (trees.scorchOf(i) >= this.t.scorchIgnite && this.igniteTree(i, Math.min(1, e.power))) n++;
      });
    }
    if (n) this.o.events?.emit({ type: 'burn', kind: 'ignite', point: e.point.clone(), intensity: Math.min(1, e.power), time: e.time });
  }

  /** A tree thrown down by a blast: its log smoulders where it lies, lighting the ground there. */
  felled(e: FellEvent): void {
    const L = 3; // about the middle of the log
    const x = e.point.x + Math.sin(e.yaw) * L;
    const z = e.point.z + Math.cos(e.yaw) * L;
    this.logs.push({ x, z, heat: this.t.logHeat, left: 10 });
    this.igniteAt(x, z, this.t.logHeat);
  }

  /** A standing (or scorched) tree within forestReach of (x, z): forest floor. */
  private forestAt(x: number, z: number): boolean {
    let found = false;
    this.forTreesNear(x, z, this.t.forestReach, (i) => {
      const s = this.o.trees!.state(i);
      if (s === 'standing' || s === 'scorched') found = true;
    });
    return found;
  }

  private forTreesNear(x: number, z: number, r: number, fn: (i: number) => void): void {
    const trees = this.o.trees;
    if (!trees) return;
    const c = this.t.cell;
    const span = Math.ceil(r / c);
    const i0 = Math.floor((x - this.o.start) / c);
    const j0 = Math.floor((z - this.o.start) / c);
    for (let j = j0 - span; j <= j0 + span; j++) {
      if (j < 0 || j >= this.n) continue;
      for (let i = i0 - span; i <= i0 + span; i++) {
        if (i < 0 || i >= this.n) continue;
        const list = this.treeGrid.get(j * this.n + i);
        if (!list) continue;
        for (const ti of list) {
          const b = trees.base(ti);
          if (Math.hypot(b.x - x, b.z - z) <= r) fn(ti);
        }
      }
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const t = this.t;
    const force = this.o.force;
    const spreadTick = 0.25;
    this.tick += dt;
    const doSpread = this.tick >= spreadTick;
    if (doSpread) this.tick -= spreadTick;
    // burning cells: consume fuel (faster, fanned), char, spread
    for (let b = this.burning.length - 1; b >= 0; b--) {
      const k = this.burning[b];
      this.age[k] += dt;
      let fan = 0;
      let ax = 0;
      let az = 0;
      if (force) {
        this.center(k, _p);
        airAt(force, _p.x, _p.y, _p.z, _air);
        fan = Math.min(1.5, _air.fan);
        ax = _air.x;
        az = _air.z;
      }
      this.fuel[k] -= dt * (1 + 0.8 * fan);
      if (this.fuel[k] <= 0) {
        this.state[k] = BURNT;
        this.burntQueue.push({ k, at: this.time });
        this.burning[b] = this.burning[this.burning.length - 1];
        this.burning.pop();
        this.center(k, _p);
        this.o.burn?.char(_p.x, _p.z, t.cell * 0.85, t.charOut);
        continue;
      }
      if (!doSpread || this.age[k] < 0) continue;
      const I = this.intensity(k);
      const h = this.heat[k] * THREE.MathUtils.lerp(t.decay, t.fanDecay, Math.min(1, fan));
      if (h >= t.minHeat) {
        const ki = k % this.n;
        const kj = Math.floor(k / this.n);
        const fanLen = Math.hypot(ax, az);
        for (const [di, dj] of N8) {
          const i = ki + di;
          const j = kj + dj;
          if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
          const nk = j * this.n + i;
          if (this.state[nk] !== UNKNOWN && this.state[nk] !== FUEL) continue;
          const f = this.fuelAt(nk);
          if (f <= 0) continue;
          const diag = di && dj ? 0.7071 : 1;
          const along = (di * t.wind[0] + dj * t.wind[1]) * diag;
          const fanned = fanLen > 1e-3 ? ((di * ax + dj * az) * diag) / fanLen : 0;
          const bias = Math.max(0.15, 1 + t.windBias * along + t.fanBias * Math.min(1, fanLen) * fanned);
          const p = t.spread * spreadTick * I * Math.min(1, f * 1.3) * bias * (di && dj ? 0.6 : 1);
          if (this.rnd() < p) this.igniteCell(nk, h);
        }
      }
      // trees near the flames catch
      if (this.o.trees && h >= t.minHeat && I > 0.3) {
        _p.copy(this.center(k, _p));
        this.forTreesNear(_p.x, _p.z, t.treeReach, (ti) => {
          const s = this.o.trees!.state(ti);
          if ((s === 'standing' || s === 'scorched') && this.rnd() < t.treeCatch * spreadTick * I * (1 + fan)) this.igniteTree(ti, h);
        });
      }
    }
    // burning trees: light the ground under their crowns and their neighbours' crowns; drop the ones burnt out
    const trees = this.o.trees;
    if (trees) {
      for (let b = this.burningTrees.length - 1; b >= 0; b--) {
        const ti = this.burningTrees[b];
        if (trees.state(ti) !== 'burning') {
          this.burningTrees[b] = this.burningTrees[this.burningTrees.length - 1];
          this.burningTrees.pop();
          continue;
        }
        if (!doSpread) continue;
        const h = this.treeHeat[ti] * t.decay;
        if (h < t.minHeat) continue;
        const base = trees.base(ti);
        const r = t.cell * 1.5;
        const x = base.x + (this.rnd() - 0.5) * 2 * r;
        const z = base.z + (this.rnd() - 0.5) * 2 * r;
        if (this.rnd() < 0.5 * spreadTick * 4) this.igniteCell(this.cellOf(x, z), h);
        this.forTreesNear(base.x, base.z, t.crownReach, (tj) => {
          if (tj === ti) return;
          const s = trees.state(tj);
          if ((s === 'standing' || s === 'scorched') && this.rnd() < t.crownCatch * spreadTick) this.igniteTree(tj, h);
        });
      }
    }
    // smouldering logs keep lighting the ground they lie on for a while
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const L = this.logs[i];
      L.left -= dt;
      if (L.left <= 0) {
        this.logs.splice(i, 1);
        continue;
      }
      if (doSpread && this.rnd() < 0.15) this.igniteCell(this.cellOf(L.x + (this.rnd() - 0.5) * 4, L.z + (this.rnd() - 0.5) * 4), L.heat);
    }
    // burnt ground grows back in time and can burn again (its fuel is read afresh)
    while (this.burntQueue.length && this.time - this.burntQueue[0].at > t.regrow) {
      const { k } = this.burntQueue.shift()!;
      if (this.state[k] === BURNT) this.state[k] = UNKNOWN;
    }
    const active = this.active;
    if (this.wasActive && !active) this.o.events?.emit({ type: 'burn', kind: 'out', point: _p.clone(), intensity: 0, time: this.time });
    this.wasActive = active;
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}

/**
 * The island's fuel for the fire: the grass where it grows (its density), nothing on water, the pond, the shingle
 * and sand of the shore, rock (steep ground), or ground a blast or a fire has already charred.
 */
export function islandFireFuel(o: {
  height: (x: number, z: number) => number;
  upness: (x: number, z: number) => number;
  grass?: ((x: number, z: number) => number) | null;
  seaLevel: number;
  pond?: { x: number; z: number; r: number };
  burn?: BurnMask | null;
}): (x: number, z: number) => number {
  return (x, z) => {
    const h = o.height(x, z);
    if (h < o.seaLevel + 2.4) return -1;
    if (o.pond && Math.hypot(x - o.pond.x, z - o.pond.z) < o.pond.r + 1.5) return -1;
    if (o.upness(x, z) < 0.8) return -1;
    const scorch = o.burn?.sample(x, z).scorch ?? 0;
    if (scorch > 0.6) return -1;
    const grass = o.grass ? o.grass(x, z) : 0.6;
    return grass * (1 - THREE.MathUtils.smoothstep(scorch, 0.25, 0.6));
  };
}
