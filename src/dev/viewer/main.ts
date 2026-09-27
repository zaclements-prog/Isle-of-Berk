import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { createGltfLoader } from '../../render/loaders';
import { createTestScene } from '../../world/testScene';
import { debug } from '../../core/debug';
import { loadDragonAsset, type DragonAsset } from '../../characters/dragon/asset';

const app = createApp(document.getElementById('app')!);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
app.camera.position.set(6, 3, 8);
controls.target.set(0, 1, 0);
app.loop.addRender(() => controls.update(), 0);

const params = new URLSearchParams(location.search);
const assetUrl = params.get('asset');
const charName = params.get('char');
const showToothless = charName === 'toothless';
if (charName !== null && !showToothless) console.warn(`[viewer] unknown char '${charName}' (known: toothless)`);

// The grey studio floor is for assets only: the look-dev swatches bring their own ground at y = 0,
// which the floor would z-fight.
if (assetUrl || showToothless) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.9 }),
  );
  floor.receiveShadow = true;
  app.add(floor);
}

const loader = createGltfLoader();
const state = { turntable: false, wireframe: false, skeleton: false, playing: false, clip: '', time: 0 };
let current: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
let action: THREE.AnimationAction | null = null;
let helper: THREE.SkeletonHelper | null = null;
const gui = new GUI({ title: 'Asset Viewer' });
let morphFolder: GUI | null = null;
let clipFolder: GUI | null = null;
/** Folders that drive one shown character (Face, Eyes, Skin): they go with it when show() replaces it. */
let charFolders: GUI[] = [];

function frameObject(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  controls.target.copy(center);
  app.camera.position.set(center.x + r * 1.1, center.y + r * 0.45, center.z + r * 1.3);
}

function stats() {
  let tris = 0;
  let bones = 0;
  const morphs: string[] = [];
  const materials = new Set<string>();
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const name of Object.keys(m.morphTargetDictionary ?? {})) morphs.push(`${m.name}:${name}`);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat.name || mat.type);
    }
    if ((o as THREE.Bone).isBone) bones++;
  });
  return { tris, bones, morphs, clips: clips.map((c) => c.name), materials: [...materials] };
}

function buildMorphUi(): void {
  morphFolder?.destroy();
  morphFolder = gui.addFolder('Morph targets');
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
    for (const [name, i] of Object.entries(m.morphTargetDictionary)) {
      // morphTargetInfluences is a plain number[]; lil-gui's add<T>(obj, key: keyof T) only accepts
      // array member keys ('length', numeric literals, ...), not the arbitrary string index we build
      // here. The write still lands on the same array at runtime, so cast the target's static type.
      morphFolder!.add(m.morphTargetInfluences as unknown as Record<string, number>, String(i), 0, 1, 0.01).name(`${m.name}:${name}`);
    }
  });
}

function playClip(name: string): void {
  if (!mixer) return;
  const clip = clips.find((c) => c.name === name);
  if (!clip) return;
  mixer.stopAllAction();
  action = mixer.clipAction(clip);
  action.play();
  state.clip = name;
  state.playing = true;
}

function buildClipUi(): void {
  clipFolder?.destroy();
  clipFolder = gui.addFolder('Clips');
  if (!clips.length) return;
  const names = clips.map((c) => c.name);
  state.clip = names[0];
  clipFolder.add(state, 'clip', names).onChange(playClip);
  clipFolder.add(state, 'playing');
  clipFolder.add(state, 'time', 0, Math.max(...clips.map((c) => c.duration)), 0.001).onChange((t: number) => {
    state.playing = false;
    if (mixer) mixer.setTime(t);
  });
}

/**
 * Replace the shown object with root: the previous one goes through app.remove (CSM release + GPU free), and
 * root gets the clip, morph and skeleton tooling. morphUi: false skips the per-primitive morph sliders (a
 * character brings its own, one per morph).
 */
function show(root: THREE.Object3D, animations: THREE.AnimationClip[], opts = { morphUi: true }) {
  if (current) {
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(current);
    }
    app.remove(current); // releases its materials from CSM, detaches it and frees its GPU resources
  }
  for (const f of charFolders) f.destroy();
  charFolders = [];
  action = null; // it belonged to the old mixer
  helper?.removeFromParent();
  helper?.dispose();
  current = root;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  app.add(current);
  frameObject(current);
  clips = animations;
  mixer = clips.length ? new THREE.AnimationMixer(current) : null;
  helper = new THREE.SkeletonHelper(current);
  helper.visible = state.skeleton;
  (helper.material as THREE.LineBasicMaterial).fog = false; // a dev overlay: keep it crisp under scene.fog (the N8AO fog proxy)
  app.scene.add(helper); // exempt from the material pipeline (Ruling 3)
  if (opts.morphUi) buildMorphUi();
  else {
    morphFolder?.destroy();
    morphFolder = null;
  }
  buildClipUi();
  return stats();
}

