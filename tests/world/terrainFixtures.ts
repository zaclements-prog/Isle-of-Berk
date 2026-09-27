import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';

/** A header for synthetic heightfields (tests only); the grid is centred on the origin. */
export function testHeader(size: number, spacing = 0.4): TerrainHeader {
  return {
    version: 1, size, spacing, origin: -((size - 1) * spacing) / 2, heightMin: -8, heightMax: 72, waterLevel: -0.45, seed: 1,
    pond: { cx: 0, cz: 0, a: 1, b: 1, angle: 0, depth: 1 }, floorRadius: 35, rimRadius: 50,
    wall: { mean: 19.5, amp: 5.5, sharpness: 5, jitter: 1.6 }, sun: { azimuth: 292, elevation: 14 },
    gully: { azimuth: 292, rStart: 30, rEnd: 110, halfWidthIn: 8, halfWidthOut: 13, blend: 8, ease: 1.6 },
    routeA: { azimuth: 330, rStart: 29, steps: 7, tread: 3, rise: 2.2, riserRun: 0.3, halfWidth: 3.5, blend: 3 },
    routeB: { azimuth: 250, r0: 33, r1: 51, sharpness: 3.5, halfWidth: 4, blend: 4 },
    spawn: [{ x: 0, z: 0, heading: 0 }], layers: ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'],
    files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' }, stats: {},
  };
}

/** A deterministic bumpy grid for geometry tests. */
export function bumpy(size: number): Heightfield {
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = Math.sin(i * 0.7) * 2 + Math.cos(j * 0.45) * 1.5 + (i * j) % 7 * 0.1;
  return new Heightfield(testHeader(size), h);
}
