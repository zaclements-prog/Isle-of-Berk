import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { debug } from '../core/debug';
import { choosePreset, gpuRendererName, type QualityPreset } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { createPostStack, type PostStack } from '../render/post';
import { LightingRig } from '../render/lighting';
import { SkySystem } from '../render/sky';
import { installFogChunks, applyBerkFog, setFogParams, GOLDEN_FOG } from '../render/fog';
import { createMaterialPipeline, type MaterialPipeline } from '../render/materials';
import { gpuFence, measureRenderCost, rendererStats } from '../dev/perf';

export interface App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly preset: QualityPreset;
  readonly post: PostStack;
  readonly lighting: LightingRig;
  readonly sky: SkySystem;
  readonly materials: MaterialPipeline;
  readonly loop: GameLoop;
  /** Prepare every material under root (CSM + fog) and add it to the scene. */
  add(root: THREE.Object3D): void;
  /** Move the sun: lighting, sky, fog in-scatter and the baked environment follow. */
  setSun(azimuth: number, elevation: number): void;
}

export function createApp(container: HTMLElement): App {
  installFogChunks();
  // Probe the GPU name before choosing a preset (the real renderer is created with that preset).
  const probe = document.createElement('canvas').getContext('webgl2');
  const gpuName = probe ? gpuRendererName(probe) : null;
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  const preset = choosePreset(gpuName, location.search);

  const renderer = createRenderer(container, preset);
  renderer.info.autoReset = false; // several renders per frame (AO, bloom...) — reset once per frame
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 6000);

  const lighting = new LightingRig(scene, camera, preset);
  const sky = new SkySystem(renderer, scene);
  sky.setSun(lighting.sunDir);
  sky.bakeEnvironment(1.0);
  setFogParams(GOLDEN_FOG, lighting.sunDir);

  const materials = createMaterialPipeline([(m) => lighting.setupMaterial(m), applyBerkFog]);
  const post = createPostStack(renderer, scene, camera, preset);
  const loop = new GameLoop();

  loop.addRender(() => {
    renderer.info.reset();
    camera.updateMatrixWorld();
    lighting.update();
    sky.update(loop.simTime);
    post.render(0);
  }, 1000);

  addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.setSize(w, h);
    lighting.onResize();
  });

  const setSun = (azimuth: number, elevation: number) => {
    lighting.setSun(azimuth, elevation);
    sky.setSun(lighting.sunDir);
    sky.bakeEnvironment(scene.environmentIntensity);
    setFogParams(GOLDEN_FOG, lighting.sunDir);
  };

  debug.register(null, {
    step: (n = 1, dt?: number) => loop.step(n, dt),
    pause: () => loop.pause(),
    play: () => loop.resume(),
    quality: () => ({ preset: preset.name, gpu: gpuName }),
    sun: (azimuth: number, elevation: number) => setSun(azimuth, elevation),
    exposure: (v?: number) => {
      if (v !== undefined) renderer.toneMappingExposure = v;
      return renderer.toneMappingExposure;
    },
    perf: (frames = 30) => {
      renderer.info.reset();
      post.render(0);
      const stats = rendererStats(renderer);
      // gpuFence, not the context itself: Chrome's WebGL finish() doesn't wait for the GPU.
      const cost = measureRenderCost(() => post.render(0), gpuFence(renderer.getContext()), frames);
      return { ...cost, fpsEquivalent: 1000 / cost.msPerFrame, ...stats, preset: preset.name, gpu: gpuName };
    },
  });
  debug.expose(window as unknown as Record<string, unknown>);

  return {
    renderer, scene, camera, preset, post, lighting, sky, materials, loop,
    add(root) {
      materials.prepareTree(root);
      scene.add(root);
    },
    setSun,
  };
}
