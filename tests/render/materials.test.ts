import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { addCompileHook, adoptBaseCompileHook, releaseBaseCompileHook, createMaterialPipeline, type ShaderParams } from '../../src/render/materials';

const fakeShader = () => ({ uniforms: {} }) as unknown as ShaderParams;
const fakeRenderer = {} as THREE.WebGLRenderer;

describe('addCompileHook', () => {
  it('runs hooks in registration order after a pre-existing onBeforeCompile', () => {
    const m = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    m.onBeforeCompile = () => { calls.push('original'); };
    addCompileHook(m, 'a', () => { calls.push('a'); });
    addCompileHook(m, 'b', () => { calls.push('b'); });
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(calls).toEqual(['original', 'a', 'b']);
  });

  it('includes hook keys in the program cache key', () => {
    const m = new THREE.MeshStandardMaterial();
    addCompileHook(m, 'fog', () => {});
    addCompileHook(m, 'wind', () => {});
    expect(m.customProgramCacheKey()).toContain('fog');
    expect(m.customProgramCacheKey()).toContain('wind');
  });

  it('does not add the same hook key twice', () => {
    const m = new THREE.MeshStandardMaterial();
    let n = 0;
    addCompileHook(m, 'x', () => { n++; });
    addCompileHook(m, 'x', () => { n++; });
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(n).toBe(1);
  });
});

describe('adoptBaseCompileHook', () => {
  it('adopts a later direct onBeforeCompile assignment as the base, running it before existing hooks', () => {
    // Simulates CSM.setupMaterial being called AFTER a fog/wind hook was already composed: it
    // assigns onBeforeCompile directly, clobbering the wrapper. adoptBaseCompileHook folds that
    // fresh assignment back in as the base so both run, CSM (the new base) first.
    const m = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    addCompileHook(m, 'a', () => { calls.push('a'); });
    m.onBeforeCompile = () => { calls.push('csm'); };
    adoptBaseCompileHook(m);
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(calls).toEqual(['csm', 'a']);
  });

  it('is a no-op on a material with no composed hooks', () => {
    const m = new THREE.MeshStandardMaterial();
    const original = () => {};
    m.onBeforeCompile = original;
    adoptBaseCompileHook(m);
    expect(m.onBeforeCompile).toBe(original);
  });
});

describe('releaseBaseCompileHook', () => {
  it('drops the base handler (e.g. after CSM.dispose() deletes its assignment) but keeps composed hooks', () => {
    const m = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    addCompileHook(m, 'a', () => { calls.push('a'); });
    m.onBeforeCompile = () => { calls.push('csm'); };
    adoptBaseCompileHook(m);
    // CSM.dispose() does `delete material.onBeforeCompile`, which removes whatever function is
    // currently the OWN property — by now that's our wrapper, not CSM's raw function.
    delete (m as unknown as { onBeforeCompile?: unknown }).onBeforeCompile;
    releaseBaseCompileHook(m);
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(calls).toEqual(['a']);
  });
});

describe('createMaterialPipeline', () => {
  it('prepares each material once, including arrays and nested meshes', () => {
    const seen: THREE.Material[] = [];
    const pipe = createMaterialPipeline([(m) => { seen.push(m); }]);
    const shared = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    const child = new THREE.Mesh(new THREE.BoxGeometry(), [shared, new THREE.MeshBasicMaterial()]);
    root.add(child);
    pipe.prepareTree(root);
    pipe.prepare(shared);
    expect(seen.length).toBe(2);
  });
});
