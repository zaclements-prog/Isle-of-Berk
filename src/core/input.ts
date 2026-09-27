export interface InputState {
  /** KeyboardEvent.code values currently held. */
  readonly keys: ReadonlySet<string>;
  /** Codes that went down since the previous sample (edge-triggered). */
  readonly pressed: ReadonlySet<string>;
  /** Mouse movement accumulated since the previous sample (pixels). */
  readonly mouseDX: number;
  readonly mouseDY: number;
  /** Wheel delta accumulated since the previous sample. */
  readonly wheel: number;
  /** Buttons held (bit 0 = left, 1 = middle, 2 = right — MouseEvent.button order). */
  readonly buttons: number;
  /** Buttons that went down since the previous sample. */
  readonly buttonsPressed: number;
}

export interface InputSource {
  /** Called once per simulation step. */
  sample(simTime: number): InputState;
  dispose(): void;
}

export const EMPTY_INPUT: InputState = {
  keys: new Set<string>(),
  pressed: new Set<string>(),
  mouseDX: 0,
  mouseDY: 0,
  wheel: 0,
  buttons: 0,
  buttonsPressed: 0,
};

/** Keys whose browser default action must be suppressed while playing. */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Live keyboard + mouse. Mouse movement only counts while pointer-locked. */
export class KeyboardMouseInput implements InputSource {
  private readonly held = new Set<string>();
  private down = new Set<string>();
  private dx = 0;
  private dy = 0;
  private wheelAcc = 0;
  private btn = 0;
  private btnDown = 0;
  private readonly off: Array<() => void> = [];

  constructor(
    target: EventTarget,
    private readonly isLocked: () => boolean = () => true,
  ) {
    const on = (type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.off.push(() => target.removeEventListener(type, fn, opts));
    };
    on('keydown', (e) => {
      const code = (e as KeyboardEvent).code;
      if (PREVENT_DEFAULT.has(code)) e.preventDefault();
      if (!this.held.has(code)) this.down.add(code);
      this.held.add(code);
    });
    on('keyup', (e) => {
      this.held.delete((e as KeyboardEvent).code);
    });
    on('blur', () => {
      this.held.clear();
      this.btn = 0;
    });
    on('mousemove', (e) => {
      if (!this.isLocked()) return;
      const m = e as MouseEvent;
      this.dx += m.movementX ?? 0;
      this.dy += m.movementY ?? 0;
    });
    on('mousedown', (e) => {
      const bit = 1 << (e as MouseEvent).button;
      if (!(this.btn & bit)) this.btnDown |= bit;
      this.btn |= bit;
    });
    on('mouseup', (e) => {
      this.btn &= ~(1 << (e as MouseEvent).button);
    });
    on('wheel', (e) => {
      this.wheelAcc += (e as WheelEvent).deltaY;
    }, { passive: true });
  }

  sample(): InputState {
    const s: InputState = {
      keys: new Set(this.held),
      pressed: this.down,
      mouseDX: this.dx,
      mouseDY: this.dy,
      wheel: this.wheelAcc,
      buttons: this.btn,
      buttonsPressed: this.btnDown,
    };
    this.down = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheelAcc = 0;
    this.btnDown = 0;
    return s;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}

export interface InputEvent {
  /** Simulation time (s) at which the event applies. */
  t: number;
  down?: string[];
  up?: string[];
  mouse?: [number, number];
  wheel?: number;
  buttonsDown?: number;
  buttonsUp?: number;
}

/** Deterministic input for the Motion Lab and tests: a timeline keyed by simulation time. */
export class ScriptedInput implements InputSource {
  private readonly events: InputEvent[];
  private next = 0;
  private readonly held = new Set<string>();
  private btn = 0;

  constructor(events: InputEvent[]) {
    this.events = [...events].sort((a, b) => a.t - b.t);
  }

  sample(simTime: number): InputState {
    const pressed = new Set<string>();
    let dx = 0;
    let dy = 0;
    let wheel = 0;
    let btnDown = 0;
    while (this.next < this.events.length && this.events[this.next].t <= simTime + 1e-9) {
      const e = this.events[this.next++];
      for (const k of e.down ?? []) {
        if (!this.held.has(k)) pressed.add(k);
        this.held.add(k);
      }
      for (const k of e.up ?? []) this.held.delete(k);
      if (e.mouse) {
        dx += e.mouse[0];
        dy += e.mouse[1];
      }
      wheel += e.wheel ?? 0;
      if (e.buttonsDown) {
        btnDown |= e.buttonsDown & ~this.btn;
        this.btn |= e.buttonsDown;
      }
      if (e.buttonsUp) this.btn &= ~e.buttonsUp;
    }
    return { keys: new Set(this.held), pressed, mouseDX: dx, mouseDY: dy, wheel, buttons: this.btn, buttonsPressed: btnDown };
  }

  get done(): boolean {
    return this.next >= this.events.length;
  }

  reset(): void {
    this.next = 0;
    this.held.clear();
    this.btn = 0;
  }

  dispose(): void {}
}
