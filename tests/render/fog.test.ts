import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  berkFogFactor, GOLDEN_FOG, applyBerkFog, fogUniforms, installFogChunks, berkFogProxy, setFogParams,
} from '../../src/render/fog';
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

describe('berkFogProxy (three scene.fog stand-in that N8AO fades AO under)', () => {
  const sunDir = new THREE.Vector3(0, 1, 0);
  const eye = new THREE.Vector3(0, 1.6, 0);
  // N8AO's EffectCompositer fades AO by FogExp2's curve over view depth: 1 - exp(-(density * d)^2).
  const proxyOpacity = (d: number) => 1 - Math.exp(-((berkFogProxy.density * d) ** 2));
  const berkLevel = (d: number) => berkFogFactor(GOLDEN_FOG, eye, new THREE.Vector3(0, 1.6, -d));

  it('is a FogExp2 whose density and colour are recomputed whenever setFogParams runs', () => {
    expect(berkFogProxy).toBeInstanceOf(THREE.FogExp2);
    setFogParams(GOLDEN_FOG, sunDir);
    const golden = berkFogProxy.density;
    expect(golden).toBeGreaterThan(0);
    expect(berkFogProxy.color.equals(GOLDEN_FOG.color)).toBe(true);

    const thicker = { ...GOLDEN_FOG, density: GOLDEN_FOG.density * 2, color: new THREE.Color(0.3, 0.2, 0.1) };
    setFogParams(thicker, sunDir);
    expect(berkFogProxy.density).toBeGreaterThan(golden);
    expect(berkFogProxy.color.equals(thicker.color)).toBe(true);

    setFogParams(GOLDEN_FOG, sunDir);
    expect(berkFogProxy.density).toBe(golden);
  });

  it('matches the golden Berk fog opacity at 120 m on a level ray at 1.6 m eye height (within 0.05)', () => {
    setFogParams(GOLDEN_FOG, sunDir);
    expect(Math.abs(proxyOpacity(120) - berkLevel(120))).toBeLessThan(0.05);
  });

  it('stays within 0.08 of the golden Berk fog across the 75–150 m fit range', () => {
    // exp² under-fades near and over-fades far versus the Berk fog's exp; these are the fit's residuals.
    setFogParams(GOLDEN_FOG, sunDir);
    for (const d of [75, 100, 150]) expect(Math.abs(proxyOpacity(d) - berkLevel(d)), `${d} m`).toBeLessThan(0.08);
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
