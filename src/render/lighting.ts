import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { QualityPreset } from './quality';
import { sunDirection } from './sun';
import { adoptBaseCompileHook, releaseBaseCompileHook } from './materials';

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

/** Core lights_fragment_begin as three ships it — captured before any CSM swaps in its own copy. */
const CORE_LIGHTS_FRAGMENT_BEGIN = THREE.ShaderChunk.lights_fragment_begin;
const DIRECT_LIGHT_ANCHOR = 'IncidentLight directLight;';

/**
 * three r186's CSM addon installs its own lights_fragment_begin (CSMShader, on every CSM
 * construction), copied from an older core chunk. It lacks core's `#ifdef STANDARD` block that
 * initialises material.dfg (DFG LUT) and material.multiScatteringCompensation, so every CSM-lit
 * Standard/Physical material reads garbage there: IBL specular goes black (the mirror swatch
 * rendered ~0.01 under a ~1.0 sky) and sun highlights break. Splice core's block back in ahead of
 * the direct-light loops. A no-op once the installed chunk already has it (fixed upstream, or
 * repaired by an earlier rig).
 */
function repairCsmLightsChunk(): void {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes('material.dfg')) return;
  const start = CORE_LIGHTS_FRAGMENT_BEGIN.indexOf('#ifdef STANDARD');
  const end = CORE_LIGHTS_FRAGMENT_BEGIN.indexOf(DIRECT_LIGHT_ANCHOR);
  const block = start >= 0 && end > start ? CORE_LIGHTS_FRAGMENT_BEGIN.slice(start, end) : '';
  if (!block.includes('material.dfg') || !C.lights_fragment_begin.includes(DIRECT_LIGHT_ANCHOR)) {
    console.error('[lighting] CSM lights-chunk repair anchors missing — PBR specular (IBL, sun highlights) will be wrong');
    return;
  }
  C.lights_fragment_begin = C.lights_fragment_begin.replace(DIRECT_LIGHT_ANCHOR, () => `${block}${DIRECT_LIGHT_ANCHOR}`);
}

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
    repairCsmLightsChunk(); // the CSM constructor just (re)installed its outdated lights chunk
    this.csm.fade = true; // must be set before any setupMaterial call
    for (const l of this.csm.lights) {
      l.color.set(params.sunColor);
      l.shadow.normalBias = 0.03;
      // A 14° sun stretches each shadow texel ~4x along the ground (1/sin 14°), so r186's 1-texel
      // PCF shows stair-steps on shadow edges; 2 texels hides them and stays crisp.
      l.shadow.radius = 2;
    }
    this.hemi = new THREE.HemisphereLight(params.skyColor, params.groundColor, params.hemiIntensity);
    scene.add(this.hemi); // exempt from the material pipeline — a light has no material, and needs neither CSM nor Berk fog
  }

  setupMaterial(m: THREE.Material): void {
    if (!isLit(m)) return;
    this.csm.setupMaterial(m); // assigns onBeforeCompile directly, clobbering any composed hooks
    adoptBaseCompileHook(m); // ...so fold that assignment back in as the base, whichever ran first
  }

  /**
   * Undo setupMaterial for one material. CSM keeps every material it set up in its `shaders` map
   * (and re-uniforms each on every updateFrustums), so a removed asset would otherwise stay reachable
   * forever. Its CSM defines go, and CSM's onBeforeCompile is dropped from under the composed hooks,
   * which keep working (fog, wind, ...). No-op for a material CSM never set up. App.remove calls this
   * for every material under the removed root; dispose() for every material still registered.
   */
  releaseMaterial(m: THREE.Material): void {
    // CSM.shaders is mistyped in @types/three (see dispose()); at runtime its keys are Materials.
    if (!this.csm.shaders.has(m)) return;
    this.csm.shaders.delete(m);
    // CSM assigned its handler as an own property. With no composed hooks it is still there: delete
    // it (back to the prototype no-op). With hooks, releaseBaseCompileHook reinstalls our wrapper,
    // now without a base.
    delete (m as unknown as { onBeforeCompile?: unknown }).onBeforeCompile;
    releaseBaseCompileHook(m);
    const defines = (m as THREE.Material & { defines?: Record<string, unknown> }).defines;
    if (defines) {
      delete defines.USE_CSM;
      delete defines.CSM_CASCADES;
      delete defines.CSM_FADE;
    }
    m.needsUpdate = true;
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
    // @types/three mistypes CSM.shaders as Map<unknown, string>; at runtime (CSM.js) the keys are
    // exactly the Materials setupMaterial() was called on. Release each one ourselves first: left to
    // csm.dispose(), it does `delete material.onBeforeCompile`, which by now deletes OUR wrapper (not
    // CSM's own assignment) and would silently strip every other composed hook (fog, wind, ...) too.
    for (const m of [...this.csm.shaders.keys()] as THREE.Material[]) this.releaseMaterial(m);
    this.csm.remove();
    this.csm.dispose(); // its material map is empty by now
    this.hemi.removeFromParent();
  }
}
