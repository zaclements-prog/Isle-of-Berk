import * as THREE from 'three';
import type { QualityPreset } from './quality';

export function createRenderer(container: HTMLElement, preset: QualityPreset): THREE.WebGLRenderer {
  // MSAA happens in the post stack's render targets, not the default framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio) * preset.renderScale);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; // applied by OutputPass
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  // Lesson from the old game: repeated navigations exhausted WebGL contexts. Release ours on leave.
  addEventListener('pagehide', () => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  return renderer;
}
