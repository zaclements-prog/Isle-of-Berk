import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const GLB_URL = 'toothless.glb';
const POSES_URL = 'toothless.poses.glb';
const RIG_URL = 'toothless.rig.json';

const rig = JSON.parse(readFileSync('public/assets/characters/toothless/toothless.rig.json', 'utf8'));
const RIG_BONE_NAMES: string[] = rig.bones.map((b: { name: string }) => b.name);

// The fake GLB scene and pose clips the mocked loader hands back; each test overwrites them before loading.
let glbScene: THREE.Object3D = new THREE.Group();
let poseClips: THREE.AnimationClip[] = [];

vi.mock('../../src/render/loaders', () => ({
  createGltfLoader: () => ({
    loadAsync: async (url: string) =>
      url === POSES_URL ? { scene: new THREE.Group(), animations: poseClips } : { scene: glbScene, animations: [] },
  }),
}));

// Imported after the mock above so it picks up the mocked loaders module (vi.mock is hoisted regardless of order).
import { loadDragonAsset, blinkWeights } from '../../src/characters/dragon/asset';

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

  it('blinks through the three keys (0 / 0.5 / 1 -> (0,0,0) / (0.5,0.5,0) / (0,0,1)) and closes the jaw at rest, clips included', async () => {
    stubRigFetch();
    glbScene = makeGlbScene('skin', RIG_BONE_NAMES);
    const mesh = glbScene.children[0] as THREE.SkinnedMesh;
    const names: string[] = [...rig.blink.L, ...rig.blink.R];
    mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
    const jawTrack = new THREE.QuaternionKeyframeTrack('jaw.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const other = new THREE.QuaternionKeyframeTrack('head.quaternion', [0], [0, 0, 0, 1]);
    poseClips = [new THREE.AnimationClip('bind', 1, [jawTrack, other])];
    const asset = await loadDragonAsset({
      glbUrl: GLB_URL, posesUrl: POSES_URL, rigUrl: RIG_URL, sunDir: new THREE.Vector3(0, 1, 0), prepare: vi.fn(),
    });
    const weightsOf = (side: 'L' | 'R') => rig.blink[side].map((n: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![n]]);
    for (const [w, want] of [[0, [0, 0, 0]], [0.5, [0.5, 0.5, 0]], [1, [0, 0, 1]]] as const) {
      asset.setBlink('L', w);
      weightsOf('L').forEach((got: number, k: number) => expect(got).toBeCloseTo(want[k], 12));
    }
    expect(weightsOf('R')).toEqual([0, 0, 0]);   // the other eye is untouched
    const close = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rig.jaw.restCloseRad);
    expect(Math.abs(asset.bones.get('jaw')!.quaternion.dot(close))).toBeCloseTo(1, 12);
    for (let i = 0; i < 8; i += 4) {   // track values are float32
      expect(Math.abs(new THREE.Quaternion().fromArray(jawTrack.values, i).dot(close))).toBeCloseTo(1, 6);
    }
    expect(Array.from(other.values)).toEqual([0, 0, 0, 1]);   // only the jaw's track turns
    poseClips = [];
  });
});

describe('blinkWeights', () => {
  it('maps a blink weight piecewise-linearly onto the 1/3, 2/3 and full keys, continuously and clamped', () => {
    expect(blinkWeights(0)).toEqual([0, 0, 0]);
    expect(blinkWeights(1 / 3)).toEqual([1, 0, 0]);
    blinkWeights(0.5).forEach((v, k) => expect(v).toBeCloseTo([0.5, 0.5, 0][k], 12));
    expect(blinkWeights(1)).toEqual([0, 0, 1]);
    expect(blinkWeights(-0.3)).toEqual([0, 0, 0]);
    expect(blinkWeights(1.4)).toEqual([0, 0, 1]);
    let prev = blinkWeights(0);
    for (let i = 1; i <= 300; i++) {
      const cur = blinkWeights(i / 300);
      expect(Math.max(...cur.map((v, k) => Math.abs(v - prev[k])))).toBeLessThanOrEqual(0.011);
      expect(cur.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9);
      prev = cur;
    }
  });
});
