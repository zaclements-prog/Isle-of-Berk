import * as THREE from 'three';

export type ShaderParams = Parameters<THREE.Material['onBeforeCompile']>[0];
type CompileHook = (shader: ShaderParams, renderer: THREE.WebGLRenderer) => void;

interface HookState {
  keys: string[];
  hooks: CompileHook[];
  base: THREE.Material['onBeforeCompile'] | null;
  baseKey: () => string;
}

const STATE = new WeakMap<THREE.Material, HookState>();

/**
 * Compose shader patches on one material. three.js has a single onBeforeCompile slot and CSM, fog,
 * wind, etc. all need it — every patch in this project goes through here, never direct assignment.
 * A pre-existing onBeforeCompile (e.g. from CSM.setupMaterial) runs first.
 */
export function addCompileHook(material: THREE.Material, key: string, hook: CompileHook): void {
  let st = STATE.get(material);
  if (!st) {
    const base = material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile ? null : material.onBeforeCompile;
    const s: HookState = { keys: [], hooks: [], base, baseKey: material.customProgramCacheKey.bind(material) };
    STATE.set(material, s);
    material.onBeforeCompile = (shader, renderer) => {
      s.base?.call(material, shader, renderer);
      for (const h of s.hooks) h(shader, renderer);
    };
    material.customProgramCacheKey = () => `${s.baseKey()}|${s.keys.join(',')}`;
    st = s;
  }
  if (st.keys.includes(key)) return;
  st.keys.push(key);
  st.hooks.push(hook);
  material.needsUpdate = true;
}

export interface MaterialPipeline {
  prepare(material: THREE.Material): void;
  prepareTree(root: THREE.Object3D): void;
}

/** Runs each step once per material (order matters: CSM setup must precede compile hooks). */
export function createMaterialPipeline(steps: Array<(m: THREE.Material) => void>): MaterialPipeline {
  const done = new WeakSet<THREE.Material>();
  const prepare = (m: THREE.Material) => {
    if (done.has(m)) return;
    done.add(m);
    for (const step of steps) step(m);
  };
  return {
    prepare,
    prepareTree(root) {
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) prepare(m);
      });
    },
  };
}
