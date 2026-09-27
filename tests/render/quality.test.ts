import { describe, it, expect } from 'vitest';
import { choosePreset, PRESETS } from '../../src/render/quality';

describe('choosePreset', () => {
  it('honours an explicit ?q= override', () => {
    expect(choosePreset('NVIDIA GeForce RTX 3080 Ti', '?q=low').name).toBe('low');
    expect(choosePreset('Intel(R) Iris(R) Xe Graphics', '?q=high').name).toBe('high');
  });

  it('picks low for integrated or software GPUs', () => {
    expect(choosePreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', '').name).toBe('low');
    expect(choosePreset('SwiftShader', '').name).toBe('low');
  });

  it('picks high for discrete GPUs and unknown renderers', () => {
    expect(choosePreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Ti Laptop GPU Direct3D11)', '').name).toBe('high');
    expect(choosePreset(null, '').name).toBe('high');
  });

  it('matches the spec §4.10 preset table', () => {
    expect(PRESETS.high).toMatchObject({ renderScale: 1, msaaSamples: 4, ao: true, shadowCascades: 4, shadowMapSize: 2048, reflectionScale: 0.5, grassDensity: 1, lodDistanceScale: 1 });
    expect(PRESETS.low).toMatchObject({ renderScale: 0.75, ao: false, shadowCascades: 2, shadowMapSize: 1024, reflectionScale: 0.25, grassDensity: 0.3, lodDistanceScale: 0.5 });
  });
});
