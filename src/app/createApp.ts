import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { debug } from '../core/debug';
import { choosePreset, gpuRendererName, type QualityPreset } from '../render/quality';
import { createRenderer, TONE_CURVES, type ToneCurve } from '../render/renderer';
import { createPostStack, type PostStack } from '../render/post';
import { LightingRig } from '../render/lighting';
import { SkySystem } from '../render/sky';
import { installFogChunks, applyBerkFog, setFogParams, GOLDEN_FOG, berkFogProxy } from '../render/fog';
import { createMaterialPipeline, type MaterialPipeline } from '../render/materials';
import { gpuFence, measureRenderCost, rendererStats } from '../dev/perf';
import { disposeObject } from '../dev/disposeObject';
import type { N8AODisplayMode } from 'n8ao';

/** N8AO's display modes in its own index order (configuration.renderMode). */
const AO_DISPLAY_MODES: readonly N8AODisplayMode[] = ['Combined', 'AO', 'No AO', 'Split', 'Split AO'];

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
  /**
   * Undo add() for good: release every material under root from CSM, take root out of the scene and
   * free its GPU resources (disposeObject). root must own everything under it — a geometry, material
   * or texture shared with an object that stays in the scene is freed too. Don't re-add root.
   */
  remove(root: THREE.Object3D): void;
  /** Move the sun: lighting, sky, fog in-scatter and the baked environment follow. */
  setSun(azimuth: number, elevation: number): void;
}

/** App.remove, exported for tests (createApp itself needs a DOM and a WebGL context). */
export function removeFromApp(
  scene: THREE.Scene,
  lighting: Pick<LightingRig, 'releaseMaterial'>,
  root: THREE.Object3D,
): void {
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) lighting.releaseMaterial(m);
  });
  scene.remove(root);
  disposeObject(root);
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
  // Not the look (Berk materials ignore it, see fog.ts): N8AO only fades AO under scene.fog, so this
  // FogExp2 stand-in, refit by every setFogParams, keeps AO from darkening the Berk haze.
  scene.fog = berkFogProxy;
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
    /** Switch the tone curve ('agx' | 'neutral' | 'aces'); returns the current one (the names if unknown). */
    toneMapping: (name?: ToneCurve) => {
      if (name !== undefined) {
        if (!Object.hasOwn(TONE_CURVES, name)) return Object.keys(TONE_CURVES);
        renderer.toneMapping = TONE_CURVES[name]; // OutputPass rebuilds its define on its next render
      }
      return (Object.keys(TONE_CURVES) as ToneCurve[]).find((k) => TONE_CURVES[k] === renderer.toneMapping) ?? null;
    },
    /** N8AO's display mode ('AO' shows the AO term alone); null on presets without AO. */
    aoDisplay: (mode?: N8AODisplayMode) => {
      if (!post.ao) return null;
      if (mode !== undefined) post.ao.setDisplayMode(mode);
      return AO_DISPLAY_MODES[post.ao.configuration.renderMode] ?? null;
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
    remove(root) {
      removeFromApp(scene, lighting, root);
    },
    setSun,
  };
}
