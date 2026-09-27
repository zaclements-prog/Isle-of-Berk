import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudElevation: number;
  /** Scales the sky's radiance (the Preetham model is far brighter than our lights). */
  exposure: number;
}

/**
 * exposure (tuned in M1 against the lit test scene, was 0.5): 0.15 keeps the open sky roughly level
 * with sunlit mid-grey diffuse (~0.17 under the 14° sun at intensity 3) away from the sun, rising to
 * ~0.93 in the aureole, so the IBL it bakes leaves ~1.7:1 sunlit:shadow on flat ground (deep but
 * open). At 0.5 the open sky sat at ~1.1–1.9, its fill swamped the low sun on flat ground, and most
 * of it would roll flat into the luminance ceiling below.
 */
export const GOLDEN_SKY: SkyParams = {
  turbidity: 3.5, rayleigh: 1.8, mieCoefficient: 0.004, mieDirectionalG: 0.8,
  cloudCoverage: 0.32, cloudDensity: 0.4, cloudElevation: 0.55, exposure: 0.15,
};

const OUT_ANCHOR = 'gl_FragColor = vec4( texColor, 1.0 );';
const UNIFORM_ANCHOR = 'uniform float time;';

/**
 * Soft luminance ceiling on the sky, just under the bloom threshold (1.0, see post.ts). A low sun's
 * aureole is physically several times brighter than sunlit diffuse white, so uncapped it floods the
 * bloom and veils the whole frame (measured in the M1 hero shot: a dark swatch in front of it went
 * from 95 to 209 of 255). The roll-off keeps hue, so the aureole stays warm instead of clipping to
 * white, and is continuous with slope 1 at the knee. The sun disc (~1e3-1e4, far above anything else
 * in the sky) passes through above SKY_DISC_START so it still reads hot and glints. The baked IBL
 * shares it (bakeEnvironment uses makeSky).
 */
const SKY_KNEE = 0.6;
const SKY_CEILING = 0.95;
const SKY_DISC_START = 100;

/** CPU mirror of the GLSL berkSkyCeiling() (tests + tools): scene-linear luminance in → out. */
export function skyCeilingLuminance(L: number): number {
  const range = SKY_CEILING - SKY_KNEE;
  const soft = L <= SKY_KNEE ? L : SKY_KNEE + range * (1 - Math.exp(-(L - SKY_KNEE) / range));
  return soft + Math.max(L - SKY_DISC_START, 0);
}

const glslFloat = (v: number) => v.toFixed(4);
const CEILING_GLSL = `
float berkSkyCeiling( float L ) {
  float range = ${glslFloat(SKY_CEILING - SKY_KNEE)};
  float soft = L <= ${glslFloat(SKY_KNEE)} ? L : ${glslFloat(SKY_KNEE)} + range * ( 1.0 - exp( - ( L - ${glslFloat(SKY_KNEE)} ) / range ) );
  return soft + max( L - ${glslFloat(SKY_DISC_START)}, 0.0 );
}`;
const OUT_GLSL = `vec3 berkSky = texColor * skyExposure;
			float berkL = dot( berkSky, vec3( 0.2126, 0.7152, 0.0722 ) );
			gl_FragColor = vec4( berkSky * ( berkSkyCeiling( berkL ) / max( berkL, 1e-6 ) ), 1.0 );`;

function makeSky(p: SkyParams): Sky {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const mat = sky.material;
  mat.uniforms.skyExposure = { value: p.exposure };
  const before = mat.fragmentShader;
  if (!before.includes(UNIFORM_ANCHOR) || !before.includes(OUT_ANCHOR)) {
    console.error('[sky] shader patch anchor missing — sky exposure and luminance ceiling NOT applied');
  }
  mat.fragmentShader = before
    .replace(UNIFORM_ANCHOR, () => `${UNIFORM_ANCHOR}\nuniform float skyExposure;\n${CEILING_GLSL}`)
    .replace(OUT_ANCHOR, () => OUT_GLSL);
  applySkyParams(sky, p);
  return sky;
}

function applySkyParams(sky: Sky, p: SkyParams): void {
  const u = sky.material.uniforms;
  u.turbidity.value = p.turbidity;
  u.rayleigh.value = p.rayleigh;
  u.mieCoefficient.value = p.mieCoefficient;
  u.mieDirectionalG.value = p.mieDirectionalG;
  u.cloudCoverage.value = p.cloudCoverage;
  u.cloudDensity.value = p.cloudDensity;
  u.cloudElevation.value = p.cloudElevation;
  u.skyExposure.value = p.exposure;
}

/** Physically based sky with clouds; also bakes the scene's image-based light from itself. */
export class SkySystem {
  readonly sky: Sky;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private params: SkyParams = GOLDEN_SKY,
  ) {
    this.sky = makeSky(params);
    scene.add(this.sky); // exempt from the material pipeline — the sky shader needs neither CSM nor Berk fog
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  setSun(dir: THREE.Vector3): void {
    this.sky.material.uniforms.sunPosition.value.copy(dir);
  }

  setParams(p: Partial<SkyParams>): void {
    this.params = { ...this.params, ...p };
    applySkyParams(this.sky, this.params);
  }

  /** Re-bake the image-based light from the current sky. Call after the sun or sky params change. */
  bakeEnvironment(intensity = 1): void {
    const envScene = new THREE.Scene();
    const s = makeSky(this.params);
    s.material.uniforms.sunPosition.value.copy(this.sky.material.uniforms.sunPosition.value);
    s.material.uniforms.showSunDisc.value = 0; // the CSM light is the sun; the disc would swamp the ambient
    envScene.add(s);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(envScene, 0, 0.1, 20000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = intensity;
    s.geometry.dispose();
    s.material.dispose();
  }

  update(time: number): void {
    this.sky.material.uniforms.time.value = time;
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
