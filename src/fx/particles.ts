import * as THREE from 'three';

export interface ParticleOptions {
  capacity: number;
  /** Additive (sparks, flashes) or normal alpha blending (smoke). */
  additive: boolean;
  /** Screen-size cap in pixels: particles never become big discs close to the camera (the old "snow" motes). */
  maxPixels: number;
  /** Distance fade (m): full at fadeNear, gone at fadeFar. */
  fadeNear: number;
  fadeFar: number;
  gravity: number;
  /** Velocity damping (1/s). */
  drag: number;
}

export interface ParticleEmit {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly life: number;
  /** World size (m) at birth and its growth (m/s). */
  readonly size: number;
  readonly grow: number;
  readonly color: THREE.Color;
  readonly alpha: number;
}

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
uniform float uMaxPx;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.01);
  gl_PointSize = min(aSize * uScale / dist, uMaxPx);
  vColor = vec4(aColor.rgb, aColor.a * (1.0 - smoothstep(uFadeNear, uFadeFar, dist)));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vColor.a * (1.0 - smoothstep(0.35, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/**
 * A small CPU particle pool drawn as one THREE.Points: soft discs, size-capped in pixels and distance-faded (spec §7.9,
 * §12). Live particles are packed at the front of the buffers; `update` integrates gravity and drag, ages, fades
 * (alpha falls with age) and grows them. Transparent and depth-write off, so N8AO's transparency-aware pass keeps
 * them out of its depth/normal prepass (spec §4.6).
 */
export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  count = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly grow: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geo = new THREE.BufferGeometry();

  constructor(private readonly o: ParticleOptions) {
    const n = o.capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      name: o.additive ? 'fx-particles-add' : 'fx-particles',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uMaxPx: { value: o.maxPixels }, uFadeNear: { value: o.fadeNear }, uFadeFar: { value: o.fadeFar } },
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(e: ParticleEmit): void {
    if (this.count >= this.o.capacity) return;
    const i = this.count++;
    this.pos.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    this.vel.set([e.vel.x, e.vel.y, e.vel.z], i * 3);
    this.col.set([e.color.r, e.color.g, e.color.b, e.alpha], i * 4);
    this.size[i] = e.size;
    this.grow[i] = e.grow;
    this.alpha[i] = e.alpha;
    this.age[i] = 0;
    this.life[i] = e.life;
  }

  /** Pixels per metre at 1 m from the camera (viewport height / (2·tan(fov/2))). */
  setView(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  update(dt: number): void {
    const damp = Math.exp(-this.o.drag * dt);
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const p = i * 3;
      this.vel[p] *= damp;
      this.vel[p + 1] = this.vel[p + 1] * damp - this.o.gravity * dt;
      this.vel[p + 2] *= damp;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.alpha[i] * (1 - f) * (1 - f);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const name of ['position', 'aColor', 'aSize']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }

  /** Move the last live particle into slot i. */
  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.size[i] = this.size[j];
    this.grow[i] = this.grow[j];
    this.alpha[i] = this.alpha[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
  }
}
