import * as THREE from 'three';
import type { WorldEvents } from './events';

/** Most contact spheres (paws, body) and live shockwaves the shaders take at once. */
export const MAX_CONTACTS = 12;
export const MAX_SHOCKS = 4;

/** What the force field reads from the dragon each step (null when there is none). */
export interface ForceSource {
  /** Flying (the downwash and the wake are on only while airborne). */
  airborne: boolean;
  /** Chest position (world). */
  chest: THREE.Vector3;
  /** Velocity (m/s, world). */
  velocity: THREE.Vector3;
  /** Ground height under the chest (m). */
  ground: number;
  /** 0…1: how hard the wings are pushing air down right now (peaks mid-downstroke; a glide pushes a little). */
  wingPush: number;
}

export interface ForceFieldTuning {
  /** Downwash: disc radius (m), peak strength, the height above ground (m) where it has faded out. */
  downRadius: number;
  downStrength: number;
  downFadeHeight: number;
  /** Wake: radius (m) of the air he drags past the trees, strength at 15 m/s. */
  wakeRadius: number;
  wakeStrength: number;
  /** Shockwave: front speed (m/s), life (s), ring width (m), strength per unit blast power. */
  shockSpeed: number;
  shockLife: number;
  shockWidth: number;
  shockStrength: number;
}

export const DEFAULT_FORCE_TUNING: ForceFieldTuning = {
  downRadius: 12, downStrength: 1, downFadeHeight: 16,
  wakeRadius: 9, wakeStrength: 1,
  shockSpeed: 60, shockLife: 1.1, shockWidth: 3.5, shockStrength: 1,
};

/** The uniforms every reactive material shares (one object, assigned by reference into each material's hook). */
export interface ForceUniforms {
  uForceContacts: { value: THREE.Vector4[] };
  uForceContactsN: { value: number };
  /** Downwash: (ground point xyz, radius), strength. */
  uForceDown: { value: THREE.Vector4 };
  uForceDownS: { value: number };
  /** Wake: (chest xyz, radius), (heading x, z, strength, 0). */
  uForceWake: { value: THREE.Vector4 };
  uForceWakeDir: { value: THREE.Vector4 };
  /** Shocks: (centre xyz, front radius), (strength, ring width, 0, 0) each. */
  uForceShock: { value: THREE.Vector4[] };
  uForceShockS: { value: THREE.Vector4[] };
  uForceTime: { value: number };
}

/** GLSL declarations of the shared uniforms (paste into a vertex or fragment shader's preamble). */
export const FORCE_PARS = /* glsl */ `
uniform vec4 uForceContacts[${MAX_CONTACTS}];
uniform int uForceContactsN;
uniform vec4 uForceDown;
uniform float uForceDownS;
uniform vec4 uForceWake;
uniform vec4 uForceWakeDir;
uniform vec4 uForceShock[${MAX_SHOCKS}];
uniform vec4 uForceShockS[${MAX_SHOCKS}];
uniform float uForceTime;
// The horizontal push (xz) and the flattening (0…1) the field applies at a root on the ground at p.
vec3 forceAt(vec3 p) {
  vec2 push = vec2(0.0);
  float flat_ = 0.0;
  // downwash: outward from the point under him, strongest near it
  if (uForceDownS > 0.0) {
    vec2 d = p.xz - uForceDown.xz;
    float dist = length(d);
    float f = uForceDownS * (1.0 - smoothstep(0.0, uForceDown.w, dist)) * (1.0 - smoothstep(0.0, 6.0, abs(p.y - uForceDown.y)));
    // a pulse travelling out from the centre, so each downstroke reads as a gust spreading across the grass
    float wave = 0.6 + 0.4 * sin(dist * 0.9 - uForceTime * 9.0);
    push += (dist > 1e-3 ? d / dist : vec2(1.0, 0.0)) * f * wave;
    flat_ = max(flat_, f * 0.8);
  }
  // shockwaves: a ring racing outward from each blast
  for (int k = 0; k < ${MAX_SHOCKS}; k++) {
    float s = uForceShockS[k].x;
    if (s <= 0.0) continue;
    vec2 d = p.xz - uForceShock[k].xz;
    float dist = length(d);
    float band = exp(-pow((dist - uForceShock[k].w) / max(uForceShockS[k].y, 0.1), 2.0)) * s;
    push += (dist > 1e-3 ? d / dist : vec2(1.0, 0.0)) * band * 1.6;
    flat_ = max(flat_, band);
  }
  return vec3(push.x, flat_, push.y);
}
`;

