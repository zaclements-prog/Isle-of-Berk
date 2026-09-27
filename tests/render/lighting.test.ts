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
});
