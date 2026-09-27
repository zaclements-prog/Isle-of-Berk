import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
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
});
