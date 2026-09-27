import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import type { QualityPreset } from './quality';
import { bakeLut, FILM_GRADE, type GradeParams } from './grade';

const LUT_SIZE = 32;

/** Display-space grade: 3D LUT lookup + vignette. Runs after OutputPass (tone curve + sRGB). */
const GradeShader = {
  name: 'BerkGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tLut: { value: null as THREE.Data3DTexture | null },
    lutSize: { value: LUT_SIZE },
    vignette: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp sampler3D;
    uniform sampler2D tDiffuse;
    uniform sampler3D tLut;
    uniform float lutSize;
    uniform float vignette;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 uvw = clamp(c.rgb, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
      vec3 graded = texture(tLut, uvw).rgb;
      vec2 d = vUv - 0.5;
      d.x *= aspect;
      float v = 1.0 - smoothstep(0.3, 0.9, length(d)); // edges in order: GLSL ES leaves edge0 >= edge1 undefined
      graded *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = vec4(graded, c.a);
    }`,
};

export interface PostStack {
  readonly composer: EffectComposer;
  readonly ao: N8AOPass | null;
  readonly bloom: UnrealBloomPass | null;
  readonly grade: ShaderPass;
  setGrade(p: GradeParams): void;
  setSize(width: number, height: number): void;
  render(frameDt: number): void;
  dispose(): void;
}

/**
 * Only the excess over the bloom threshold blooms, clamped. The stock UnrealBloomPass high-pass
 * forwards the FULL value of anything over the threshold, so a large area barely over it (sky behind
 * a sprite, a mirror full of bright sky) blooms as hard as a lamp, and a single sun glint (~1e4 on a
 * mirror) or the sun disc floods every mip into a full-frame veil (spec §4.2: never a haze). The
 * excess is continuous at the threshold, so no hard contour appears where a gradient crosses it.
 */
const BLOOM_MAX_EXCESS = 4;
const BLOOM_UNIFORM_ANCHOR = 'uniform float smoothWidth;';
const BLOOM_OUT_ANCHOR = 'gl_FragColor = mix( outputColor, texel, alpha );';

function patchBloomPrefilter(bloom: UnrealBloomPass): void {
  const mat = bloom.materialHighPassFilter;
  if (!mat.fragmentShader.includes(BLOOM_UNIFORM_ANCHOR) || !mat.fragmentShader.includes(BLOOM_OUT_ANCHOR)) {
    console.error('[post] bloom prefilter anchor missing — bloom input NOT clamped');
    return;
  }
  mat.uniforms.bloomMaxExcess = { value: BLOOM_MAX_EXCESS };
  mat.fragmentShader = mat.fragmentShader
    .replace(BLOOM_UNIFORM_ANCHOR, () => `${BLOOM_UNIFORM_ANCHOR}\n\t\tuniform float bloomMaxExcess;`)
    .replace(BLOOM_OUT_ANCHOR, () =>
      'float excess = clamp( v - luminosityThreshold, 0.0, bloomMaxExcess );\n' +
      '\t\t\tgl_FragColor = vec4( texel.rgb * ( excess / max( v, 1e-4 ) ), 1.0 );');
}

/**
 * n8ao 2.0.1 has no dispose(): free every render target / material / texture it holds directly, and
 * the material inside each of its FullScreenTriangle wrappers (effectCompositerQuad, effectShaderQuad,
 * accumulationQuad, poissonBlurQuad, and depthDownsampleQuad / depthCopyPass when half-res /
 * transparency-aware). Never call a wrapper's own dispose(): it also disposes the module-level
 * triangle geometry that every wrapper of every N8AOPass shares. Each resource is freed once.
 */
function disposeN8AOResources(pass: N8AOPass): void {
  const owned = new Set<{ dispose(): void }>();
  for (const value of Object.values(pass as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.WebGLRenderTarget || value instanceof THREE.Material || value instanceof THREE.Texture) {
      owned.add(value);
    } else if (value && (value as { material?: unknown }).material instanceof THREE.Material) {
      owned.add((value as { material: THREE.Material }).material);
    }
  }
  for (const r of owned) r.dispose();
}

export function createPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  preset: QualityPreset,
  grade: GradeParams = FILM_GRADE,
): PostStack {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const useMsaa = preset.msaaSamples > 0;
  // Linear HDR working buffers. MSAA lives on the beauty target when AO renders the scene.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: preset.ao ? 0 : preset.msaaSamples,
  });
  const composer = new EffectComposer(renderer, target);
  // EffectComposer derives _width/_height from the supplied render target (device px, since `size`
  // came from getDrawingBufferSize) instead of from the renderer's logical size. Every addPass then
  // multiplies _width/_height by renderer.getPixelRatio() again, squaring the ratio on HiDPI. Put
  // the composer back on its own logical-pixel convention so passes are sized once, correctly, in
  // device pixels. The composer's own render targets are already device-sized; this setSize call
  // re-applies that (harmless) since logical * pixelRatio === the device size we built `target` at.
  const logical = renderer.getSize(new THREE.Vector2());
  composer.setSize(logical.x, logical.y);

  let ao: N8AOPass | null = null;
  if (preset.ao) {
    ao = new N8AOPass(scene, camera, size.x, size.y); // renders the scene itself (replaces RenderPass)
    ao.configuration.gammaCorrection = false; // OutputPass does tone mapping + sRGB
    ao.configuration.aoRadius = 1.5;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.2;
    ao.setQualityMode(preset.aoQuality);
    ao.configuration.halfRes = preset.aoHalfRes;
    // Explicit, so N8AO stops auto-detecting: that walks the whole scene every frame until the first
    // transparent object appears, then allocates two full-size targets mid-game (a hitch).
    ao.configuration.transparencyAware = true;
    if (useMsaa) {
      const beauty = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.msaaSamples });
      beauty.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      beauty.depthTexture.format = THREE.DepthFormat;
      ao.beautyRenderTarget.dispose(); // N8AOPass's constructor already allocated a default one
      ao.beautyRenderTarget = beauty;
    }
    composer.addPass(ao);
  } else {
    composer.addPass(new RenderPass(scene, camera));
  }

  let bloom: UnrealBloomPass | null = null;
  if (preset.bloom) {
    // Threshold 1.0 on linear HDR: only genuinely bright things (emissives, glints) glow.
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.55, 1.0);
    patchBloomPrefilter(bloom);
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.tLut.value = bakeLut(grade, LUT_SIZE);
  gradePass.uniforms.vignette.value = grade.vignette;
  gradePass.uniforms.aspect.value = logical.x / logical.y;
  composer.addPass(gradePass);

  if (!useMsaa) composer.addPass(new SMAAPass());

  return {
    composer,
    ao,
    bloom,
    grade: gradePass,
    setGrade(p) {
      (gradePass.uniforms.tLut.value as THREE.Data3DTexture).dispose();
      gradePass.uniforms.tLut.value = bakeLut(p, LUT_SIZE);
      gradePass.uniforms.vignette.value = p.vignette;
    },
    setSize(w, h) {
      composer.setSize(w, h);
      gradePass.uniforms.aspect.value = w / h;
    },
    render(frameDt) {
      composer.render(frameDt);
    },
    dispose() {
      // EffectComposer.dispose() only frees its own read/write buffers and internal copy pass — it
      // never disposes the passes it holds, so each one is freed explicitly first.
      for (const pass of composer.passes) (pass as { dispose?: () => void }).dispose?.();
      if (ao) disposeN8AOResources(ao);
      bloom?.materialHighPassFilter.dispose(); // UnrealBloomPass.dispose() skips its high-pass material
      (gradePass.uniforms.tLut.value as THREE.Data3DTexture).dispose();
      composer.dispose();
    },
  };
}
