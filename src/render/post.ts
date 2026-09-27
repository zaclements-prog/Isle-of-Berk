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
      float v = smoothstep(0.9, 0.3, length(d));
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

  let ao: N8AOPass | null = null;
  if (preset.ao) {
    ao = new N8AOPass(scene, camera, size.x, size.y); // renders the scene itself (replaces RenderPass)
    ao.configuration.gammaCorrection = false; // OutputPass does tone mapping + sRGB
    ao.configuration.aoRadius = 1.5;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.2;
    ao.setQualityMode(preset.aoQuality);
    ao.configuration.halfRes = preset.aoHalfRes;
    if (useMsaa) {
      const beauty = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.msaaSamples });
      beauty.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      beauty.depthTexture.format = THREE.DepthFormat;
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
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.tLut.value = bakeLut(grade, LUT_SIZE);
  gradePass.uniforms.vignette.value = grade.vignette;
  gradePass.uniforms.aspect.value = size.x / size.y;
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
      composer.dispose();
    },
  };
}