async function load(url: string) {
  const gltf = await loader.loadAsync(url);
  return show(gltf.scene, gltf.animations);
}

async function loadToothless(): Promise<DragonAsset> {
  const asset = await loadDragonAsset({
    glbUrl: 'assets/characters/toothless/toothless.glb',
    posesUrl: 'assets/characters/toothless/toothless.poses.glb',
    rigUrl: 'assets/characters/toothless/toothless.rig.json',
    sunDir: app.lighting.sunDir,
    prepare: (m) => app.materials.prepare(m),
  });
  show(asset.root, [...asset.clips.values()], { morphUi: false });   // one slider per morph, not per primitive
  playClip('bind');
  const face = gui.addFolder('Face');
  const weights: Record<string, number> = Object.fromEntries(asset.morphNames.map((n) => [n, 0]));
  for (const n of asset.morphNames) face.add(weights, n, 0, 1, 0.01).onChange((w: number) => asset.setMorph(n, w));
  const u = asset.materials.uniforms;
  const eyes = gui.addFolder('Eyes');
  eyes.add(u.pupil, 'value', 0, 1, 0.01).name('pupil');
  eyes.add(u.eyeGlow, 'value', 0, 1, 0.01).name('glow');
  eyes.add(u.irisDepth, 'value', 0, 0.2, 0.005).name('iris depth');
  const skin = gui.addFolder('Skin');
  skin.add(u.rimStrength, 'value', 0, 1.5, 0.01).name('rim');
  skin.add(u.scaleBump, 'value', 0, 0.02, 0.0005).name('scale bump (m)');
  skin.add(u.plasmaGlow, 'value', 0, 1, 0.01).name('plasma glow');
  charFolders = [face, eyes, skin];
  debug.register('dragon', {
    clip: (name: string) => playClip(name),
    morph: (name: string, w: number) => asset.setMorph(name, w),
    pupil: (v: number) => { u.pupil.value = v; },
    stats: () => ({ ...stats(), morphs: asset.morphNames, bones: asset.skeleton.bones.length }),
  });
  return asset;
}

const view = gui.addFolder('View');
view.add(state, 'turntable');
view.add(state, 'wireframe').onChange((w: boolean) => {
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).wireframe = w;
  });
});
view.add(state, 'skeleton').onChange((v: boolean) => { if (helper) helper.visible = v; });
const exposureUi = { exposure: app.renderer.toneMappingExposure };
view.add(exposureUi, 'exposure', 0.2, 3, 0.01).onChange((v: number) => { app.renderer.toneMappingExposure = v; });

app.loop.addSim((dt) => {
  if (current && state.turntable) current.rotation.y += dt * 0.5;
  if (mixer && state.playing) {
    mixer.update(dt);
    state.time = action ? action.time : 0;
  }
});

debug.register('viewer', {
  load,
  stats,
  turntable: (on: boolean) => { state.turntable = on; },
  clip: (name: string) => playClip(name),
  pose: (t: number) => { state.playing = false; mixer?.setTime(t); },
  morph: (meshName: string, morphName: string, weight: number) => {
    const mesh = current?.getObjectByName(meshName) as THREE.Mesh | undefined;
    const i = mesh?.morphTargetDictionary?.[morphName];
    if (mesh?.morphTargetInfluences && i !== undefined) mesh.morphTargetInfluences[i] = weight;
    return i !== undefined;
  },
  /** Place the orbit camera (world metres) for repeatable captures; returns where it is now. */
  camera: (position?: [number, number, number], target?: [number, number, number]) => {
    if (position) app.camera.position.set(...position);
    if (target) controls.target.set(...target);
    controls.update();
    return { position: app.camera.position.toArray(), target: controls.target.toArray() };
  },
});

if (showToothless) {
  loadToothless().catch((e) => console.error('[viewer] failed to load Toothless', e));
} else if (assetUrl) {
  load(assetUrl).catch((e) => console.error('[viewer] failed to load', assetUrl, e));
} else {
  const test = createTestScene();
  app.add(test.root);
}
const subject = showToothless ? 'char:toothless' : (assetUrl ?? 'look-dev swatches');
document.getElementById('hud')!.textContent = `Asset Viewer · ${subject} · quality: ${app.preset.name}`;
app.loop.start();
