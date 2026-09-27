import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPostStack } from '../../src/render/post';
import { PRESETS, type QualityPreset } from '../../src/render/quality';
import { DEFAULT_TONE_CURVE, TONE_CURVES } from '../../src/render/renderer';

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

// The High preset as shipped: a real N8AOPass (its constructor only builds three objects — render
// targets, ShaderMaterials, a DataTexture — and never touches WebGL) with the MSAA beauty swap.
function buildHighStack(overrides: Partial<QualityPreset> = {}) {
  return createPostStack(stubRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), { ...PRESETS.high, ...overrides });
}

/** N8AO internals the stack must free (n8ao 2.0.1 has no dispose()). */
type N8AOInternals = Record<string, unknown> & {
  configuration: { transparencyAware: boolean };
  autoDetectTransparency: boolean;
  beautyRenderTarget: THREE.WebGLRenderTarget;
};
const N8AO_TARGETS = [
  'beautyRenderTarget', 'writeTargetInternal', 'readTargetInternal', 'accumulationRenderTarget',
  'transparencyRenderTargetDWFalse', 'transparencyRenderTargetDWTrue',
];
const N8AO_QUADS = ['effectCompositerQuad', 'effectShaderQuad', 'accumulationQuad', 'depthCopyPass', 'poissonBlurQuad'];
type Quad = { material: THREE.Material; dispose(): void; _mesh: THREE.Mesh };

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
    const mat = buildStack().bloom!.materialHighPassFilter;
    const fs = mat.fragmentShader;
    expect(fs).toContain('clamp( v - luminosityThreshold, 0.0, bloomMaxExcess )');
    expect(fs).not.toContain('gl_FragColor = mix( outputColor, texel, alpha );');
    expect(fs).toContain('uniform float bloomMaxExcess;');
    expect(mat.uniforms.bloomMaxExcess.value).toBe(4);
  });

  it('grades with an in-order vignette smoothstep (reversed edges are undefined in GLSL ES)', () => {
    const fs = buildStack().grade.material.fragmentShader;
    expect(fs).not.toMatch(/smoothstep\(\s*0\.9\s*,\s*0\.3/);
    expect(fs).toContain('1.0 - smoothstep(0.3, 0.9, length(d))');
  });

  it('dispose() also frees the bloom high-pass material (UnrealBloomPass.dispose() skips it)', () => {
    const stack = buildStack();
    const highPass = vi.spyOn(stack.bloom!.materialHighPassFilter, 'dispose');
    stack.dispose();
    expect(highPass).toHaveBeenCalledTimes(1);
  });

  it('swaps an MSAA beauty target into N8AO and frees the default one it replaces (High)', () => {
    const freed = vi.spyOn(THREE.RenderTarget.prototype, 'dispose');
    try {
      const ao = buildHighStack().ao as unknown as N8AOInternals;
      expect(ao.beautyRenderTarget.samples).toBe(PRESETS.high.msaaSamples);
      // N8AO's constructor-made beauty target: depth-textured, single-sampled, no longer referenced.
      const replaced = (freed.mock.contexts as THREE.RenderTarget[]).filter(
        (t) => t !== ao.beautyRenderTarget && t.depthTexture !== null && t.samples === 0,
      );
      expect(replaced).toHaveLength(1);
      expect(Object.values(ao)).not.toContain(replaced[0]);
    } finally {
      freed.mockRestore();
    }
  });

  it('makes N8AO transparency-aware up front: no per-frame scene walk, no mid-game allocation', () => {
    const ao = buildHighStack().ao as unknown as N8AOInternals;
    expect(ao.configuration.transparencyAware).toBe(true);
    expect(ao.autoDetectTransparency).toBe(false);
    expect(ao.transparencyRenderTargetDWFalse).toBeInstanceOf(THREE.WebGLRenderTarget);
  });

  it('dispose() frees N8AO\'s render targets and quad materials, never the quads\' shared geometry', () => {
    const stack = buildHighStack();
    const ao = stack.ao as unknown as N8AOInternals;
    const targets = N8AO_TARGETS.map((k) => [k, vi.spyOn(ao[k] as THREE.WebGLRenderTarget, 'dispose')] as const);
    const quads = N8AO_QUADS.map((k) => ao[k] as Quad);
    const materials = N8AO_QUADS.map((k, i) => [k, vi.spyOn(quads[i].material, 'dispose')] as const);
    const wrappers = quads.map((q) => vi.spyOn(q, 'dispose'));
    const sharedGeometry = vi.spyOn(quads[0]._mesh.geometry, 'dispose');
    stack.dispose();
    for (const [k, spy] of [...targets, ...materials]) expect(spy, k).toHaveBeenCalledTimes(1);
    for (const spy of wrappers) expect(spy).not.toHaveBeenCalled();
    expect(sharedGeometry).not.toHaveBeenCalled();
  });

  it('dispose() frees N8AO\'s half-res depth downsample target and quad material', () => {
    const stack = buildHighStack({ aoHalfRes: true });
    const ao = stack.ao as unknown as N8AOInternals;
    const target = vi.spyOn(ao.depthDownsampleTarget as THREE.WebGLRenderTarget, 'dispose');
    const material = vi.spyOn((ao.depthDownsampleQuad as Quad).material, 'dispose');
    stack.dispose();
    expect(target).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });

  it('OutputPass follows a runtime renderer.toneMapping change (berk.toneMapping relies on it)', () => {
    const output = buildStack().composer.passes.find((p) => (p as OutputPass).isOutputPass) as OutputPass;
    const renderer = {
      toneMapping: TONE_CURVES[DEFAULT_TONE_CURVE], // Neutral, as createRenderer ships it
      toneMappingExposure: 1.8,
      outputColorSpace: THREE.SRGBColorSpace,
      autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
      setRenderTarget: () => {}, clear: () => {}, render: () => {},
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(4, 4);
    const frame = () => output.render(renderer, target, target, 0, false);
    const defines = () => output.material.defines as Record<string, unknown>;
    const DEFINES = { agx: 'AGX_TONE_MAPPING', neutral: 'NEUTRAL_TONE_MAPPING', aces: 'ACES_FILMIC_TONE_MAPPING' } as const;

    frame();
    expect(defines()[DEFINES[DEFAULT_TONE_CURVE]]).toBe('');
    let previous: keyof typeof DEFINES = DEFAULT_TONE_CURVE;
    for (const name of ['agx', 'aces', 'neutral'] as const) {
      renderer.toneMapping = TONE_CURVES[name];
      const version = output.material.version;
      frame();
      expect(defines()[DEFINES[name]], name).toBe('');
      expect(defines()[DEFINES[previous]], `${previous} -> ${name}`).toBeUndefined();
      expect(output.material.version, name).toBeGreaterThan(version); // recompiled
      previous = name;
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
