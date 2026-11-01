import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { CollisionWorld } from '../world/collision';
import type { MotionTuning } from '../characters/dragon/motion/tuning';
import type { PlasmaShot } from '../characters/dragon/actions/plasma';
import { mulberry32 } from '../core/rng';
import { Particles } from './particles';

export interface PlasmaFxOptions {
  world: CollisionWorld;
  cfg: MotionTuning['plasma'];
  /** The app material pipeline (fog + CSM) for the lit scorch material. */
  prepare?: (m: THREE.Material) => void;
  /** Camera shake at an impact (amplitude m, duration s) — OrbitCamera.shake. */
  shake?: (amplitude: number, duration: number) => void;
  /** Every impact, with the surface normal there and its power (the game publishes it as a world `blast`). */
  onImpact?: (point: THREE.Vector3, normal: THREE.Vector3, power: number) => void;
  seed?: number;
}

/** Visual constants (not motion): linear HDR colours above 1 bloom (spec §4.2). */
const FX = {
  core: new THREE.Color(0.55, 0.85, 3.6), glow: new THREE.Color(0.35, 0.6, 1.8), trail: new THREE.Color(0.3, 0.55, 2.2),
  light: new THREE.Color(0.45, 0.65, 1.0), spark: new THREE.Color(0.8, 0.9, 2.4), smoke: new THREE.Color(0.14, 0.14, 0.16),
  coreRadius: 0.13, glowSize: 1.2, trailPoints: 18, trailSpacing: 0.28, trailWidth: 0.22, lightIntensity: 9, lightDistance: 16,
  flashSize: 3.6, flashMinAngle: 0.05, flashTime: 0.14, impactLight: 40, impactLightTime: 0.3, sparkCount: 36, smokeCount: 9, scorchSize: 1.8, scorchLife: 30,
  maxDecals: 12, maxPatchTris: 2000,
  /** Bolts in flight at once (a long shot from altitude is in the air for seconds); only the newest `lights` carry one. */
  bolts: 8, lights: 2,
};

/**
 * Soft round falloff, procedural (no image loading). Glow/flash sprites (rng null): white, the falloff in alpha. The
 * scorch (rng given): an alphaMap, which three.js reads from the GREEN channel — so the falloff goes into RGB too.
 */
function radialTexture(size: number, rng: (() => number) | null): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      let a = Math.max(0, 1 - r);
      a = a * a * (3 - 2 * a);
      if (rng) a *= 0.65 + 0.35 * rng();                // a blotchy scorch edge
      const i = (y * size + x) * 4;
      const v = Math.round(255 * Math.min(1, a * (rng ? 1.4 : 1)));
      data[i] = data[i + 1] = data[i + 2] = rng ? v : 255;
      data[i + 3] = v;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  return t;
}

const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

interface Bolt {
  alive: boolean;
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  speed: number;
  traveled: number;
  /** The shot's power (1 = the standard blast). */
  power: number;
  /** Its visual size (× the standard bolt). */
  scale: number;
  /** Fire order (the newest bolts keep the lights). */
  seq: number;
  readonly history: THREE.Vector3[];
  readonly core: THREE.Mesh;
  readonly glow: THREE.Sprite;
  readonly trail: THREE.Mesh;
  light: THREE.PointLight | null;
}

interface Flash {
  readonly sprite: THREE.Sprite;
  readonly light: THREE.PointLight;
  t: number;
  /** World size this flash grows to (larger than flashSize far away, see explode). */
  size: number;
  /** Peak light intensity and how long the light (s) and the sprite (s) last: all grow with the blast's power. */
  light0: number;
  lightTime: number;
  spriteTime: number;
}

/**
 * How a blast's power reads (1 = the standard shot): the bolt's size, the flash's size, light and duration, the
 * sparks, smoke and scorch, and the shake. Sub-linear in power, so a quick shot (0.6) still reads and a full charge
 * (2.6) is unmistakably bigger without whiting out the screen.
 */
