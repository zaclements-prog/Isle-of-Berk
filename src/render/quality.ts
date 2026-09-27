export type QualityName = 'high' | 'low';

export interface QualityPreset {
  name: QualityName;
  /** Multiplies the device pixel ratio. */
  renderScale: number;
  maxPixelRatio: number;
  /** 0 = MSAA off (SMAA is used instead). */
  msaaSamples: number;
  ao: boolean;
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  aoHalfRes: boolean;
  shadowCascades: number;
  shadowMapSize: number;
  bloom: boolean;
  /** Pond reflection render-target scale (used by the Cove). */
  reflectionScale: number;
  /** 0..1 grass instance density (used by the Cove). */
  grassDensity: number;
  /** Multiplies LOD switch distances (used by the Cove). */
  lodDistanceScale: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  high: {
    name: 'high', renderScale: 1, maxPixelRatio: 2, msaaSamples: 4, ao: true, aoQuality: 'High', aoHalfRes: false,
    shadowCascades: 4, shadowMapSize: 2048, bloom: true, reflectionScale: 0.5, grassDensity: 1, lodDistanceScale: 1,
  },
  low: {
    name: 'low', renderScale: 0.75, maxPixelRatio: 1, msaaSamples: 0, ao: false, aoQuality: 'Performance', aoHalfRes: true,
    shadowCascades: 2, shadowMapSize: 1024, bloom: true, reflectionScale: 0.25, grassDensity: 0.3, lodDistanceScale: 0.5,
  },
};

const INTEGRATED = /intel|microsoft basic|swiftshader|llvmpipe/i;

export function choosePreset(gpuRenderer: string | null, query: string): QualityPreset {
  const q = new URLSearchParams(query).get('q');
  if (q === 'high' || q === 'low') return PRESETS[q];
  if (gpuRenderer && INTEGRATED.test(gpuRenderer)) return PRESETS.low;
  return PRESETS.high;
}

export function gpuRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
}