interface Shock { x: number; y: number; z: number; t0: number; power: number }

/**
 * The air and contact forces the world's grass, trees and water react to (plan §2): the dragon's contact spheres (paws
 * and body part the grass), the downwash under his wings when he flies low (each downstroke a gust spreading out
 * across the ground, gone by ~a wingspan up), the wake he drags past the trees, and the shockwave rings his blasts
 * send out. Rewritten every step into one shared uniform object the materials read.
 */
export class ForceField {
  readonly uniforms: ForceUniforms = {
    uForceContacts: { value: Array.from({ length: MAX_CONTACTS }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
    uForceContactsN: { value: 0 },
    uForceDown: { value: new THREE.Vector4(0, -1e4, 0, 1) },
    uForceDownS: { value: 0 },
    uForceWake: { value: new THREE.Vector4(0, -1e4, 0, 1) },
    uForceWakeDir: { value: new THREE.Vector4() },
    uForceShock: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4()) },
    uForceShockS: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4()) },
    uForceTime: { value: 0 },
  };
  /** Spheres touching the world (paws, body), read every step. */
  readonly contacts: { center: THREE.Vector3; radius: number }[] = [];
  source: (() => ForceSource | null) | null = null;
  private readonly shocks: Shock[] = [];
  private readonly smoothed = { down: 0, wake: 0 };

  constructor(readonly t: ForceFieldTuning = DEFAULT_FORCE_TUNING, events?: WorldEvents) {
    events?.on('blast', (e) => this.addShock(e.point, e.power, e.time));
  }

  addShock(at: THREE.Vector3, power: number, time: number): void {
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push({ x: at.x, y: at.y, z: at.z, t0: time, power });
  }

  /** Current downwash strength (0…downStrength) — exposed for tests and FX. */
  get downwash(): number {
    return this.uniforms.uForceDownS.value;
  }

  update(time: number, dt: number): void {
    const t = this.t;
    const u = this.uniforms;
    u.uForceTime.value = time;
    const n = Math.min(MAX_CONTACTS, this.contacts.length);
    for (let k = 0; k < n; k++) u.uForceContacts.value[k].set(this.contacts[k].center.x, this.contacts[k].center.y, this.contacts[k].center.z, this.contacts[k].radius);
    u.uForceContactsN.value = n;
    const s = this.source?.() ?? null;
    let down = 0;
    let wake = 0;
    if (s && s.airborne) {
      const agl = Math.max(0, s.chest.y - s.ground);
      const low = 1 - THREE.MathUtils.smoothstep(agl, 1.5, t.downFadeHeight);
      down = t.downStrength * low * (0.25 + 0.75 * s.wingPush);
      const speed = Math.hypot(s.velocity.x, s.velocity.z);
      wake = t.wakeStrength * Math.min(1.5, speed / 15) * (1 - THREE.MathUtils.smoothstep(agl, 4, 24));
      u.uForceDown.value.set(s.chest.x + s.velocity.x * 0.15, s.ground, s.chest.z + s.velocity.z * 0.15, t.downRadius * (1 + 0.04 * agl));
      u.uForceWake.value.set(s.chest.x, s.chest.y, s.chest.z, t.wakeRadius);
      u.uForceWakeDir.value.set(speed > 0.1 ? s.velocity.x / speed : 0, speed > 0.1 ? s.velocity.z / speed : 0, 0, 0);
    }
    // ease the strengths so a landing or a climb out doesn't snap the grass
    const k = 1 - Math.exp(-dt * 8);
    this.smoothed.down += (down - this.smoothed.down) * k;
    this.smoothed.wake += (wake - this.smoothed.wake) * k;
    u.uForceDownS.value = this.smoothed.down < 1e-3 ? 0 : this.smoothed.down;
    u.uForceWakeDir.value.z = this.smoothed.wake < 1e-3 ? 0 : this.smoothed.wake;
    // shocks: the ring grows at shockSpeed and dies over shockLife
    for (let i = this.shocks.length - 1; i >= 0; i--) if (time - this.shocks[i].t0 > t.shockLife) this.shocks.splice(i, 1);
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const sh = this.shocks[i];
      if (!sh) {
        u.uForceShockS.value[i].set(0, 1, 0, 0);
        continue;
      }
      const age = time - sh.t0;
      u.uForceShock.value[i].set(sh.x, sh.y, sh.z, age * t.shockSpeed);
      u.uForceShockS.value[i].set(t.shockStrength * sh.power * (1 - age / t.shockLife) ** 2, t.shockWidth * (1 + age), 0, 0);
    }
  }
}
