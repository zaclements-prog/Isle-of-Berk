declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderTarget } from 'three';
  import { Pass } from 'three/addons/postprocessing/Pass.js';

  export type N8AOQualityMode =
    | 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
    | 'Neural-Low' | 'Neural-Medium' | 'Neural-High';

  /** setDisplayMode(name) stores the name's index in this list as configuration.renderMode. */
  export type N8AODisplayMode = 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO';

  export interface N8AOConfiguration {
    /** Index into the N8AODisplayMode list, in its declared order (0 = 'Combined'). */
    renderMode: number;
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    transparencyAware: boolean;
    autoRenderBeauty: boolean;
    accumulate: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
  }

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    beautyRenderTarget: WebGLRenderTarget;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: N8AODisplayMode): void;
    setSize(width: number, height: number): void;
  }
}
