import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createDragonMaterials, DRAGON_MATERIAL_NAMES } from '../../src/characters/dragon/materials';

describe('createDragonMaterials', () => {
  const mats = createDragonMaterials({ sunDir: new THREE.Vector3(0, 1, 0), prepare: () => {} });
  it('provides every material the GLB names', () => {
    expect(DRAGON_MATERIAL_NAMES).toHaveLength(9);
    for (const n of DRAGON_MATERIAL_NAMES) {
      expect(mats.byName(n), n).toBeDefined();
    }
  });
  it('patches the skin and eye shaders through compile hooks', () => {
    for (const [m, key] of [[mats.skin, 'dragonskin'], [mats.eye, 'dragoneye']] as const) {
      expect(m.customProgramCacheKey()).toContain(key);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as any;
      m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain(key === 'dragonskin' ? 'berkScaleHeight' : 'berkEyeIris');
    }
  });
  it("lands every injection in three's physical shader, and keys the membrane's text apart from the skin's", () => {
    const patch = (m: THREE.Material) => {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as any;
      m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      return shader as { vertexShader: string; fragmentShader: string };
    };
    const skin = patch(mats.skin);
    const membrane = patch(mats.membrane);
    const eye = patch(mats.eye);
    for (const s of [skin, membrane]) {
      expect(s.vertexShader).toContain('vBerkBindPos = position');
      // color_fragment, roughnessmap_fragment, normal_fragment_maps, emissivemap_fragment, aomap_fragment
      for (const marker of ['berkCellsPerPx', 'roughnessFactor *= mix', 'grad * berkScaleBump', 'vBerkMask.z * berkPlasmaGlow', 'fres * facing']) {
        expect(s.fragmentShader, marker).toContain(marker);
      }
    }
    expect(skin.fragmentShader).toContain('berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), 38.0)');
    expect(membrane.fragmentShader).toContain('berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), 52.0)');
    expect(mats.skin.customProgramCacheKey()).not.toContain('dragonskin-membrane');
    expect(mats.membrane.customProgramCacheKey()).toContain('dragonskin-membrane');
    expect(eye.fragmentShader).toContain('berkEyeIrisMask = iris');
    expect(eye.fragmentShader).toContain('berkEyeIris * berkEyeIrisMask * berkEyeGlow');
  });
  it('adds its hooks after the app pipeline, so a CSM-style onBeforeCompile overwrite cannot drop them', () => {
    const csm = (shader: { fragmentShader: string }) => { shader.fragmentShader += '\n// csm'; };
    const m2 = createDragonMaterials({ sunDir: new THREE.Vector3(), prepare: (m) => { m.onBeforeCompile = csm as never; } });
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as any;
    m2.skin.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('// csm');
    expect(shader.fragmentShader).toContain('berkScaleHeight');
    expect(shader.vertexShader).toContain('attribute vec3 _mask');
  });
});
