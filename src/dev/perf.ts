import type * as THREE from 'three';

export interface RenderCost {
  msPerFrame: number;
  frames: number;
}

/**
 * Wall-clock cost of `render`: one warm-up call, then `frames` calls, with `fence.finish()` waiting
 * for the GPU to drain before the clock starts and after the last call. Independent of
 * requestAnimationFrame, so it works in throttled background tabs. Pass gpuFence(gl), not the
 * context itself: Chrome's WebGL finish() only flushes, so it would time command submission alone.
 */
export function measureRenderCost(render: () => void, fence: { finish(): void }, frames = 30): RenderCost {
  render();
  fence.finish();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) render();
  fence.finish();
  return { msPerFrame: (performance.now() - t0) / frames, frames };
}

/**
 * A `{ finish }` that really waits for the GPU, for measureRenderCost. Chrome implements WebGL
 * finish() as a flush: in M1 it returned after ~0.3 ms/frame for frames that cost ~30 ms, timing
 * only command submission. Reading back one pixel blocks until every queued command has completed.
 *
 * It needs an 8-bit RGBA framebuffer bound when finish() runs — normally the canvas (default)
 * framebuffer, which is bound after post.render() because the last pass draws to the screen. On a
 * half-float (or float) render target an RGBA/UNSIGNED_BYTE readback is an invalid format/type
 * pair: readPixels raises INVALID_OPERATION, returns at once and times nothing.
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
