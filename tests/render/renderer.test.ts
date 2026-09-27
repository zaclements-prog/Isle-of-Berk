import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_TONE_CURVE, TONE_CURVES } from '../../src/render/renderer';

// createRenderer itself needs a WebGL context; the curve it installs is DEFAULT_TONE_CURVE.
describe('tone curve', () => {
  it('ships Khronos PBR Neutral by default (the controller\'s pick, spec §4.2 / §11)', () => {
    expect(DEFAULT_TONE_CURVE).toBe('neutral');
    expect(TONE_CURVES[DEFAULT_TONE_CURVE]).toBe(THREE.NeutralToneMapping);
  });

  it('keeps AgX and ACES switchable for A/B (berk.toneMapping)', () => {
    expect(TONE_CURVES.agx).toBe(THREE.AgXToneMapping);
    expect(TONE_CURVES.aces).toBe(THREE.ACESFilmicToneMapping);
  });
});
