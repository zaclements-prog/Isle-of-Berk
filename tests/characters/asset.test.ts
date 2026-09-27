import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const GLB_URL = 'toothless.glb';
const POSES_URL = 'toothless.poses.glb';
const RIG_URL = 'toothless.rig.json';

const rig = JSON.parse(readFileSync('public/assets/characters/toothless/toothless.rig.json', 'utf8'));
const RIG_BONE_NAMES: string[] = rig.bones.map((b: { name: string }) => b.name);

// The fake GLB scene the mocked loader hands back for GLB_URL; each test overwrites it before loading.
let glbScene: THREE.Object3D = new THREE.Group();

vi.mock('../../src/render/loaders', () => ({
  createGltfLoader: () => ({
    loadAsync: async (url: string) =>
      url === POSES_URL ? { scene: new THREE.Group(), animations: [] } : { scene: glbScene, animations: [] },
  }),
}));

// Imported after the mock above so it picks up the mocked loaders module (vi.mock is hoisted regardless of order).
import { loadDragonAsset } from '../../src/characters/dragon/asset';

/** A GLB-like scene: one SkinnedMesh named `materialName`, bound to a flat skeleton with one bone per name. */
function makeGlbScene(materialName: string, boneNames: string[]): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ name: materialName });
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
  const boneRoot = new THREE.Group();
  const bones = boneNames.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    boneRoot.add(bone);
    return bone;
  });
  mesh.bind(new THREE.Skeleton(bones));
  const scene = new THREE.Group();
  scene.add(mesh);
  scene.add(boneRoot);
  return scene;
}

describe('loadDragonAsset', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubRigFetch() {
    globalThis.fetch = (async () => ({ ok: true, json: async () => rig })) as unknown as typeof fetch;
  }

  it("rejects a GLB material name the engine doesn't know, and never prepares (CSM-registers) any material", async () => {
    stubRigFetch();
    glbScene = makeGlbScene('nope', ['pelvis']);
    const prepare = vi.fn();
    await expect(
      loadDragonAsset({ glbUrl: GLB_URL, posesUrl: POSES_URL, rigUrl: RIG_URL, sunDir: new THREE.Vector3(0, 1, 0), prepare }),
    ).rejects.toThrow(/no engine material for 'nope'/);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects a GLB whose skeleton lacks a rig bone, and never prepares (CSM-registers) any material', async () => {
    stubRigFetch();
    glbScene = makeGlbScene('skin', ['root']);
    const prepare = vi.fn();
    await expect(
      loadDragonAsset({ glbUrl: GLB_URL, posesUrl: POSES_URL, rigUrl: RIG_URL, sunDir: new THREE.Vector3(0, 1, 0), prepare }),
    ).rejects.toThrow(/GLB lacks bone/);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('binds the engine material once the GLB and its skeleton check out', async () => {
    stubRigFetch();
    glbScene = makeGlbScene('skin', RIG_BONE_NAMES);
    const prepare = vi.fn();
    const asset = await loadDragonAsset({
      glbUrl: GLB_URL, posesUrl: POSES_URL, rigUrl: RIG_URL, sunDir: new THREE.Vector3(0, 1, 0), prepare,
    });
    expect(prepare).toHaveBeenCalledTimes(9);
    expect(asset.meshes[0].material).toBe(asset.materials.skin);
  });
});