export function blastLook(power: number): { bolt: number; flash: number; light: number; time: number; sparks: number; smoke: number; scorch: number; shake: number } {
  const p = Math.max(0.05, power);
  return {
    bolt: p ** 0.6, flash: p ** 0.85, light: p, time: p ** 0.5, sparks: p, smoke: p ** 0.9, scorch: p ** 0.75, shake: p ** 0.8,
  };
}

interface Scorch {
  readonly mesh: THREE.Mesh;
  age: number;
}

const _next = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _n = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Plasma bolts and impacts (spec §6.13): a hot core, a glow sprite and a fading ribbon trail, carrying a moving
 * light; at the first hit (a sphere cast against the collision world each frame) a flash, sparks, smoke, a projected
 * scorch decal and a small camera shake. The two bolt lights and the flash light exist from the start with zero
 * intensity, so firing never changes the scene's light count (no shader recompiles): up to FX.bolts bolts fly at once
 * (a shot from altitude is in the air for seconds) and the two newest carry the lights. Each bolt flies at its shot's
 * speed (the muzzle speed plus the body's along the ray, from the wing) up to boltRange. Bolts, flashes and decals are
 * pooled. Runs per rendered frame; `fire` takes the shots PlasmaAction pushes.
 */
export class PlasmaFx {
  readonly root = new THREE.Group();
  impacts = 0;
  readonly sparks: Particles;
  readonly smoke: Particles;
  private readonly bolts: Bolt[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private seq = 0;
  private readonly flash: Flash;
  private readonly scorches: Scorch[] = [];
  private readonly scorchMaterial: THREE.MeshStandardMaterial;
  private readonly glowTex = radialTexture(64, null);
  private readonly scorchTex: THREE.DataTexture;
  private readonly rng: () => number;
  private readonly camPos = new THREE.Vector3();
  /** The long fire's glow at his mouth while he charges, and the sparks it draws in. */
  private readonly charge: { sprite: THREE.Sprite; at: THREE.Vector3; glow: number; level: number; acc: number };

  constructor(private readonly o: PlasmaFxOptions) {
    this.root.name = 'PlasmaFx';
    this.rng = mulberry32(o.seed ?? 99);
    this.scorchTex = radialTexture(64, this.rng);
    for (let k = 0; k < FX.bolts; k++) this.bolts.push(this.makeBolt());
    for (let k = 0; k < FX.lights; k++) {
      const light = new THREE.PointLight(FX.light, 0, FX.lightDistance, 2);
      this.lights.push(light);
      this.root.add(light);
    }
    const flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: FX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.flash = {
      sprite: new THREE.Sprite(flashMat), light: new THREE.PointLight(FX.light, 0, FX.lightDistance * 1.5, 2), t: 1, size: FX.flashSize,
      light0: FX.impactLight, lightTime: FX.impactLightTime, spriteTime: FX.flashTime,
    };
    this.flash.sprite.visible = false;
    this.root.add(this.flash.sprite, this.flash.light);
    const chargeMat = new THREE.SpriteMaterial({ map: this.glowTex, color: FX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.charge = { sprite: new THREE.Sprite(chargeMat), at: new THREE.Vector3(), glow: 0, level: 0, acc: 0 };
    this.charge.sprite.visible = false;
    this.root.add(this.charge.sprite);
    this.sparks = new Particles({ capacity: 256, additive: true, maxPixels: 10, fadeNear: 30, fadeFar: 90, gravity: 9.81, drag: 1.2 });
    this.smoke = new Particles({ capacity: 64, additive: false, maxPixels: 220, fadeNear: 25, fadeFar: 110, gravity: -0.4, drag: 0.8 });
    this.root.add(this.sparks.points, this.smoke.points);
    this.scorchMaterial = new THREE.MeshStandardMaterial({
      name: 'fx-scorch', color: 0x060505, roughness: 1, transparent: true, depthWrite: false, alphaMap: this.scorchTex,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    o.prepare?.(this.scorchMaterial);
  }

  get flying(): number {
    return this.bolts.filter((b) => b.alive).length;
  }

  get decals(): number {
    return this.scorches.length;
  }

  fire(shot: PlasmaShot): void {
    const oldest = (list: Bolt[]) => list.reduce((a, x) => (x.seq < a.seq ? x : a));
    const b = this.bolts.find((x) => !x.alive) ?? oldest(this.bolts);
    if (b.alive) this.retire(b);
    b.alive = true;
    b.pos.copy(shot.from);
    b.dir.copy(shot.dir).normalize();
    b.speed = shot.speed ?? this.o.cfg.boltSpeed;
    b.traveled = 0;
    b.power = shot.power ?? 1;
    b.scale = blastLook(b.power).bolt;
    b.core.scale.setScalar(b.scale);
    b.glow.scale.set(FX.glowSize * b.scale, FX.glowSize * b.scale, 1);
    b.seq = ++this.seq;
    // a light for it: a free one, else the oldest lit bolt's
    const free = this.lights.find((l) => !this.bolts.some((x) => x.light === l));
    if (free) b.light = free;
    else {
      const lit = oldest(this.bolts.filter((x) => x.light && x !== b));
      b.light = lit.light;
      lit.light = null;
    }
    for (const h of b.history) h.copy(shot.from);
    b.core.visible = b.glow.visible = b.trail.visible = true;
  }

  /**
   * The charge at his mouth, each rendered frame: `at` the muzzle (null: not charging), `glow` the dorsal plates' glow
   * (PlasmaAction.glow: it sets the brightness and pulses with them), `level` the long fire's charge (0…1: the size,
   * and past ~0.15 sparks drawn in toward the mouth).
   */
  charging(at: THREE.Vector3 | null, glow: number, level: number): void {
    const ch = this.charge;
    ch.glow = at ? glow : 0;
    ch.level = at ? level : 0;
    if (!at) {
      ch.sprite.visible = false;
      return;
    }
    ch.at.copy(at);
    const size = 0.18 + 0.12 * glow + 0.7 * level;
    ch.sprite.position.copy(at);
    ch.sprite.scale.set(size, size, 1);
    (ch.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + 0.4 * glow);
    ch.sprite.visible = glow > 0.02;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const c = this.o.cfg;
    camera.getWorldPosition(this.camPos);
    const ch = this.charge;
    if (ch.level > 0.15) {
      // sparks streaming in toward the mouth, faster and thicker as the charge fills
      ch.acc += dt * 70 * ch.level;
      for (; ch.acc >= 1; ch.acc--) {
        const r = 0.7 + 0.8 * this.rng();
        const dir = this.hemisphere(_n.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize());
        const life = 0.16 + 0.1 * this.rng();
        const from = _hitPos.copy(ch.at).addScaledVector(dir, r);
        this.sparks.emit({ pos: from, vel: dir.multiplyScalar(-r / life), life, size: 0.035, grow: 0, color: FX.spark, alpha: 0.9 });
      }
    } else ch.acc = 0;
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const step = b.speed * dt;
      _next.copy(b.pos).addScaledVector(b.dir, step);
      const t = this.o.world.sphereCast(b.pos, _next, c.boltRadius);
      if (t < 1) {
        _hitPos.copy(b.pos).lerp(_next, t);
        this.impact(b, _hitPos);
        continue;
      }
      b.pos.copy(_next);
      b.traveled += step;
      if (b.traveled > c.boltRange) {
        this.retire(b);
        continue;
      }
      this.placeBolt(b);
    }
    // the impact flash and its light fade fast
    const f = this.flash;
    if (f.t < 1) {
      f.t = Math.min(1, f.t + dt / f.lightTime);
      const k = 1 - f.t;
      f.light.intensity = f.light0 * k * k;
      const s = f.size * (0.4 + 0.6 * Math.min(1, f.t * f.lightTime / f.spriteTime));
      f.sprite.scale.set(s, s, 1);
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - (f.t * f.lightTime) / f.spriteTime);
      f.sprite.visible = f.t * f.lightTime < f.spriteTime;
    }
    for (let k = this.scorches.length - 1; k >= 0; k--) {
      const s = this.scorches[k];
      s.age += dt;
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.92 * (1 - smooth(Math.max(0, s.age - FX.scorchLife * 0.6) / (FX.scorchLife * 0.4)));
      if (s.age > FX.scorchLife) this.dropScorch(k);
    }
    this.sparks.setView(camera, viewportHeight);
    this.smoke.setView(camera, viewportHeight);
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  dispose(): void {
    for (const b of this.bolts) {
      b.core.geometry.dispose();
      (b.core.material as THREE.Material).dispose();
      (b.glow.material as THREE.Material).dispose();
      b.trail.geometry.dispose();
      (b.trail.material as THREE.Material).dispose();
    }
    (this.flash.sprite.material as THREE.Material).dispose();
    (this.charge.sprite.material as THREE.Material).dispose();
    while (this.scorches.length) this.dropScorch(0);
    this.scorchMaterial.dispose();
    this.glowTex.dispose();
    this.scorchTex.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
    this.root.removeFromParent();
  }

  private makeBolt(): Bolt {
    const core = new THREE.Mesh(new THREE.SphereGeometry(FX.coreRadius, 16, 12), new THREE.MeshBasicMaterial({ color: FX.core, fog: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: FX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.scale.set(FX.glowSize, FX.glowSize, 1);
    const n = FX.trailPoints;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const alpha = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) alpha[k * 2] = alpha[k * 2 + 1] = (1 - k / (n - 1)) ** 1.5;
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let k = 0; k < n - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    g.setIndex(idx);
    const trail = new THREE.Mesh(g, new THREE.ShaderMaterial({
      name: 'fx-plasma-trail', vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: { uColor: { value: FX.trail } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    trail.frustumCulled = false;
    core.visible = glow.visible = trail.visible = false;
    this.root.add(core, glow, trail);
    return {
      alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, traveled: 0, power: 1, scale: 1, seq: 0,
      history: Array.from({ length: n }, () => new THREE.Vector3()), core, glow, trail, light: null,
    };
  }

  private placeBolt(b: Bolt): void {
    b.core.position.copy(b.pos);
    b.glow.position.copy(b.pos);
    if (b.light) {
      b.light.position.copy(b.pos);
      b.light.intensity = FX.lightIntensity;
    }
    // history: the head moves with the bolt; older points are kept trailSpacing apart
    const h = b.history;
    h[0].copy(b.pos);
    for (let k = 1; k < h.length; k++) {
      _seg.subVectors(h[k], h[k - 1]);
      const d = _seg.length();
      if (d > FX.trailSpacing) h[k].copy(h[k - 1]).addScaledVector(_seg, FX.trailSpacing / d);
    }
    const pos = b.trail.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < h.length; k++) {
      _seg.subVectors(h[Math.max(0, k - 1)], h[Math.min(h.length - 1, k + 1)]);
      _toCam.subVectors(this.camPos, h[k]);
      _side.crossVectors(_seg, _toCam).normalize().multiplyScalar(FX.trailWidth * b.scale * (1 - k / h.length));
      _v.copy(h[k]).add(_side);
      pos.setXYZ(k * 2, _v.x, _v.y, _v.z);
      _v.copy(h[k]).sub(_side);
      pos.setXYZ(k * 2 + 1, _v.x, _v.y, _v.z);
    }
    pos.needsUpdate = true;
  }

  private retire(b: Bolt): void {
    b.alive = false;
    b.core.visible = b.glow.visible = b.trail.visible = false;
    if (b.light) b.light.intensity = 0;
    b.light = null;
  }

  private impact(b: Bolt, at: THREE.Vector3): void {
    const hit = this.o.world.closestPoint(at, this.o.cfg.boltRadius * 3);
    this.retire(b);
    this.explode(at, hit ? hit.normal : b.dir.clone().negate(), b.power);
  }

  /**
   * A plasma explosion at `at` (flash, light, sparks, smoke, scorch, shake, onImpact) — a bolt's impact, or any blast.
   * `power` (1 = the standard shot) scales all of it (blastLook) and is passed on to onImpact.
   */
  explode(at: THREE.Vector3, normal: THREE.Vector3, power = 1): void {
    this.impacts++;
    _n.copy(normal).normalize();
    const look = blastLook(power);
    const f = this.flash;
    f.t = 0;
    f.light0 = FX.impactLight * look.light;
    f.lightTime = FX.impactLightTime * look.time;
    f.spriteTime = FX.flashTime * look.time;
    f.sprite.position.copy(at).addScaledVector(_n, 0.2);
    f.light.position.copy(at).addScaledVector(_n, 0.5);
    f.sprite.visible = true;
    // an air-to-ground hit is often 50-200 m away: the flash keeps a minimum angular size (~3°) so it still reads,
    // and the shake falls off with the square root of the distance rather than linearly
    const dist = this.camPos.distanceTo(at);
    f.size = Math.max(FX.flashSize, dist * FX.flashMinAngle) * look.flash;
    const sparkV = Math.sqrt(look.flash);
    for (let k = 0; k < Math.round(FX.sparkCount * look.sparks); k++) {
      const v = this.hemisphere(_n).multiplyScalar((4 + 7 * this.rng()) * sparkV);
      this.sparks.emit({ pos: at, vel: v, life: 0.35 + 0.55 * this.rng(), size: 0.05, grow: 0, color: FX.spark, alpha: 1 });
    }
    for (let k = 0; k < Math.round(FX.smokeCount * look.smoke); k++) {
      const v = this.hemisphere(_n).multiplyScalar((0.4 + 0.8 * this.rng()) * sparkV);
      this.smoke.emit({ pos: _v.copy(at).addScaledVector(_n, 0.15), vel: v, life: (1.4 + 1.2 * this.rng()) * look.time, size: 0.5 * look.scorch, grow: 0.9, color: FX.smoke, alpha: 0.55 });
    }
    this.placeScorch(at, _n, look.scorch);
    this.o.shake?.(this.o.cfg.shake * look.shake / Math.max(1, Math.sqrt(dist / 12)), this.o.cfg.shakeTime * look.time);
    this.o.onImpact?.(at, _n, power);
  }

  private hemisphere(n: THREE.Vector3): THREE.Vector3 {
    for (;;) {
      _v.set(this.rng() * 2 - 1, this.rng() * 2 - 1, this.rng() * 2 - 1);
      const l = _v.lengthSq();
      if (l > 1e-4 && l <= 1) break;
    }
    _v.normalize();
    if (_v.dot(n) < 0) _v.addScaledVector(n, -2 * _v.dot(n));
    return _v.clone().addScaledVector(n, 0.6).normalize();
  }

  /**
   * The collision triangles near an impact as a throwaway world-space mesh (at most FX.maxPatchTris), so a scorch
   * costs the same on a 50k-triangle terrain chunk as on a lab box: DecalGeometry walks every triangle it is given.
   */
  private patch(at: THREE.Vector3, halfSize: number): THREE.Mesh | null {
    _box.setFromCenterAndSize(at, _size.setScalar(2 * halfSize));
    const pos = this.o.world.trianglesInBox(_box, FX.maxPatchTris, []);
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g);
  }

  private placeScorch(at: THREE.Vector3, n: THREE.Vector3, scale = 1): void {
    let mesh: THREE.Mesh;
    const size = FX.scorchSize * scale * (0.8 + 0.4 * this.rng());
    _q.setFromUnitVectors(Z, n).multiply(new THREE.Quaternion().setFromAxisAngle(Z, this.rng() * Math.PI * 2));
    const local = this.patch(at, size * 0.75);
    if (local) {
      const g = new DecalGeometry(local, at, new THREE.Euler().setFromQuaternion(_q), new THREE.Vector3(size, size, 1));
      local.geometry.dispose();
      mesh = new THREE.Mesh(g, this.scorchMaterial.clone());
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.scorchMaterial.clone());
      mesh.position.copy(at).addScaledVector(n, 0.01);
      mesh.quaternion.copy(_q);
    }
    this.o.prepare?.(mesh.material as THREE.Material);
    mesh.name = 'fx-scorch';
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.scorches.push({ mesh, age: 0 });
    if (this.scorches.length > FX.maxDecals) this.dropScorch(0);
  }

  private dropScorch(k: number): void {
    const s = this.scorches[k];
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    this.scorches.splice(k, 1);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
