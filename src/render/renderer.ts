import * as THREE from 'three';
import type { QualityPreset } from './quality';

/**
 * The tone curves under evaluation (spec §4.2 / §11), switchable at runtime with berk.toneMapping():
 * OutputPass compares renderer.toneMapping every render and rebuilds its define when it changes.
 * AgX stays the default until the curve is chosen. Exposure 1.8 was tuned under AgX.
 */
export const TONE_CURVES = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
} as const;
export type ToneCurve = keyof typeof TONE_CURVES;

export function createRenderer(container: HTMLElement, preset: QualityPreset): THREE.WebGLRenderer {
  // MSAA happens in the post stack's render targets, not the default framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio) * preset.renderScale);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_CURVES.agx; // applied by OutputPass
  renderer.toneMappingExposure = 1.8; // M1-tuned: sunlit mid-green ground lands mid-tone (~120/255) under AgX
  renderer.shadowMap.enabled = true;
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
