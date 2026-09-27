import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { selectFiles, manifestEntry, creditsMarkdown, findMapFile, cachePath } from './polyhaven.mjs';

const textureFiles = {
  Diffuse: { '2k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/forest_ground_04/forest_ground_04_diff_2k.jpg', size: 4529321, md5: 'f6ce' } } },
  nor_gl: { '2k': { png: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/forest_ground_04/forest_ground_04_nor_gl_2k.png', size: 9987026, md5: 'c7bf' } } },
  arm: { '2k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/forest_ground_04/forest_ground_04_arm_2k.jpg', size: 3418726, md5: 'c688' } } },
};

const modelFiles = {
  gltf: { '1k': { gltf: {
    url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_moss_set_01/rock_moss_set_01_1k.gltf', size: 9987, md5: '7511',
    include: {
      'rock_moss_set_01.bin': { url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/rock_moss_set_01/rock_moss_set_01.bin', size: 100, md5: 'aa' },
      'textures/rock_moss_set_01_diff_1k.jpg': { url: 'https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_moss_set_01/rock_moss_set_01_diff_1k.jpg', size: 200, md5: 'bb' },
    },
  } } },
};

describe('selectFiles', () => {
  it('picks the requested texture maps in their preferred formats', () => {
    const out = selectFiles(textureFiles, { id: 'forest_ground_04', type: 'textures', res: '2k', maps: ['diff', 'nor', 'arm'] });
    expect(out.map((f) => f.path)).toEqual([
      'forest_ground_04_diff_2k.jpg', 'forest_ground_04_nor_gl_2k.png', 'forest_ground_04_arm_2k.jpg',
    ]);
    expect(out[0].md5).toBe('f6ce');
  });

  it('includes a model gltf and all its dependencies at their relative paths', () => {
    const out = selectFiles(modelFiles, { id: 'rock_moss_set_01', type: 'models', res: '1k' });
    expect(out.map((f) => f.path)).toEqual([
      'rock_moss_set_01_1k.gltf', 'rock_moss_set_01.bin', 'textures/rock_moss_set_01_diff_1k.jpg',
    ]);
  });

  it('throws a clear error when a map or resolution is missing', () => {
    expect(() => selectFiles(textureFiles, { id: 'forest_ground_04', type: 'textures', res: '4k', maps: ['diff'] }))
      .toThrow(/forest_ground_04: missing Diffuse 4k jpg/);
  });
});

describe('findMapFile', () => {
  const entry = (id, res = '2k') => ({
    id,
    res,
    files: [`${id}_diff_${res}.jpg`, `${id}_nor_gl_${res}.png`, `${id}_arm_${res}.jpg`].map((path) => ({ path })),
  });

  it('finds each cached map of a manifest entry', () => {
    const e = entry('forest_ground_04');
    expect(findMapFile(e, 'diff').path).toBe('forest_ground_04_diff_2k.jpg');
    expect(findMapFile(e, 'nor').path).toBe('forest_ground_04_nor_gl_2k.png');
    expect(findMapFile(e, 'arm').path).toBe('forest_ground_04_arm_2k.jpg');
  });

  it('is not fooled by an asset id that itself contains a map token', () => {
    const e = entry('rock_arm_01'); // every file name contains `_arm_`
    expect(findMapFile(e, 'arm').path).toBe('rock_arm_01_arm_2k.jpg');
    expect(findMapFile(e, 'diff').path).toBe('rock_arm_01_diff_2k.jpg');
    const n = entry('moss_nor_gl_bank'); // ...or `_nor_gl_`
    expect(findMapFile(n, 'nor').path).toBe('moss_nor_gl_bank_nor_gl_2k.png');
    expect(findMapFile(n, 'arm').path).toBe('moss_nor_gl_bank_arm_2k.jpg');
  });

  it('only matches the entry\'s resolution', () => {
    const e = { id: 'a', res: '2k', files: [{ path: 'a_diff_1k.jpg' }] };
    expect(findMapFile(e, 'diff')).toBeUndefined();
  });
});

describe('cachePath', () => {
  const cache = resolve('pipeline-cache-test');

  it('resolves a file (or a nested include) inside the asset\'s cache folder', () => {
    expect(cachePath(cache, 'rock_moss_set_01', 'rock_moss_set_01.bin')).toBe(join(cache, 'rock_moss_set_01', 'rock_moss_set_01.bin'));
    expect(cachePath(cache, 'rock_moss_set_01', 'textures/a_diff_1k.jpg')).toBe(join(cache, 'rock_moss_set_01', 'textures', 'a_diff_1k.jpg'));
  });

  it('refuses any path that resolves outside the cache folder', () => {
    for (const [id, rel] of [
      ['rock', '../../escape.bin'],
      ['rock', '../../../etc/passwd'],
      ['..', 'wanted.json'],
      ['rock', resolve('elsewhere', 'abs.bin')],
      ['rock', '..'],
    ]) {
      expect(() => cachePath(cache, id, rel), `${id} + ${rel}`).toThrow(/outside the cache/);
    }
  });
});

describe('manifest + credits', () => {
  it('records licence, source page and file hashes', () => {
    const want = { id: 'forest_ground_04', type: 'textures', res: '2k' };
    const e = manifestEntry(want, [{ path: 'a.jpg', md5: 'x', size: 1, url: 'u' }]);
    expect(e).toEqual({ id: 'forest_ground_04', type: 'textures', res: '2k', license: 'CC0', source: 'https://polyhaven.com/a/forest_ground_04', files: [{ path: 'a.jpg', md5: 'x', size: 1 }] });
  });

  it('renders a sorted credits table', () => {
    const md = creditsMarkdown([
      { id: 'z_rock', type: 'models', source: 'https://polyhaven.com/a/z_rock', license: 'CC0' },
      { id: 'a_ground', type: 'textures', source: 'https://polyhaven.com/a/a_ground', license: 'CC0' },
    ]);
    expect(md.indexOf('a_ground')).toBeLessThan(md.indexOf('z_rock'));
    expect(md).toContain('| a_ground | textures | https://polyhaven.com/a/a_ground | CC0 |');
  });
});
