import type * as THREE from 'three';

export interface RenderCost {
  msPerFrame: number;
  frames: number;
}

/**
 * Wall-clock cost of `render` with the GPU pipeline drained (gl.finish) — independent of
 * requestAnimationFrame, so it works in throttled background tabs.
 */
export function measureRenderCost(render: () => void, gl: { finish(): void }, frames = 30): RenderCost {
  render();
  gl.finish();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) render();
  gl.finish();
  return { msPerFrame: (performance.now() - t0) / frames, frames };
}

/**
 * A `{ finish }` that really waits for the GPU, for measureRenderCost. Chrome implements WebGL
 * finish() as a flush: in M1 it returned after ~0.3 ms/frame for frames that cost ~30 ms, timing
 * only command submission. Reading back one pixel blocks until every queued command has completed.
 */
export function gpuFence(gl: WebGLRenderingContext | WebGL2RenderingContext): { finish(): void } {
  const pixel = new Uint8Array(4);
  return { finish: () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel) };
}

export interface RendererStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
}

export function rendererStats(r: THREE.WebGLRenderer): RendererStats {
  return {
    calls: r.info.render.calls,
    triangles: r.info.render.triangles,
    points: r.info.render.points,
    lines: r.info.render.lines,
    geometries: r.info.memory.geometries,
    textures: r.info.memory.textures,
    programs: r.info.programs?.length ?? 0,
  };
}
