import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject } from '../../src/dev/disposeObject';

describe('disposeObject', () => {
  it('disposes a mesh geometry, its material and the material\'s own textures', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);

    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    disposeObject(group);

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes a skinned mesh\'s skeleton (its bone texture)', () => {
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(skeleton);
    const skeletonSpy = vi.spyOn(skeleton, 'dispose');

    disposeObject(mesh);

    expect(skeletonSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes the geometry and material of Points, Line and LineSegments', () => {
    const root = new THREE.Group();
    const objects = [
      new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()),
      new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()),
      new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial()),
    ];
    const spies = objects.flatMap((o) => [
      vi.spyOn(o.geometry, 'dispose'),
      vi.spyOn(o.material as THREE.Material, 'dispose'),
    ]);
    root.add(...objects);

    disposeObject(root);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('closes an ImageBitmap texture source after disposing the texture', () => {
    // GLTFLoader decodes to ImageBitmaps in the browser; texture.dispose() frees only the GPU copy.
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    const texture = new THREE.Texture(bitmap as unknown as ImageBitmap);
    const textureSpy = vi.spyOn(texture, 'dispose');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));

    disposeObject(mesh);

    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(textureSpy.mock.invocationCallOrder[0]).toBeLessThan(bitmap.close.mock.invocationCallOrder[0]);
  });

  it('frees a sprite\'s material and map but not the geometry every sprite shares', () => {
    const map = new THREE.Texture();
    const material = new THREE.SpriteMaterial({ map });
    const sprite = new THREE.Sprite(material);
    const geometrySpy = vi.spyOn(sprite.geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const mapSpy = vi.spyOn(map, 'dispose');

    disposeObject(sprite);

    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1);
    expect(geometrySpy).not.toHaveBeenCalled();
  });

  it('disposes a geometry, material or texture shared inside the subtree once', () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material, material]));
    const spies = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(texture, 'dispose')];

    disposeObject(root);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
