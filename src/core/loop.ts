import { FixedStepClock } from './clock';

export type SimSystem = (dt: number) => void;
export type RenderFn = (alpha: number, frameDt: number) => void;

interface Entry<T> {
  fn: T;
  priority: number;
  seq: number;
}

/** Drives fixed-step simulation systems and per-frame renderers. Lower priority runs first. */
export class GameLoop {
  simTime = 0;
  frameCount = 0;
  private readonly sims: Entry<SimSystem>[] = [];
  private readonly renders: Entry<RenderFn>[] = [];
  private seq = 0;
  private paused = false;
  private rafId = 0;
  private lastNow = 0;

  constructor(readonly clock = new FixedStepClock()) {}

  addSim(fn: SimSystem, priority = 0): () => void {
    return this.add(this.sims, fn, priority);
  }

  addRender(fn: RenderFn, priority = 0): () => void {
    return this.add(this.renders, fn, priority);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.clock.reset();
  }

  /** Advance one real frame of `elapsed` seconds (called by start(); public for tests and tools). */
  frame(elapsed: number): void {
    this.frameCount++;
    if (this.paused) {
      this.renderAll(1, elapsed);
      return;
    }
    const { steps, alpha } = this.clock.advance(elapsed);
    for (let i = 0; i < steps; i++) this.tick(this.clock.step);
    this.renderAll(alpha, elapsed);
  }

  /** Run exactly n simulation steps now (works while paused), then render the newest state. */
  step(n = 1, dt = this.clock.step): void {
    for (let i = 0; i < n; i++) this.tick(dt);
    this.renderAll(1, dt * n);
  }

  start(): void {
    if (this.rafId) return;
    this.lastNow = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const elapsed = Math.min((now - this.lastNow) / 1000, 0.25);
      this.lastNow = now;
      this.frame(elapsed);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private tick(dt: number): void {
    for (const s of this.sims) s.fn(dt);
    this.simTime += dt;
  }

  private renderAll(alpha: number, frameDt: number): void {
    for (const r of this.renders) r.fn(alpha, frameDt);
  }

  private add<T>(list: Entry<T>[], fn: T, priority: number): () => void {
    const entry: Entry<T> = { fn, priority, seq: this.seq++ };
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    return () => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    };
  }
}
