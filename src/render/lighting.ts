import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { QualityPreset } from './quality';
import { sunDirection } from './sun';

export interface LightingParams {
  azimuth: number;
  elevation: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  skyColor: THREE.ColorRepresentation;
  groundColor: THREE.ColorRepresentation;
  hemiIntensity: number;
}

/** Late-afternoon golden hour, sun low in the west-northwest (spec §7.8). Tuned by eye. */
export const GOLDEN_HOUR: LightingParams = {
  azimuth: 292, elevation: 14, sunColor: 0xffc890, sunIntensity: 3.0,
  skyColor: 0xa9c8f0, groundColor: 0x4d5a36, hemiIntensity: 0.25,
};

const isLit = (m: THREE.Material) =>
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true;

/** Sun with cascaded shadow maps (crisp near, stable far) + a hemisphere fill. */
export class LightingRig {
  readonly csm: CSM;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    preset: QualityPreset,
    public params: LightingParams = GOLDEN_HOUR,
  ) {
    sunDirection(params.azimuth, params.elevation, this.sunDir);
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: preset.shadowCascades,
      maxFar: 250,
      mode: 'practical',
      shadowMapSize: preset.shadowMapSize,
      shadowBias: -0.00015,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: params.sunIntensity,
      lightNear: 1,
      lightFar: 1200,
      lightMargin: 150,
    });
    this.csm.fade = true; // must be set before any setupMaterial call
    for (const l of this.csm.lights) {
      l.color.set(params.sunColor);
      l.shadow.normalBias = 0.03;
    }
    this.hemi = new THREE.HemisphereLight(params.skyColor, params.groundColor, params.hemiIntensity);
    scene.add(this.hemi);
  }

  setupMaterial(m: THREE.Material): void {
    if (isLit(m)) this.csm.setupMaterial(m);
  }

  setSun(azimuth: number, elevation: number): void {
    this.params = { ...this.params, azimuth, elevation };
    sunDirection(azimuth, elevation, this.sunDir);
    this.csm.lightDirection.copy(this.sunDir).negate();
  }

  update(): void {
    this.csm.update();
  }

  onResize(): void {
    this.csm.updateFrustums();
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
    this.hemi.removeFromParent();
  }
}
