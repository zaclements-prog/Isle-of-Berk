import * as THREE from 'three';
import type { CollisionSet } from '../collision';
import type { BlastEvent, WorldEvents } from '../events';
import type { Debris } from './debris';

/** A box-shaped part a structure breaks into: local centre and half extents, a tilt about local x, its colour. */
export interface StructurePart {
  center: THREE.Vector3;
  half: THREE.Vector3;
  tiltX?: number;
  color: THREE.Color;
}

/** A breakable structure: where it stands, how it shows damage, and the parts it is pre-fractured into. */
export interface Structure {
  key: string;
  kind: 'house' | 'hall' | 'pier';
  /** Base point and yaw: parts are placed in this frame. */
  base: THREE.Vector3;
  yaw: number;
  /** Footprint half extents (local x, z) and height, for the blast's distance. */
  halfX: number;
  halfZ: number;
  height: number;
  hp: number;
  parts: StructurePart[];
  /** Darken it by `scorch` (0…1). */
  scorch(amount: number): void;
  /** Remove it from view (it has broken apart). */
  hide(): void;
}

export interface StructureTuning {
  /** Damage reach as a multiple of the blast radius, and hit points lost to a power-1 blast at point blank. */
  reach: number;
  damage: number;
  /** Debris launch speed (m/s) at point blank per unit power, plus an upward kick (m/s), plus a random spin (rad/s). */
  throwSpeed: number;
  lift: number;
  spin: number;
}

export const DEFAULT_STRUCTURE: StructureTuning = { reach: 1.4, damage: 100, throwSpeed: 9, lift: 3, spin: 4 };

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/**
 * Buildings that blasts break (world-interaction plan §4, milestone 5): each structure has hit points; a blast in reach
 * takes them by distance (from its walls, not its centre) and power and scorches it; at zero it breaks — its collision
 * leaves the structures set, it vanishes, and its pre-fractured parts (wall panels, roof halves, planks) are thrown
 * out as debris, away from the blast. Repeated blasts finish off damaged structures. Publishes `collapse`.
 */
export class StructureDamage {
  private readonly hp = new Map<string, number>();
  private readonly off: () => void;
  private rngState = 7;

  constructor(
    readonly structures: readonly Structure[],
    private readonly set: CollisionSet | null,
    private readonly debris: Debris | null,
    private readonly events: WorldEvents | null,
    private readonly t: StructureTuning = DEFAULT_STRUCTURE,
  ) {
    for (const s of structures) this.hp.set(s.key, s.hp);
    this.off = events?.on('blast', (e) => this.blast(e)) ?? (() => {});
  }

  /** Hit points left (0 once broken). */
  health(key: string): number {
    return this.hp.get(key) ?? 0;
  }

  get broken(): number {
    let n = 0;
    for (const v of this.hp.values()) if (v <= 0) n++;
    return n;
  }

  private rnd(): number {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return this.rngState / 2147483647;
  }

  blast(e: BlastEvent): void {
    const reach = e.radius * this.t.reach;
    for (const s of this.structures) {
      const left = this.hp.get(s.key)!;
      if (left <= 0) continue;
      // distance from the blast to the structure's box
      _p.copy(e.point).sub(s.base).applyAxisAngle(UP, -s.yaw);
      const dx = Math.max(0, Math.abs(_p.x) - s.halfX);
      const dz = Math.max(0, Math.abs(_p.z) - s.halfZ);
      const dy = Math.max(0, -_p.y, _p.y - s.height);
      const d = Math.hypot(dx, dy, dz);
      if (d > reach) continue;
      const hit = this.t.damage * e.power * (1 - d / reach);
      const now = left - hit;
      this.hp.set(s.key, now);
      s.scorch(Math.min(1, 1 - now / s.hp));
      if (now <= 0) this.collapse(s, e);
    }
  }

  private collapse(s: Structure, e: BlastEvent): void {
    this.set?.remove(s.key);
    s.hide();
    const reach = e.radius * this.t.reach;
    _qt.setFromAxisAngle(UP, s.yaw);
    for (const part of s.parts) {
      _p.copy(part.center).applyQuaternion(_qt).add(s.base);
      _q.copy(_qt);
      if (part.tiltX) _q.multiply(new THREE.Quaternion().setFromAxisAngle(X, part.tiltX));
      // thrown away from the blast, harder the closer the part is to it, with an upward kick and a tumble
      _v.subVectors(_p, e.point);
      const d = Math.max(0.5, _v.length());
      const speed = this.t.throwSpeed * e.power * Math.max(0.1, 1 - d / (reach * 1.5));
      _v.divideScalar(d).multiplyScalar(speed);
      _v.y += this.t.lift * (0.5 + this.rnd()) * e.power;
      _w.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(2 * this.t.spin * Math.min(1, e.power));
      this.debris?.spawn(_p, _q, part.half, part.color, _v, _w);
    }
    this.events?.emit({ type: 'collapse', key: s.key, point: s.base.clone(), time: e.time });
  }

  dispose(): void {
    this.off();
  }
}

/**
 * A longhouse's pre-fractured parts in its own frame (x along its length, z across, y up from the floor): wall panels
 * (each long wall in `segs` pieces), the two end walls and the roof in halves along each slope. `sy` stretches it up
 * (the Great Hall), `walls`/`roofY`/`ridge`/`roofHalf` follow longhouseGeometry.
 */
export function longhouseParts(len: number, wid: number, sy: number, wall: THREE.Color, roof: THREE.Color, segs = 2): StructurePart[] {
  const parts: StructurePart[] = [];
  const h = 3 * sy;
  const t = 0.18 + 0.02 * sy;
  for (const side of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const x = -len / 2 + (k + 0.5) * (len / segs);
      parts.push({ center: new THREE.Vector3(x, h / 2, side * (wid / 2 - t)), half: new THREE.Vector3(len / segs / 2, h / 2, t), color: wall });
    }
    parts.push({ center: new THREE.Vector3(side * (len / 2 - t), h / 2, 0), half: new THREE.Vector3(t, h / 2, wid / 2 - 2 * t), color: wall });
  }
  // the roof: from the wall tops (2.9) to the ridge 4.8 higher, over 0.56 of the width each side
  const rise = 4.8 * sy;
  const run = 0.56 * wid;
  const slope = Math.hypot(rise, run);
  const tilt = Math.atan2(rise, run);
  for (const side of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const x = -len * 0.53 + (k + 0.5) * (len * 1.06 / segs);
      parts.push({
        center: new THREE.Vector3(x, 2.9 * sy + rise / 2, side * run / 2), half: new THREE.Vector3(len * 1.06 / segs / 2, 0.12 + 0.03 * sy, slope / 2),
        tiltX: side * tilt, color: roof,
      });
    }
  }
  return parts;
}

/** A pier deck's planks in its frame (z along its length from the shore end, y the deck top). */
export function pierParts(len: number, width: number, wood: THREE.Color): StructurePart[] {
  const n = Math.max(1, Math.round(len / 2));
  const seg = len / n;
  return Array.from({ length: n }, (_, k) => ({ center: new THREE.Vector3(0, -0.1, (k + 0.5) * seg), half: new THREE.Vector3(width / 2, 0.1, seg / 2), color: wood }));
}
