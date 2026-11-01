import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { dragonLook, facetMeshes, FACET } from '../../src/characters/dragon/facet';

describe('dragonLook', () => {
  it('defaults to faceted; ?look=film brings the film look back', () => {
    expect(dragonLook('')).toBe('faceted');
    expect(dragonLook('?review&q=high')).toBe('faceted');
    expect(dragonLook('?look=film')).toBe('film');
  });
});

describe('facetMeshes', () => {
  it('re-indexes the body to its density and keeps every vertex (skin weights, morphs and _mask stay valid)', async () => {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 16));
    const verts = body.geometry.attributes.position.count;
    const before = { body: body.geometry.index!.count / 3, eye: eye.geometry.index!.count / 3 };
    const tris = await facetMeshes([{ mesh: body, part: 'skin' }, { mesh: eye, part: 'eye' }]);
    const after = { body: body.geometry.index!.count / 3, eye: eye.geometry.index!.count / 3 };
    expect(tris).toBe(after.body + after.eye);
    expect(after.body).toBeLessThanOrEqual(before.body * FACET.body * 1.05);
    expect(after.body).toBeGreaterThan(before.body * FACET.body * 0.5);
    // small parts keep a larger share, so they still read
    expect(after.eye / before.eye).toBeGreaterThan(after.body / before.body * 2);
    expect(body.geometry.attributes.position.count).toBe(verts);
    const idx = body.geometry.index!.array;
    for (let i = 0; i < idx.length; i++) expect(idx[i]).toBeLessThan(verts);
  });
});
