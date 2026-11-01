import type * as THREE from 'three';

/** A plasma impact: where it hit, the surface normal there, its power (1 = one standard blast) and blast radius (m). */
export interface BlastEvent {
  readonly type: 'blast';
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly power: number;
  readonly radius: number;
  /** Simulation time (s) of the impact. */
  readonly time: number;
}

/** A tree thrown over by a blast: its collision key, its base and the direction (yaw) it falls. */
export interface FellEvent {
  readonly type: 'fell';
  readonly key: string;
  readonly point: THREE.Vector3;
  readonly yaw: number;
  readonly time: number;
}

/** A structure broken apart by a blast: its collision key and base. */
export interface CollapseEvent {
  readonly type: 'collapse';
  readonly key: string;
  readonly point: THREE.Vector3;
  readonly time: number;
}

/**
 * Fire (damage/fire): `ignite` a new fire (from a blast, a felled or scorched tree, a thrown firebrand), `spread` a cell
 * of ground catching from its neighbour, `tree` a tree catching (`key` its collision key), `out` the last flame on the
 * island going out. `intensity` is the heat it caught with (0…1).
 */
export interface BurnEvent {
  readonly type: 'burn';
  readonly kind: 'ignite' | 'spread' | 'tree' | 'out';
  readonly point: THREE.Vector3;
  readonly intensity: number;
  readonly key?: string;
  readonly time: number;
}

export type WorldEvent = BlastEvent | FellEvent | CollapseEvent | BurnEvent;
type Handler<E> = (e: E) => void;

/**
 * The world's events bus (docs/superpowers/plans/2026-11-01-world-interaction.md): systems publish what happened
 * (a blast, later fires, falling trees, collapsing buildings) and anything that reacts subscribes, without either side
 * knowing the other. Synchronous: emit() runs every handler before it returns.
 */
export class WorldEvents {
  private readonly handlers = new Map<WorldEvent['type'], Handler<WorldEvent>[]>();

  /** Subscribe; returns the unsubscribe function. */
  on<T extends WorldEvent['type']>(type: T, fn: Handler<Extract<WorldEvent, { type: T }>>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as Handler<WorldEvent>);
    this.handlers.set(type, list);
    return () => {
      const l = this.handlers.get(type);
      if (!l) return;
      const k = l.indexOf(fn as Handler<WorldEvent>);
      if (k >= 0) l.splice(k, 1);
    };
  }

  emit(e: WorldEvent): void {
    for (const fn of this.handlers.get(e.type) ?? []) fn(e);
  }
}
