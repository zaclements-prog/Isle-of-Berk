import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { removeFromApp } from '../../src/app/createApp';
import { LightingRig } from '../../src/render/lighting';
import { applyBerkFog } from '../../src/render/fog';
import { createMaterialPipeline, type ShaderParams } from '../../src/render/materials';
import { PRESETS } from '../../src/render/quality';

// createApp itself needs a DOM and a WebGL context; its pieces are exported and tested here in plain
// Node, against a real Scene and LightingRig (CSM constructs without WebGL, see lighting.test.ts).
const stubShader = () => ({ uniforms: {}, vertexShader: '', fragmentShader: '' }) as unknown as ShaderParams;

describe('removeFromApp (App.remove)', () => {
  it('releases every material from CSM, keeps its fog hook, detaches root and frees its GPU resources', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene, new THREE.PerspectiveCamera(), PRESETS.low);
    const pipeline = createMaterialPipeline([(m) => rig.setupMaterial(m), applyBerkFog]);
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    pipeline.prepareTree(root);
    scene.add(root);
    expect(rig.csm.shaders.has(material)).toBe(true);
    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');

    removeFromApp(scene, rig, root);

    expect(rig.csm.shaders.has(material)).toBe(false);
    expect(root.parent).toBeNull();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    const shader = stubShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.berkFogColor).toBeDefined();
    expect(shader.uniforms.CSM_cascades).toBeUndefined();
  });
});
