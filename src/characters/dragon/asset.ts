import * as THREE from 'three';
import { createGltfLoader } from '../../render/loaders';
import { validateRig, type RigMeta } from './rigMeta';
import { createDragonMaterials, DRAGON_MATERIAL_NAMES, type DragonMaterials } from './materials';

export interface DragonAsset {
  root: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  rig: RigMeta;
  clips: Map<string, THREE.AnimationClip>;
  morphNames: string[];
  setMorph(name: string, weight: number): void;
  materials: DragonMaterials;
}

/**
 * Validate a loaded GLB scene against the engine's expectations, before any engine material is created (and
 * CSM-registered) for it: every skinned mesh's placeholder material must be a name createDragonMaterials knows,
 * there must be at least one skinned mesh, and the first one's skeleton must carry every bone rig.json references.
 * Pure (no mutation, no material/CSM work) so a bad GLB can fail before there is anything to unwind.
 */
export function checkDragonScene(scene: THREE.Object3D, rig: RigMeta): { meshes: THREE.SkinnedMesh[]; skeleton: THREE.Skeleton } {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    meshes.push(m);
    const name = (m.material as THREE.Material).name;
    if (!DRAGON_MATERIAL_NAMES.includes(name)) throw new Error(`dragon asset: no engine material for '${name}'`);
  });
  if (!meshes.length) throw new Error('dragon asset: no skinned meshes');
  const skeleton = meshes[0].skeleton;
  const boneNames = new Set(skeleton.bones.map((b) => b.name));
  for (const b of rig.bones) if (!boneNames.has(b.name)) throw new Error(`dragon asset: GLB lacks bone '${b.name}'`);
  return { meshes, skeleton };
}

/**
 * Load a dragon GLB (bind pose, one SkinnedMesh per material), its pose clips and its rig.json, and bind the
 * engine's materials by GLB material name. The GLB's placeholder materials and default morph weights are never
 * trusted. The caller adds `root` to the scene (app.add) and removes it with app.remove, which frees everything
 * under it, the dragon materials included.
 *
 * checkDragonScene runs before createDragonMaterials, so a bad GLB (unknown material name, a skeleton missing a
 * rig bone) throws before the engine's 9 materials exist. Created after, they'd have no `root` for the caller to
 * remove and so would stay registered with CSM for the rest of the page session (see releaseMaterial in
 * render/lighting.ts).
 */
export async function loadDragonAsset(opts: {
  glbUrl: string; posesUrl: string; rigUrl: string; sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void;
}): Promise<DragonAsset> {
  const loader = createGltfLoader();
  const [gltf, poses, rigRaw] = await Promise.all([
    loader.loadAsync(opts.glbUrl),
    loader.loadAsync(opts.posesUrl),
    fetch(opts.rigUrl).then((r) => {
      if (!r.ok) throw new Error(`dragon asset: ${opts.rigUrl} → HTTP ${r.status}`);
      return r.json();
    }),
  ]);
  const rig = validateRig(rigRaw);
  const { meshes, skeleton } = checkDragonScene(gltf.scene, rig);
  const materials = createDragonMaterials({ sunDir: opts.sunDir, prepare: opts.prepare });
  const bones = new Map(skeleton.bones.map((b) => [b.name, b]));
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds don't follow the pose
    const name = (m.material as THREE.Material).name;
    const replacement = materials.byName(name);
    if (!replacement) throw new Error(`dragon asset: unreachable — checkDragonScene already validated material '${name}'`);
    m.material = replacement;
    if (m.morphTargetInfluences) m.morphTargetInfluences.fill(0); // never trust file default weights
  }
  const morphNames = Object.keys(meshes[0].morphTargetDictionary ?? {});
  return {
    root: gltf.scene,
    meshes,
    skeleton,
    bones,
    rig,
    clips: new Map(poses.animations.map((c) => [c.name, c])),   // tracks bind to bones by name
    morphNames,
    setMorph(name, weight) {
      for (const m of meshes) {
        const i = m.morphTargetDictionary?.[name];
        if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = weight;
      }
    },
    materials,
  };
}
