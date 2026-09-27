import { describe, it, expect } from 'vitest';
import { packArmh, TERRAIN_LAYER_IDS } from './terrainLayers.mjs';

describe('terrain layer packing', () => {
  it('keeps AO and roughness and puts the height in blue', () => {
    const arm = new Uint8Array([10, 20, 0, 30, 40, 255]);
    const disp = new Uint8Array([99, 7]);
    expect(Array.from(packArmh(arm, disp, 2))).toEqual([10, 20, 99, 30, 40, 7]);
    expect(() => packArmh(arm, disp, 3)).toThrow();
  });
  it('lists the six splat layers in bake order', () => {
    expect(TERRAIN_LAYER_IDS).toHaveLength(6);
    expect(TERRAIN_LAYER_IDS[5]).toBe('rock_wall_02');
  });
});
