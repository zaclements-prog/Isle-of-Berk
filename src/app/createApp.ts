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

/** What the per-frame render touches (narrowed so tests can stub it). */
export interface FrameParts {
  renderer: Pick<THREE.WebGLRenderer, 'info' | 'shadowMap'>;
  camera: THREE.Camera;
  lighting: Pick<LightingRig, 'update'>;
  sky: Pick<SkySystem, 'update'>;
  post: Pick<PostStack, 'render'>;
  simTime: () => number;
}

/**
 * The main per-frame render: createApp runs it at loop priority 1000 and berk.perf times it.
 * Shadow maps update exactly once per frame. autoUpdate is off, and needsUpdate is raised here at
 * the top of the frame: the frame's first scene render (N8AO's beauty pass, or RenderPass on Low)
 * redraws the cascades and clears the flag, and every later scene render reuses the maps — N8AO's
 * two transparency re-renders now, mirror / refraction passes later. Full-screen passes carry no
 * lights, so they never consume the flag. Anything that renders the scene outside this function
 * (e.g. the lab's film strip) sees the maps from the last frame.
 */
export function createFrameRender(p: FrameParts): () => void {
  p.renderer.shadowMap.autoUpdate = false;
  return () => {
    p.renderer.info.reset(); // several renders per frame (AO, bloom...) — reset once per frame
    p.renderer.shadowMap.needsUpdate = true;
    p.camera.updateMatrixWorld();
    p.lighting.update();
    p.sky.update(p.simTime());
    p.post.render(0);
  };
}

/**
 * bfcache. renderer.ts disposes the renderer (and loses its context) on pagehide, so a page restored
 * from the back/forward cache would keep rendering into a dead context. Stop the loop on pagehide,
 * and reload a restored page (pageshow with persisted = true). A normal first load has persisted =
 * false.
 */
export function bindPageLifecycle(target: EventTarget, loop: Pick<GameLoop, 'stop'>, reload: () => void): void {
  target.addEventListener('pagehide', () => loop.stop());
  target.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) reload();
  });
}

export function createApp(container: HTMLElement): App {
  installFogChunks();
  // Probe the GPU name before choosing a preset (the real renderer is created with that preset).
  const probe = document.createElement('canvas').getContext('webgl2');
  const gpuName = probe ? gpuRendererName(probe) : null;
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  const preset = choosePreset(gpuName, location.search);

  const renderer = createRenderer(container, preset);
  renderer.info.autoReset = false; // the frame render resets it once per frame (createFrameRender)
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

  const renderFrame = createFrameRender({ renderer, camera, lighting, sky, post, simTime: () => loop.simTime });
  loop.addRender(renderFrame, 1000);
  bindPageLifecycle(window, loop, () => location.reload());

  // WebGL context restore (e.g. after a GPU reset). three r186 handles most of it itself: its own
  // webglcontextrestored listener (registered in the WebGLRenderer constructor, so it runs before
  // this one) re-runs initGLContext(), which rebuilds all renderer state from scratch — fresh
  // WebGLProperties, program cache, textures, geometries — so every material recompiles (our
  // onBeforeCompile hooks run again) and every texture / render target re-uploads on its next use,
  // with no needsUpdate marking; it also restores shadowMap.enabled/autoUpdate/needsUpdate/type and
  // info.autoReset. What it cannot restore is content that was drawn on the GPU once: the PMREM
  // environment baked from the sky. Shadow maps and post targets are redrawn every frame anyway.
  renderer.domElement.addEventListener('webglcontextrestored', () => sky.onContextRestored());

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
      renderFrame(); // one whole frame (one shadow update + the post stack) for the per-frame stats
      const stats = rendererStats(renderer);
      // gpuFence, not the context itself: Chrome's WebGL finish() doesn't wait for the GPU.
      const cost = measureRenderCost(renderFrame, gpuFence(renderer.getContext()), frames);
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
