import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { createGltfLoader } from '../../render/loaders';
import { createTestScene } from '../../world/testScene';
import { disposeObject } from '../disposeObject';
import { debug } from '../../core/debug';

const app = createApp(document.getElementById('app')!);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
app.camera.position.set(6, 3, 8);
controls.target.set(0, 1, 0);
app.loop.addRender(() => controls.update(), 0);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.9 }),
);
floor.receiveShadow = true;
app.add(floor);

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

async function load(url: string) {
  const gltf = await loader.loadAsync(url);
  if (current) {
    app.scene.remove(current);
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(current);
    }
    disposeObject(current);
  }
  helper?.removeFromParent();
  helper?.dispose();
  current = gltf.scene;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  app.add(current);
  frameObject(current);
  clips = gltf.animations;
  mixer = clips.length ? new THREE.AnimationMixer(current) : null;
  helper = new THREE.SkeletonHelper(current);
  helper.visible = state.skeleton;
  app.scene.add(helper);
  buildMorphUi();
  buildClipUi();
  return stats();
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
});

const assetUrl = new URLSearchParams(location.search).get('asset');
if (assetUrl) {
  load(assetUrl).catch((e) => console.error('[viewer] failed to load', assetUrl, e));
} else {
  const test = createTestScene();
  app.add(test.root);
}
document.getElementById('hud')!.textContent = `Asset Viewer · ${assetUrl ?? 'look-dev swatches'} · quality: ${app.preset.name}`;
app.loop.start();
