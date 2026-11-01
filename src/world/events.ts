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

export type WorldEvent = BlastEvent;
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
