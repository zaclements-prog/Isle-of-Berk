import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createStylizedTerrainMaterial, createStylizedUniforms, STYLE_PALETTE } from '../../src/world/island/stylizedTerrain';
import { Grass, tuftGeometry, flowerGeometry, type GrassField } from '../../src/world/island/grass';
import { broadleafGeometry, buildProps, pineGeometry } from '../../src/world/island/props';

const stdShader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });

describe('stylised terrain material', () => {
  it('replaces the photo splat with palette colours, faceted rock normals and no texture arrays', () => {
    const u = createStylizedUniforms();
    const m = createStylizedTerrainMaterial(u);
    const s = stdShader();
    m.onBeforeCompile(s as never, {} as never);
    expect(s.fragmentShader).toContain('uniform vec3 uStyleColors[8];');
    expect(s.fragmentShader).toContain('dFdx(p)');
    expect(s.fragmentShader).not.toContain('sampler2DArray');
    expect(s.fragmentShader).not.toContain('#include <map_fragment>');
    expect(s.vertexShader).toContain('vTerrainPos');
    expect((s.uniforms as Record<string, unknown>).uStyleColors).toBe(u.uStyleColors);
    expect(u.uStyleColors.value[0].equals(new THREE.Color(STYLE_PALETTE.grass))).toBe(true);
  });

  it('fails loudly if three renames a chunk', () => {
    const m = createStylizedTerrainMaterial(createStylizedUniforms());
    const s = stdShader();
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', '');
    expect(() => m.onBeforeCompile(s as never, {} as never)).toThrow(/anchor/);
  });
});

describe('stylised vegetation', () => {
  it('grows short grass tufts, base darker than the tips, lit straight up', () => {
    const g = tuftGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThan(0.5);
    const col = g.attributes.color;
    expect(col.getY(2)).toBeGreaterThan(col.getY(0));          // tip greener-lighter than the root
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBe(1);
    expect(flowerGeometry().attributes.bend).toBeDefined();
  });

  it('builds pines and broadleaf trees lighter at the top than the bottom', () => {
    for (const g of [pineGeometry(1), broadleafGeometry(0)]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeGreaterThan(6);
      const pos = g.attributes.position;
      const col = g.attributes.color;
      let lo = 0;
      let hi = 0;
      let nl = 0;
      let nh = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 4) continue;                          // foliage only (the trunk is below)
        if (pos.getY(i) < 5.5) { lo += col.getY(i); nl++; } else { hi += col.getY(i); nh++; }
      }
      expect(hi / nh).toBeGreaterThan(lo / nl);
    }
  });

  it('keeps a ring of grass round the camera, the same tufts in the same cells, none below the shore', () => {
    const field: GrassField = {
      height: () => 5,
      upness: () => 1,
      density: (x) => (x < 0 ? 0 : 1),                           // no grass west of x = 0
      flowers: () => 0.5,
    };
    const grass = new Grass(field, { radius: 12, cell: 0.8 });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 10, 0);
    grass.update(0.016, cam);
    const n = grass.tufts.count;
    expect(n).toBeGreaterThan(100);
    expect(grass.flowers.count).toBeGreaterThan(0);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const first: number[] = [];
    for (let k = 0; k < n; k++) {
      grass.tufts.getMatrixAt(k, m);
      p.setFromMatrixPosition(m);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(12.001);
      expect(p.x).toBeGreaterThanOrEqual(0);
      if (k < 20) first.push(p.x, p.z);
    }
    // move away and back: the same tufts come back (cells are hashed, not random)
    cam.position.set(30, 10, 0);
    grass.update(0.016, cam);
    cam.position.set(0, 10, 0);
    grass.update(0.016, cam);
    expect(grass.tufts.count).toBe(n);
    for (let k = 0; k < 20; k++) {
      grass.tufts.getMatrixAt(k, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(first[k * 2]);
      expect(p.z).toBeCloseTo(first[k * 2 + 1]);
    }
    grass.dispose();
  });
});

describe('grass parting and tree sway', () => {
  it('feeds the touching spheres to the grass shader, which pushes tufts aside and flattens them', () => {
    const field: GrassField = { height: () => 0, upness: () => 1, density: () => 1, flowers: () => 0 };
    const grass = new Grass(field, { radius: 6, cell: 0.8 });
    const cam = new THREE.PerspectiveCamera();
    const paws = [{ center: new THREE.Vector3(1, 0.05, 0), radius: 0.3 }, { center: new THREE.Vector3(-1, 0.05, 0), radius: 0.3 }];
    grass.update(0.016, cam, paws);
    const u = (grass as unknown as { uniforms: { uGrassPush: { value: THREE.Vector4[] }; uGrassPushN: { value: number } } }).uniforms;
    expect(u.uGrassPushN.value).toBe(2);
    expect(u.uGrassPush.value[1].toArray()).toEqual([-1, 0.05, 0, 0.3]);
    const s = stdShader();
    (grass.tufts.material as THREE.Material).onBeforeCompile(s as never, {} as never);
    expect(s.vertexShader).toContain('uniform vec4 uGrassPush[12];');
    expect(s.vertexShader).toContain('inverse(mat3(instanceMatrix)) * push');
    grass.update(0.016, cam, []);
    expect(u.uGrassPushN.value).toBe(0);
    grass.dispose();
  });

  it('sways the trees from the base up, with time', () => {
    const props = buildProps([[0, 0, 0, 1, 0, 0], [5, 0, 5, 1, 1, 0]], [], () => 0);
    const mesh = props.root.children[0] as THREE.InstancedMesh;
    const s = stdShader();
    (mesh.material as THREE.Material).onBeforeCompile(s as never, {} as never);
    expect(s.vertexShader).toContain('uniform float uTreeTime;');
    expect(s.vertexShader).toContain('float bendK = h * h;');
    props.update(0.5);
    expect((s.uniforms as Record<string, { value: number }>).uTreeTime.value).toBeCloseTo(0.5);
    props.dispose();
  });
});
