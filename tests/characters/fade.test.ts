import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyDitherFade, dragonFade } from '../../src/characters/dragon/fade';

describe('applyDitherFade', () => {
  it('adds a dither-discard compile hook driven by the shared uniform', () => {
    const m = new THREE.MeshStandardMaterial();
    applyDitherFade([m]);
    expect(m.customProgramCacheKey()).toContain('dragonfade');
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('berkDragonFade');
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.uniforms.berkDragonFade).toBe(dragonFade);
  });
});
