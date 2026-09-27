// Types for terrainLayers.mjs (imported by the engine's tests to keep the layer order in one place).
export declare const TERRAIN_LAYER_IDS: string[];
export declare const LAYER_TOKENS: Record<'diff' | 'nor' | 'arm' | 'disp', string>;
export declare function packArmh(arm: Uint8Array, disp: Uint8Array, pixels: number): Uint8Array;
