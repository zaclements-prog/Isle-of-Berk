import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { buildChunkGeometry, chunkGrid, selectLod, stepIndices, CHUNK_CELLS } from '../../src/world/terrain/chunks';
import { terrainCollisionGeometry } from '../../src/world/terrain/collisionMesh';
import { terrainUvTransform } from '../../src/world/terrain/heightTexture';
import { testHeader, bumpy } from './terrainFixtures';

describe('Heightfield', () => {
  it('decodes the uint16 LE grid to within 1.3 mm', () => {
    const hdr = testHeader(4);
    const src = [-8, 0, 12.3456, 72, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -7.5];
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    src.forEach((v, k) => view.setUint16(k * 2, Math.round(((v + 8) / 80) * 65535), true));
    const hf = Heightfield.fromUint16LE(hdr, bytes);
    src.forEach((v, k) => expect(Math.abs(hf.heights[k] - v)).toBeLessThan(0.0013));
    expect(() => Heightfield.fromUint16LE(hdr, new Uint8Array(30))).toThrow();
  });
  it('heightAt lies exactly on the render triangles', () => {
    const hf = bumpy(33);
    const geo = buildChunkGeometry(hf, { cx: 0, cz: 0, i0: 0, i1: 32, j0: 0, j1: 32 }, 1, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster();
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = hf.origin + 0.2 + ((k * 0.6180339) % 1) * 12.4;
      const z = hf.origin + 0.2 + ((k * 0.4142135) % 1) * 12.4;
      rc.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObject(mesh, false).find((h) => h.face && h.face.normal.y > 0);
      expect(hit).toBeTruthy();
      worst = Math.max(worst, Math.abs(hit!.point.y - hf.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(1e-4);
  });
  it('normalAt is unit and upright on flat ground', () => {
    const hf = new Heightfield(testHeader(8), new Float32Array(64).fill(2));
    const n = hf.normalAt(0.1, -0.3);
    expect(n.y).toBeCloseTo(1, 9);
    expect(n.length()).toBeCloseTo(1, 9);
  });
});

describe('terrain chunks', () => {
  it('tiles the 1024² grid with 7 × 7 chunks of 160 cells, last ones shorter', () => {
    const g = chunkGrid(1024);
    expect(g).toHaveLength(49);
    expect(CHUNK_CELLS).toBe(160);
    expect(g[g.length - 1]).toMatchObject({ i1: 1023, j1: 1023, i0: 960, j0: 960 });
    expect(stepIndices(960, 1023, 8)).toEqual([960, 968, 976, 984, 992, 1000, 1008, 1016, 1023]);
  });
  it('builds up-facing surface triangles plus skirts, and neighbours share their seam exactly', () => {
    const hf = bumpy(65);
    const a = buildChunkGeometry(hf, { cx: 0, cz: 0, i0: 0, i1: 32, j0: 0, j1: 32 }, 2, 1);
    const b = buildChunkGeometry(hf, { cx: 1, cz: 0, i0: 32, i1: 64, j0: 0, j1: 32 }, 2, 1);
    const pa = a.attributes.position;
    const idx = a.index!;
    const surfTris = 16 * 16 * 2;
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    for (let t = 0; t < surfTris; t++) {
      v0.fromBufferAttribute(pa, idx.getX(t * 3));
      v1.fromBufferAttribute(pa, idx.getX(t * 3 + 1));
      v2.fromBufferAttribute(pa, idx.getX(t * 3 + 2));
      expect(v1.clone().sub(v0).cross(v2.clone().sub(v0)).y).toBeGreaterThan(0);
    }
    const seam = (g: THREE.BufferGeometry, x: number) => {
      const out: string[] = [];
      const p = g.attributes.position;
      for (let k = 0; k < 17 * 17; k++) if (Math.abs(p.getX(k) - x) < 1e-6) out.push(`${p.getZ(k).toFixed(4)}:${p.getY(k).toFixed(5)}`);
      return out.sort();
    };
    const x = hf.coord(32);
    expect(seam(a, x)).toEqual(seam(b, x));
    expect(seam(a, x)).toHaveLength(17);
  });
  it('switches LOD with hysteresis', () => {
    const th = [70, 140, 240];
    expect(selectLod(10, -1, th)).toBe(0);
    expect(selectLod(72, 0, th)).toBe(0); // inside the 8 % band: keep
    expect(selectLod(80, 0, th)).toBe(1);
    expect(selectLod(66, 1, th)).toBe(1); // must come below 64.4 to refine
    expect(selectLod(60, 1, th)).toBe(0);
    expect(selectLod(500, 0, th)).toBe(3);
  });
});

describe('terrain collision', () => {
  const bands = { fine: { radius: 30, step: 1 }, coarse: { radius: 50, step: 4 } };
  it('keeps the fine band at full resolution, winds outward, and matches heightAt', () => {
    const hf = bumpy(257); // 102.4 m square
    const g = terrainCollisionGeometry(hf, bands);
    const pos = g.attributes.position;
    expect(pos.count % 3).toBe(0);
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    for (let t = 0; t < pos.count / 3; t++) {
      v0.fromBufferAttribute(pos, t * 3);
      v1.fromBufferAttribute(pos, t * 3 + 1);
      v2.fromBufferAttribute(pos, t * 3 + 2);
      expect(v1.clone().sub(v0).cross(v2.clone().sub(v0)).y).toBeGreaterThan(0);
    }
    const fineCells = Math.PI * 30 * 30 / (0.4 * 0.4);
    expect(pos.count / 6).toBeGreaterThan(fineCells * 0.95);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const rc = new THREE.Raycaster(new THREE.Vector3(3.3, 50, -7.1), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(mesh)[0];
    expect(hit.point.y).toBeCloseTo(hf.heightAt(3.3, -7.1), 4);
  });
  it('covers the ground exactly once where the fine and coarse bands meet (no holes, no doubled surface)', () => {
    const hf = bumpy(257);
    const mesh = new THREE.Mesh(terrainCollisionGeometry(hf, bands), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      const r = 28 + (k % 9) * 0.5; // 28–32 m: straddles the 30 m band edge
      rc.set(new THREE.Vector3(Math.cos(a) * r + 0.013, 60, Math.sin(a) * r + 0.017), down);
      expect(rc.intersectObject(mesh).length).toBe(1);
    }
  });
});

describe('terrain textures', () => {
  it('maps sample positions to texel centres', () => {
    const hf = bumpy(9);
    const t = terrainUvTransform(hf);
    const u = (x: number) => (x - t.x) * t.z;
    expect(u(hf.coord(0))).toBeCloseTo(0.5 / 9, 12);
    expect(u(hf.coord(8))).toBeCloseTo(8.5 / 9, 12);
  });
});

const COVE = 'public/assets/world/cove/';
describe.skipIf(!existsSync(`${COVE}terrain.json`))('the baked Cove heightfield', () => {
  it('decodes, and the spawn stands on flat floor', () => {
    const hdr = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
    const hf = Heightfield.fromUint16LE(hdr, readFileSync(COVE + hdr.files.height));
    const s = hdr.spawn[0];
    expect(Math.abs(hf.heightAt(s.x, s.z))).toBeLessThan(1.5);
    expect(hf.normalAt(s.x, s.z).y).toBeGreaterThan(0.98);
    expect(hf.heightAt(0, -60)).toBeGreaterThan(10); // north rim
  });
});
