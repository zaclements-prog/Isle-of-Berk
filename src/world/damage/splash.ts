import * as THREE from 'three';
import { Particles } from '../../fx/particles';
import { mulberry32 } from '../../core/rng';
import { MAX_RIPPLES, type ForceUniforms } from '../forceField';

export interface SplashTuning {
  /** Impact size: sqrt(kinetic energy, J) per unit splash, and the clamp on it. */
  energyUnit: number;
  maxSize: number;
  /** Spray drops and mist puffs per unit splash (plus a few always), and the cap. */
  drops: number;
  mist: number;
  maxDrops: number;
  /** The ripple ring: speed (m/s) and life (s) at unit splash. */
  ringSpeed: number;
  ringLife: number;
}

export const DEFAULT_SPLASH: SplashTuning = { energyUnit: 120, maxSize: 3, drops: 150, mist: 5, maxDrops: 420, ringSpeed: 2.6, ringLife: 2.6 };

interface Ripple {
  x: number;
  y: number;
  z: number;
  age: number;
  /** Splash size (unit 1) and the piece's footprint (m). */
  k: number;
  r0: number;
}

const SPRAY = new THREE.Color(0.86, 0.9, 0.92);
const MIST = new THREE.Color(0.9, 0.93, 0.95);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Splashes where debris hits the water (the sea or the pond): a crown of spray drops and a puff of mist, scaled by the
 * impact's energy, and a ripple ring with a train of smaller rings behind it running out across the surface, with
 * foam where the piece went in. The ring is drawn by the water's shader from the shared force uniforms
 * (`uForceRipple`, see forceField's RIPPLE_PARS), so the sea and the pond both show it.
 */
export class Splashes {
  readonly root = new THREE.Group();
  readonly spray: Particles;
  readonly mist: Particles;
  readonly ripples: Ripple[] = [];
  /** Splashes so far. */
  count = 0;
  private readonly rng = mulberry32(29);

  constructor(private readonly force: ForceUniforms | null = null, readonly t: SplashTuning = DEFAULT_SPLASH) {
    this.root.name = 'Splashes';
    this.spray = new Particles({ capacity: 2400, additive: false, maxPixels: 14, fadeNear: 80, fadeFar: 240, gravity: 9.81, drag: 0.6 });
    this.mist = new Particles({ capacity: 160, additive: false, maxPixels: 700, fadeNear: 120, fadeFar: 360, gravity: -0.3, drag: 1.6 });
    this.spray.points.name = 'splashSpray';
    this.mist.points.name = 'splashMist';
    this.root.add(this.spray.points, this.mist.points);
  }

  /** How big a splash a body of `mass` kg entering at `speed` m/s makes (unit 1 ≈ a plank thrown in hard). */
  size(speed: number, mass: number): number {
    return Math.min(this.t.maxSize, Math.sqrt(0.5 * mass * speed * speed) / this.t.energyUnit);
  }

  /** A splash at `at` (on the water's surface). */
  splash(at: THREE.Vector3, speed: number, mass: number): void {
    const k = this.size(speed, mass);
    if (k < 0.03) return;
    this.count++;
    const rnd = this.rng;
    const r0 = THREE.MathUtils.clamp(Math.cbrt(mass / 500), 0.3, 2.5);
    const sk = Math.sqrt(k);
    // the crown: drops thrown up and out from the rim of the hole
    const n = Math.min(this.t.maxDrops, Math.round(12 + this.t.drops * k));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rim = r0 * (0.4 + 0.6 * rnd());
      const elev = THREE.MathUtils.lerp(1.05, 1.45, rnd());
      const sp = (2 + 6 * rnd()) * (0.6 + 0.6 * sk);
      _v.set(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)).multiplyScalar(sp);
      _p.set(at.x + Math.cos(a) * rim, at.y + 0.05, at.z + Math.sin(a) * rim);
      _c.copy(SPRAY).multiplyScalar(0.9 + 0.15 * rnd());
      this.spray.emit({ pos: _p, vel: _v, life: 0.6 + 0.9 * rnd(), size: 0.06 + 0.12 * rnd() * (0.7 + 0.3 * sk), grow: 0, color: _c, alpha: 0.95 });
    }
    // a column straight up the middle for the big ones
    for (let i = 0; i < Math.round(30 * Math.max(0, k - 0.4)); i++) {
      _v.set((rnd() - 0.5) * 1.2, (5 + 6 * rnd()) * sk, (rnd() - 0.5) * 1.2);
      _p.set(at.x + (rnd() - 0.5) * r0 * 0.5, at.y + 0.1, at.z + (rnd() - 0.5) * r0 * 0.5);
      this.spray.emit({ pos: _p, vel: _v, life: 0.8 + 0.8 * rnd(), size: 0.1 + 0.12 * rnd(), grow: 0, color: SPRAY, alpha: 0.9 });
    }
    // mist hanging over it
    const m = Math.min(24, Math.round(1 + this.t.mist * k));
    for (let i = 0; i < m; i++) {
      const a = rnd() * Math.PI * 2;
      _v.set(Math.cos(a) * (0.5 + 1.5 * rnd()) * sk, (0.6 + 1.6 * rnd()) * sk, Math.sin(a) * (0.5 + 1.5 * rnd()) * sk);
      _p.set(at.x + Math.cos(a) * r0 * 0.6, at.y + 0.3 + 0.6 * rnd() * sk, at.z + Math.sin(a) * r0 * 0.6);
      this.mist.emit({ pos: _p, vel: _v, life: 1.4 + 1.4 * rnd(), size: (0.8 + 1.2 * rnd()) * (0.6 + 0.5 * sk) * r0, grow: 0.8 + 0.6 * rnd(), color: MIST, alpha: 0.32 });
    }
    // the ring: the oldest gives way
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x: at.x, y: at.y, z: at.z, age: 0, k, r0 });
  }

  /** The ripple ring's front radius (m), strength and life (s) at an age. */
  ring(r: Ripple): { radius: number; strength: number; life: number; width: number; foam: number } {
    const sk = Math.sqrt(r.k);
    const life = this.t.ringLife * (0.7 + 0.5 * sk);
    const f = Math.min(1, r.age / life);
    return {
      radius: r.r0 * 0.6 + this.t.ringSpeed * (0.8 + 0.3 * sk) * r.age,
      strength: Math.min(1.2, 0.35 + 0.6 * sk) * (1 - f) * (1 - f),
      life,
      width: 0.35 + 0.18 * r.age + 0.1 * r.r0,
      foam: Math.min(1, 0.5 + 0.4 * r.k) * Math.max(0, 1 - r.age / (0.9 + 0.5 * sk)),
    };
  }

  update(dt: number, camera?: THREE.PerspectiveCamera, viewportHeight?: number): void {
    if (camera && viewportHeight) {
      this.spray.setView(camera, viewportHeight);
      this.mist.setView(camera, viewportHeight);
    }
    this.spray.update(dt);
    this.mist.update(dt);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age > this.ring(r).life) this.ripples.splice(i, 1);
    }
    const f = this.force;
    if (!f) return;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = this.ripples[i];
      if (!r) {
        f.uForceRippleS.value[i].set(0, 1, 0, 0);
        continue;
      }
      const g = this.ring(r);
      f.uForceRipple.value[i].set(r.x, r.y, r.z, g.radius);
      f.uForceRippleS.value[i].set(g.strength, g.width, g.foam, 0);
    }
  }

  dispose(): void {
    this.spray.dispose();
    this.mist.dispose();
  }
}
