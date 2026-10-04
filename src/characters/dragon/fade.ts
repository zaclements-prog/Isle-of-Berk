import type * as THREE from 'three';
import { addCompileHook } from '../../render/materials';

/** Shared camera-proximity fade (0 = opaque, 1 = gone) — the orbit camera writes it each frame. */
export const dragonFade = { value: 0 };

/**
 * Screen-door fade with a 4×4 ordered-dither pattern: fragments below the fade level are discarded. It needs no
 * transparency sorting, so AO and shadows are unaffected. Apply once to the dragon's materials after the app pipeline.
 */
export function applyDitherFade(materials: readonly THREE.Material[], uniform: { value: number } = dragonFade): void {
  for (const m of materials) {
    addCompileHook(m, 'dragonfade', (shader) => {
      shader.uniforms.berkDragonFade = uniform;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float berkDragonFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (berkDragonFade > 0.0) {
            const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
            ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
            if ((BAYER[cell.y * 4 + cell.x] + 0.5) / 16.0 < berkDragonFade) discard;
          }`);
    });
  }
}
