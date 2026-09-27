import * as THREE from 'three';

export type ShaderParams = Parameters<THREE.Material['onBeforeCompile']>[0];
type CompileHook = (shader: ShaderParams, renderer: THREE.WebGLRenderer) => void;

interface HookState {
  keys: string[];
  hooks: CompileHook[];
  base: THREE.Material['onBeforeCompile'] | null;
  baseKey: () => string;
  /** The composed function currently (or most recently) installed as material.onBeforeCompile. */
  wrapper: CompileHook;
}

const STATE = new WeakMap<THREE.Material, HookState>();

const isDefaultOnBeforeCompile = (material: THREE.Material) =>
  material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;

/**
 * Compose shader patches on one material. three.js has a single onBeforeCompile slot and CSM, fog,
 * wind, etc. all need it — every patch in this project goes through here, never direct assignment.
 * A pre-existing onBeforeCompile (e.g. from CSM.setupMaterial) runs first.
 *
 * Contract: a hook KEY must fully determine the shader text its hook injects. three reuses a compiled
 * program for every material whose program cache key matches, and with composed hooks that key is
 * the wrapper's source (Material.customProgramCacheKey() is onBeforeCompile.toString() — identical
 * for every material) plus the hook keys. So two materials whose hooks share a key but inject
 * different text would silently share one program. Per-material values go through uniforms or
 * `material.defines` (defines are part of the key), never through text baked in by a closure.
 */
export function addCompileHook(material: THREE.Material, key: string, hook: CompileHook): void {
  let st = STATE.get(material);
  if (!st) {
    const base = isDefaultOnBeforeCompile(material) ? null : material.onBeforeCompile;
    const s: HookState = {
      keys: [],
      hooks: [],
      base,
      baseKey: material.customProgramCacheKey.bind(material),
      wrapper: (shader, renderer) => {
        s.base?.call(material, shader, renderer);
        for (const h of s.hooks) h(shader, renderer);
      },
    };
    STATE.set(material, s);
    material.onBeforeCompile = s.wrapper;
    material.customProgramCacheKey = () => `${s.baseKey()}|${s.keys.join(',')}`;
    st = s;
  }
  if (st.keys.includes(key)) return;
  st.keys.push(key);
  st.hooks.push(hook);
  material.needsUpdate = true;
}

/**
 * Re-adopt whatever is currently on material.onBeforeCompile as the base that composed hooks run
 * after — even when it was assigned AFTER hooks were composed (e.g. CSM.setupMaterial runs, then
 * assigns onBeforeCompile directly, clobbering our wrapper). Call this right after any such direct
 * assignment so the wrapper (and the hooks it carries) goes back on top, with that assignment as
 * its new base. This makes setup order irrelevant: CSM-then-hooks and hooks-then-CSM both compose
 * correctly. No-op on a material with no composed hooks.
 */
export function adoptBaseCompileHook(material: THREE.Material): void {
  const st = STATE.get(material);
  if (!st) return;
  if (material.onBeforeCompile !== st.wrapper) {
    st.base = isDefaultOnBeforeCompile(material) ? null : material.onBeforeCompile;
    material.onBeforeCompile = st.wrapper;
    material.needsUpdate = true;
  }
}

/**
 * Drop whatever base is composed under our hooks, without disturbing the hooks themselves. Needed
 * because e.g. CSM.dispose() does `delete material.onBeforeCompile`, which removes the wrapper
 * (the current OWN property by then, not CSM's original assignment) and leaves STATE thinking
 * hooks are still wired up when they're actually unreachable. Call this after disposing whatever
 * installed the base, to restore the remaining hooks (fog, wind, ...) without it. No-op on a
 * material with no composed hooks.
 */
export function releaseBaseCompileHook(material: THREE.Material): void {
  const st = STATE.get(material);
  if (!st) return;
  st.base = null;
  material.onBeforeCompile = st.wrapper;
  material.needsUpdate = true;
}

export interface MaterialPipeline {
  prepare(material: THREE.Material): void;
  prepareTree(root: THREE.Object3D): void;
}

/**
 * Runs each step once per material. Order no longer affects correctness — a step that assigns
 * onBeforeCompile directly (e.g. CSM.setupMaterial) composes correctly with addCompileHook-based
 * steps whichever runs first, as long as it calls adoptBaseCompileHook afterward (see lighting.ts)
 * — but CSM setup first is still the convention.
 *
 * Contract: the pipeline only sees materials that are on the tree when app.add(root) runs. Any
 * material assigned later — a swapped material, a runtime-created one, or a clone (material.clone()
 * carries none of the setup: not the composed hooks, which live in a WeakMap, not the BERK_FOG / CSM
 * defines, which Mesh*Material.copy() resets, and not CSM's registration) — must go through
 * app.materials.prepare(m) before it renders, or it renders without CSM cascades and fog.
 */
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
