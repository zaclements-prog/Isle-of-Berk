export interface StepResult {
  /** Fixed simulation steps to run this frame. */
  steps: number;
  /** Interpolation factor from the previous toward the current simulation state (0..1). */
  alpha: number;
}

/** Accumulates real frame time into fixed simulation steps ("fix your timestep"). */
export class FixedStepClock {
  private acc = 0;

  constructor(
    readonly step = 1 / 120,
    readonly maxSteps = 8,
  ) {}

  advance(elapsed: number): StepResult {
    this.acc += Math.max(0, elapsed);
    let steps = Math.floor(this.acc / this.step);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.acc = 0; // drop the backlog instead of spiralling (hidden tab, debugger pause, ...)
    } else {
      this.acc = Math.max(0, this.acc - steps * this.step);
    }
    return { steps, alpha: this.acc / this.step };
  }

  reset(): void {
    this.acc = 0;
  }
}
