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

export const GOLDEN_SKY: SkyParams = {
  turbidity: 3.5, rayleigh: 1.8, mieCoefficient: 0.004, mieDirectionalG: 0.8,
  cloudCoverage: 0.32, cloudDensity: 0.4, cloudElevation: 0.55, exposure: 0.5,
};

const OUT_ANCHOR = 'gl_FragColor = vec4( texColor, 1.0 );';
const UNIFORM_ANCHOR = 'uniform float time;';

function makeSky(p: SkyParams): Sky {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const mat = sky.material;
  mat.uniforms.skyExposure = { value: p.exposure };
  const before = mat.fragmentShader;
  mat.fragmentShader = before
    .replace(UNIFORM_ANCHOR, `${UNIFORM_ANCHOR}\nuniform float skyExposure;`)
    .replace(OUT_ANCHOR, 'gl_FragColor = vec4( texColor * skyExposure, 1.0 );');
  if (!mat.fragmentShader.includes('texColor * skyExposure') || !mat.fragmentShader.includes('uniform float skyExposure;')) {
    console.error('[sky] exposure patch anchor missing — sky exposure NOT applied');
  }
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
    scene.add(this.sky);
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
