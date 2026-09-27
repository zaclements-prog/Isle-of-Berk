import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SkySystem, skyCeilingLuminance } from '../../src/render/sky';

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
});
