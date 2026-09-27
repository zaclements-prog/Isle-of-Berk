import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import * as CSMShaderModule from 'three/addons/csm/CSMShader.js';
import { LightingRig } from '../../src/render/lighting';
import { applyBerkFog } from '../../src/render/fog';
import { PRESETS } from '../../src/render/quality';
import type { ShaderParams } from '../../src/render/materials';

// CSM's constructor only does light creation + frustum/matrix maths (no WebGL), so LightingRig
// constructs fine against a real THREE.Scene/PerspectiveCamera in a plain Node environment.
const fakeRenderer = {} as THREE.WebGLRenderer;
const stubShader = () => ({ uniforms: {}, vertexShader: '', fragmentShader: '' }) as unknown as ShaderParams;

function buildRig() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return new LightingRig(scene, camera, PRESETS.low);
}

describe('LightingRig', () => {
  it('composes CSM and Berk fog on one material regardless of setup order', () => {
    const rig = buildRig();
    const m = new THREE.MeshStandardMaterial();
    applyBerkFog(m); // fog hook composed first
    rig.setupMaterial(m); // CSM.setupMaterial assigns onBeforeCompile directly, second
    const shader = stubShader();
    m.onBeforeCompile(shader, fakeRenderer);
    expect(shader.uniforms.CSM_cascades).toBeDefined();
    expect(shader.uniforms.berkFogColor).toBeDefined();
  });

  it('releaseMaterial() drops a material from CSM (map, defines, base hook) but keeps its fog hook', () => {
    const rig = buildRig();
    const m = new THREE.MeshStandardMaterial();
    rig.setupMaterial(m);
    applyBerkFog(m);
    const version = m.version;
    rig.releaseMaterial(m);
    expect(rig.csm.shaders.has(m)).toBe(false);
    const defines = (m as unknown as { defines: Record<string, unknown> }).defines;
    expect(defines.USE_CSM).toBeUndefined();
    expect(defines.CSM_CASCADES).toBeUndefined();
    expect(defines.CSM_FADE).toBeUndefined();
    expect(defines.BERK_FOG).toBe('');
    expect(m.version).toBeGreaterThan(version); // needsUpdate → recompiled without CSM
    const shader = stubShader();
    m.onBeforeCompile(shader, fakeRenderer);
    expect(shader.uniforms.berkFogColor).toBeDefined();
    expect(shader.uniforms.CSM_cascades).toBeUndefined();
  });

  it('releaseMaterial() restores the default onBeforeCompile when CSM was the only patch', () => {
    const rig = buildRig();
    const m = new THREE.MeshStandardMaterial({ fog: false }); // applyBerkFog skips it: no composed hooks
    rig.setupMaterial(m);
    applyBerkFog(m);
    rig.releaseMaterial(m);
    expect(rig.csm.shaders.has(m)).toBe(false);
    expect(m.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it('releaseMaterial() leaves a material CSM never set up untouched', () => {
    const rig = buildRig();
    const m = new THREE.SpriteMaterial();
    applyBerkFog(m);
    const hook = m.onBeforeCompile;
    const version = m.version;
    rig.releaseMaterial(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.version).toBe(version);
  });

  it('dispose() removes CSM but leaves other composed hooks (e.g. fog) working', () => {
    const rig = buildRig();
    const m = new THREE.MeshStandardMaterial();
    rig.setupMaterial(m);
    applyBerkFog(m);
    rig.dispose();
    const shader = stubShader();
    m.onBeforeCompile(shader, fakeRenderer);
    expect(shader.uniforms.berkFogColor).toBeDefined();
    expect(shader.uniforms.CSM_cascades).toBeUndefined();
  });

  // three r186's CSM installs its own (older) lights_fragment_begin that lacks core's PBR DFG setup;
  // without it every CSM-lit Standard/Physical material has garbage specular (black mirror).
  it('keeps the PBR DFG setup in the lights chunk CSM installs, before the direct-light loops', () => {
    buildRig();
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(chunk).toContain('CSM_cascades'); // still CSM's cascade-aware chunk
    expect(chunk).toContain('material.dfg = texture2D( dfgLUT');
    expect(chunk).toContain('material.multiScatteringCompensation =');
    expect(chunk.indexOf('material.multiScatteringCompensation =')).toBeLessThan(chunk.indexOf('IncidentLight directLight;'));
  });

  it('repairs the CSM lights chunk exactly once however many rigs are built', () => {
    buildRig();
    buildRig(); // each CSM constructor re-installs its unrepaired chunk
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(chunk.split('material.dfg = texture2D').length - 1).toBe(1);
  });

  it('sets up MeshToonMaterial for CSM (unset, it would take every cascade light at full strength)', () => {
    const rig = buildRig();
    const m = new THREE.MeshToonMaterial();
    rig.setupMaterial(m);
    expect(rig.csm.shaders.has(m)).toBe(true);
  });

  it('skips CSM for an iridescent material and logs an error (CSM\'s chunk writes iridescenceF0)', () => {
    const rig = buildRig();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const m = new THREE.MeshPhysicalMaterial({ iridescence: 1 });
      rig.setupMaterial(m);
      expect(rig.csm.shaders.has(m)).toBe(false);
      expect((m as unknown as { defines?: Record<string, unknown> }).defines?.USE_CSM).toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      const plain = new THREE.MeshPhysicalMaterial(); // iridescence 0: set up as usual
      rig.setupMaterial(plain);
      expect(rig.csm.shaders.has(plain)).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it('dispose() frees every cascade light\'s shadow map', () => {
    const rig = buildRig();
    const maps = rig.csm.lights.map((l) => {
      l.shadow.map = new THREE.WebGLRenderTarget(1, 1); // the renderer allocates it on the first shadow pass
      return vi.spyOn(l.shadow.map, 'dispose');
    });
    rig.dispose();
    expect(maps.length).toBe(PRESETS.low.shadowCascades);
    for (const spy of maps) expect(spy).toHaveBeenCalledTimes(1);
  });
});

// Each CSM constructor installs CSMShader.lights_fragment_begin; mutating it simulates a three
// upgrade reaching repairCsmLightsChunk()'s guard paths.
describe('CSM lights-chunk repair guards', () => {
  // @types/three declares CSMShader as an interface only; at runtime the module exports the object.
  const csm = (CSMShaderModule as unknown as { CSMShader: { lights_fragment_begin: string } }).CSMShader;
  const ANCHOR = 'IncidentLight directLight;';

  function withChunk(chunk: (original: string) => string, check: (installed: string, error: ReturnType<typeof vi.spyOn>) => void) {
    const original = csm.lights_fragment_begin;
    const installedBefore = THREE.ShaderChunk.lights_fragment_begin;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const mutated = chunk(original);
      expect(mutated).not.toBe(original);
      csm.lights_fragment_begin = mutated;
      buildRig();
      check(mutated, error);
    } finally {
      csm.lights_fragment_begin = original;
      THREE.ShaderChunk.lights_fragment_begin = installedBefore;
      error.mockRestore();
    }
  }

  it('leaves the chunk untouched and logs an error when the splice anchor is missing', () => {
    withChunk((c) => c.replace(ANCHOR, 'IncidentLight  directLight;'), (installed, error) => {
      expect(THREE.ShaderChunk.lights_fragment_begin).toBe(installed);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });

  it('is a no-op (idempotent) once the installed chunk already sets material.dfg', () => {
    withChunk((c) => c.replace(ANCHOR, `/* material.dfg set up upstream */\n${ANCHOR}`), (installed, error) => {
      expect(THREE.ShaderChunk.lights_fragment_begin).toBe(installed);
      expect(error).not.toHaveBeenCalled();
    });
  });
});
