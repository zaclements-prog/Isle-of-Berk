import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkySystem, skyCeilingLuminance } from '../../src/render/sky';

// Sky.SkyShader is the static source every `new Sky()` copies (typed as a bare object upstream).
const skyShader = Sky.SkyShader as { fragmentShader: string };

describe('skyCeilingLuminance', () => {
  it('leaves the ordinary sky untouched up to the knee', () => {
    expect(skyCeilingLuminance(0.2)).toBeCloseTo(0.2, 12);
    expect(skyCeilingLuminance(0.6)).toBeCloseTo(0.6, 12);
  });

  it("keeps a low sun's aureole under the bloom threshold (1.0) without ever decreasing", () => {
    let prev = 0;
    for (const L of [0.61, 0.8, 1, 2, 5, 15, 40, 99]) {
      const out = skyCeilingLuminance(L);
      expect(out).toBeLessThan(1.0);
      expect(out).toBeGreaterThanOrEqual(prev);
      prev = out;
    }
  });

  it('lets the sun disc through hot', () => {
    expect(skyCeilingLuminance(5000)).toBeGreaterThan(4000);
  });
});

describe('SkySystem', () => {
  it('patches the sky shader with exposure and the luminance ceiling', () => {
    // PMREMGenerator's constructor touches no GL state, so a stub renderer is enough here.
    const sky = new SkySystem({} as THREE.WebGLRenderer, new THREE.Scene());
    const fs = sky.sky.material.fragmentShader;
    expect(fs).toContain('uniform float skyExposure;');
    expect(fs).toContain('berkSkyCeiling(');
    expect(fs).not.toContain('gl_FragColor = vec4( texColor, 1.0 );');
  });

  it('re-bakes after a context restore without disposing the dead pre-restore target', () => {
    const scene = new THREE.Scene();
    const sky = new SkySystem({} as THREE.WebGLRenderer, scene);
    const stale = new THREE.WebGLRenderTarget(1, 1);
    const staleDispose = vi.spyOn(stale, 'dispose');
    (sky as unknown as { envTarget: THREE.WebGLRenderTarget | null }).envTarget = stale;
    scene.environmentIntensity = 0.7;
    const bake = vi.spyOn(sky, 'bakeEnvironment').mockImplementation(() => {}); // PMREM needs real WebGL
    sky.onContextRestored();
    expect(bake).toHaveBeenCalledWith(0.7);
    expect(staleDispose).not.toHaveBeenCalled();
    expect((sky as unknown as { envTarget: unknown }).envTarget).toBeNull();
  });

  // A three upgrade that moves either anchor must not leave a half-patched shader: the uniform
  // alone is dead code, and the output alone reads undeclared skyExposure / berkSkyCeiling.
  for (const [name, anchor] of [
    ['output', 'gl_FragColor = vec4( texColor, 1.0 );'],
    ['uniform', 'uniform float time;'],
  ] as const) {
    it(`leaves the sky shader untouched and logs an error when the ${name} anchor is missing`, () => {
      const original = skyShader.fragmentShader;
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const mutated = original.replace(anchor, `/* moved upstream */ ${anchor.replace(/ /g, '  ')}`);
        expect(mutated).not.toBe(original);
        skyShader.fragmentShader = mutated;
        const sky = new SkySystem({} as THREE.WebGLRenderer, new THREE.Scene());
        expect(sky.sky.material.fragmentShader).toBe(mutated);
        expect(error).toHaveBeenCalled();
        expect(() => sky.setParams({ exposure: 0.2 })).not.toThrow(); // exposure uniform still settable
      } finally {
        skyShader.fragmentShader = original;
        error.mockRestore();
      }
    });
  }
});
