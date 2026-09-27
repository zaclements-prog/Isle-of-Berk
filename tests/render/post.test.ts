import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPostStack } from '../../src/render/post';
import { PRESETS } from '../../src/render/quality';
import { TONE_CURVES } from '../../src/render/renderer';

function stubRenderer(): THREE.WebGLRenderer {
  // No real WebGL context: just enough of the renderer surface for createPostStack + EffectComposer
  // construction/addPass/setSize, which never touch the GL context before the first render() call.
  return {
    getPixelRatio: () => 2,
    getSize: (v: THREE.Vector2) => v.set(800, 600),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 1200),
  } as unknown as THREE.WebGLRenderer;
}

// High preset with AO forced off: skips N8AOPass construction entirely, and msaaSamples > 0 (4 on
// High) skips SMAAPass, which decodes its area/search textures via an Image and needs a DOM. Bloom
// stays on (High.bloom is true), which is what these tests exercise.
function buildStack() {
  const renderer = stubRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const preset = { ...PRESETS.high, ao: false };
  return createPostStack(renderer, scene, camera, preset);
}

describe('createPostStack', () => {
  it('sizes passes from the logical size, not device-size squared by pixelRatio', () => {
    const stack = buildStack();
    expect(stack.bloom).not.toBeNull();
    // Device drawing buffer is 1600x1200 (logical 800x600 x pixelRatio 2). UnrealBloomPass halves
    // its input resolution for the bright-pass target, so the correctly-sized target is 800 wide.
    // EffectComposer derives _width/_height from the supplied render target (already device-sized)
    // and then addPass multiplies by getPixelRatio() again, so the pixelRatio-squared bug leaves
    // this at 1600 instead of 800.
    expect(stack.bloom!.renderTargetBright.width).toBe(800);
  });

  it('blooms only the clamped excess over the threshold, not the whole bright pixel', () => {
    // Stock UnrealBloomPass forwards the full value of anything over the threshold: big areas just
    // over it bloom like lamps and one ~1e4 sun glint floods every mip.
    const fs = buildStack().bloom!.materialHighPassFilter.fragmentShader;
    expect(fs).toContain('clamp( v - luminosityThreshold, 0.0, bloomMaxExcess )');
    expect(fs).not.toContain('gl_FragColor = mix( outputColor, texel, alpha );');
  });

  it('OutputPass follows a runtime renderer.toneMapping change (berk.toneMapping relies on it)', () => {
    const output = buildStack().composer.passes.find((p) => (p as OutputPass).isOutputPass) as OutputPass;
    const renderer = {
      toneMapping: TONE_CURVES.agx,
      toneMappingExposure: 1.8,
      outputColorSpace: THREE.SRGBColorSpace,
      autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
      setRenderTarget: () => {}, clear: () => {}, render: () => {},
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(4, 4);
    const frame = () => output.render(renderer, target, target, 0, false);
    const defines = () => output.material.defines as Record<string, unknown>;

    frame();
    expect(defines().AGX_TONE_MAPPING).toBe('');
    for (const [name, define] of [['neutral', 'NEUTRAL_TONE_MAPPING'], ['aces', 'ACES_FILMIC_TONE_MAPPING']] as const) {
      renderer.toneMapping = TONE_CURVES[name];
      const version = output.material.version;
      frame();
      expect(defines()[define], name).toBe('');
      expect(defines().AGX_TONE_MAPPING, name).toBeUndefined();
      expect(output.material.version, name).toBeGreaterThan(version); // recompiled
    }
  });

  it('dispose() frees the bloom pass and the baked LUT texture', () => {
    const stack = buildStack();
    const bloomDispose = vi.spyOn(stack.bloom!, 'dispose');
    const lut = stack.grade.uniforms.tLut.value as THREE.Data3DTexture;
    const lutDispose = vi.spyOn(lut, 'dispose');
    stack.dispose();
    expect(bloomDispose).toHaveBeenCalledTimes(1);
    expect(lutDispose).toHaveBeenCalledTimes(1);
  });
});
