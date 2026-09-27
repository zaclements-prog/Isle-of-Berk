import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { berkFogFactor, GOLDEN_FOG, applyBerkFog, fogUniforms, installFogChunks } from '../../src/render/fog';
import type { ShaderParams } from '../../src/render/materials';

describe('berkFogFactor', () => {
  const cam = new THREE.Vector3(0, 2, 0);

  it('is zero at zero distance and grows with distance', () => {
    expect(berkFogFactor(GOLDEN_FOG, cam, cam.clone())).toBeCloseTo(0, 9);
    const near = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -50));
    const far = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -500));
    expect(far).toBeGreaterThan(near);
  });

  it('is thinner looking up than looking along the ground at equal distance', () => {
    const level = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -300));
    const up = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 302, 0));
    expect(up).toBeLessThan(level);
  });

  it('never exceeds maxOpacity', () => {
    expect(berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 0, -100000))).toBeLessThanOrEqual(GOLDEN_FOG.maxOpacity + 1e-9);
  });

  it('matches the closed form for a level ray', () => {
    const p = { ...GOLDEN_FOG, maxOpacity: 1 };
    const f = berkFogFactor(p, cam, new THREE.Vector3(0, 2, -100));
    const expected = 1 - Math.exp(-p.density * Math.exp(-p.heightFalloff * (2 - p.baseHeight)) * 100);
    expect(f).toBeCloseTo(expected, 9);
  });
});

describe('applyBerkFog', () => {
  it('defines BERK_FOG and injects the shared uniform objects', () => {
    const m = new THREE.MeshStandardMaterial();
    applyBerkFog(m);
    expect((m as unknown as { defines: Record<string, unknown> }).defines.BERK_FOG).toBe('');
    const shader = { uniforms: {} } as unknown as ShaderParams;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.berkFogDensity).toBe(fogUniforms.berkFogDensity);
  });

  it('skips materials with fog disabled', () => {
    const m = new THREE.MeshBasicMaterial({ fog: false });
    applyBerkFog(m);
    expect((m as unknown as { defines?: Record<string, unknown> }).defines?.BERK_FOG).toBeUndefined();
  });

  it('also defines BERK_FOG_SPRITE on sprite materials (SpriteMaterial.fog defaults to true)', () => {
    const m = new THREE.SpriteMaterial();
    applyBerkFog(m);
    const defines = (m as unknown as { defines: Record<string, unknown> }).defines;
    expect(defines.BERK_FOG).toBe('');
    expect(defines.BERK_FOG_SPRITE).toBe('');
  });
});

describe('installFogChunks sprite branch', () => {
  it('never references `transformed` inside the BERK_FOG_SPRITE branch of fog_vertex', () => {
    // sprite.glsl.js includes fog_pars_vertex/fog_vertex but has no begin_vertex/project_vertex,
    // so it never declares `transformed` — the sprite branch must not read it.
    installFogChunks();
    const src = THREE.ShaderChunk.fog_vertex;
    const start = src.indexOf('#ifdef BERK_FOG_SPRITE');
    expect(start).toBeGreaterThanOrEqual(0);
    const elseIdx = src.indexOf('#else', start);
    expect(elseIdx).toBeGreaterThan(start);
    const spriteBranch = src.slice(start, elseIdx);
    expect(spriteBranch).not.toContain('transformed');
  });
});
