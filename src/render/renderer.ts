import * as THREE from 'three';
import type { QualityPreset } from './quality';

/**
 * The tone curves compared for spec §4.2 / §11 (docs/progress/img/m1-tone-*.png), all switchable at
 * runtime with berk.toneMapping() for A/B: OutputPass compares renderer.toneMapping every render and
 * rebuilds its define when it changes.
 */
export const TONE_CURVES = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
} as const;
export type ToneCurve = keyof typeof TONE_CURVES;

/**
 * Khronos PBR Neutral: the controller's pick from the side-by-side captures — the saturated, warm
 * golden-hour palette (deep blue sky, orange glow toward the sun, richer ground, deeper shadows,
 * punchy emissive), where AgX read washed-out and ACES sat in between. The AgX / ACES captures
 * remain for the user to re-decide.
 */
export const DEFAULT_TONE_CURVE: ToneCurve = 'neutral';

export function createRenderer(container: HTMLElement, preset: QualityPreset): THREE.WebGLRenderer {
  // MSAA happens in the post stack's render targets, not the default framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio) * preset.renderScale);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_CURVES[DEFAULT_TONE_CURVE]; // applied by OutputPass
  // Tuned in M1 under AgX and kept for Neutral: at 1.8 neither the ground nor the open sky clips in
  // the hero or wide shots (only the emissive core, a glint and the additive sprite over the aureole).
  renderer.toneMappingExposure = 1.8;
  renderer.shadowMap.enabled = true; // redrawn once per frame: see createFrameRender (autoUpdate off)
  // r186 removed PCFSoftShadowMap (it warns and falls back to PCF); PCF now filters softly itself.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  // Lesson from the old game: repeated navigations exhausted WebGL contexts. Release ours on leave.
  addEventListener('pagehide', () => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  return renderer;
}
