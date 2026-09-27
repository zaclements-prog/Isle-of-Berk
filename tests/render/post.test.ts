import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createPostStack } from '../../src/render/post';
import { PRESETS } from '../../src/render/quality';

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
