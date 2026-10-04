import * as THREE from 'three';
import { addCompileHook } from '../../render/materials';

/**
 * The engine's own materials for the dragon GLB (whose materials are placeholders), one per GLB material name.
 * Film look (spec §4.5, §5.7, §5.8): near-black skin with procedural scales, vertex AO from `_mask`, a cool rim and
 * sheen; procedural eyes; a plasma-glow hook on the dorsal plates. Tunables are shared uniforms (`uniforms`).
 */
export interface DragonMaterials {
  skin: THREE.MeshPhysicalMaterial;
  membrane: THREE.MeshPhysicalMaterial;
  eye: THREE.MeshPhysicalMaterial;
  mouth: THREE.MeshStandardMaterial;
  teeth: THREE.MeshStandardMaterial;
  claw: THREE.MeshStandardMaterial;
  prosthetic: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  byName(name: string): THREE.Material | undefined;
  uniforms: {
    rimColor: { value: THREE.Color }; rimStrength: { value: number }; scaleBump: { value: number };
    plasmaGlow: { value: number }; pupil: { value: number }; eyeGlow: { value: number }; irisDepth: { value: number };
    sunDir: { value: THREE.Vector3 };
  };
}

/** Scale height (0..1) from bind-pose position, triplanar; cellular "overlapping scales" at ~2.6 cm. */
const SCALE_GLSL = /* glsl */ `
  vec2 berkHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float berkCell(vec2 p) {
    vec2 i = floor(p), f = fract(p); float d = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y)); vec2 o = berkHash2(i + g) * 0.8 + 0.1;
      vec2 r = g + o - f; r.y *= 1.35; d = min(d, dot(r, r));
    }
    return 1.0 - smoothstep(0.0, 0.42, sqrt(d));
  }
  float berkScaleHeight(vec3 p, vec3 n, float freq) {
    vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
    float h = w.x * berkCell(p.yz * freq) + w.y * berkCell(p.zx * freq) + w.z * berkCell(p.xy * freq);
    float h2 = w.x * berkCell(p.yz * freq * 2.3 + 7.0) + w.y * berkCell(p.zx * freq * 2.3 + 7.0) + w.z * berkCell(p.xy * freq * 2.3 + 7.0);
    return h * 0.75 + h2 * 0.25;
  }`;

/**
 * The skin hook's variants, by hook key. addCompileHook's contract: a key fully determines the text its hook
 * injects, so the scale frequency (cells per metre) and the membrane branch are looked up from the key, never
 * passed in. A new frequency needs a new key.
 */
const SKIN_VARIANTS = {
  dragonskin: { freq: 38, membrane: false },
  'dragonskin-membrane': { freq: 52, membrane: true },
} as const;

function skinHook(m: THREE.Material, u: DragonMaterials['uniforms'], key: keyof typeof SKIN_VARIANTS): void {
  const { freq, membrane: isMembrane } = SKIN_VARIANTS[key];
  addCompileHook(m, key, (shader) => {
    shader.uniforms.berkRimColor = u.rimColor;
    shader.uniforms.berkRimStrength = u.rimStrength;
    shader.uniforms.berkScaleBump = u.scaleBump;
    shader.uniforms.berkPlasmaGlow = u.plasmaGlow;
    shader.uniforms.berkSunDirW = u.sunDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _mask;\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBerkMask = _mask; vBerkBindPos = position; vBerkBindNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;\nuniform vec3 berkRimColor;\nuniform float berkRimStrength;\nuniform float berkScaleBump;\nuniform float berkPlasmaGlow;\nuniform vec3 berkSunDirW;\n${SCALE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // _mask: x = baked AO, y = underside, z = dorsal spikes (smoother, glossier plates)
        // Scales shrinking toward pixel size would alias into glitter: fade them to their mean height by the
        // pixel footprint in cells (full detail up close, none by ~0.35 cells per pixel).
        float berkCellsPerPx = max(length(dFdx(vBerkBindPos)), length(dFdy(vBerkBindPos))) * ${freq.toFixed(1)};
        float berkDetail = 1.0 - smoothstep(0.1, 0.35, berkCellsPerPx);
        float berkH = mix(0.3, berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), ${freq.toFixed(1)}), berkDetail) * (1.0 - 0.7 * vBerkMask.z);
        diffuseColor.rgb *= mix(0.86, 1.1, berkH);
        diffuseColor.rgb *= mix(vec3(0.95, 0.96, 1.0), vec3(1.04, 1.0, 1.1), berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), 2.5));   // broad blue-purple variation
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3(0.006, 0.008, 0.014), vBerkMask.y * ${isMembrane ? '0.0' : '0.6'});`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.08, 0.82, berkH) * mix(1.0, 0.85, vBerkMask.z);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhdx = dFdx(berkH), dhdy = dFdy(berkH);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1) * faceDirection;
          vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
          normal = normalize(abs(det) * normal - grad * berkScaleBump);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.25, 0.55, 1.6) * vBerkMask.z * berkPlasmaGlow;')   // dorsal plates glow during plasma charge
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float berkAO = mix(1.0, vBerkMask.x, 0.85);
          reflectedLight.indirectDiffuse *= berkAO;
          reflectedLight.indirectSpecular *= berkAO;
          // the rim reads the geometric normal: on the scale-bumped one every scale edge glints
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(dot(nonPerturbedNormal, V)), 4.0);
          vec3 sunV = normalize((viewMatrix * vec4(berkSunDirW, 0.0)).xyz);
          float facing = saturate(dot(nonPerturbedNormal, sunV) * 0.5 + 0.6);
          // a membrane is a big flat panel: seen edge-on, a full rim would silver the whole wing, not an edge
          reflectedLight.directSpecular += berkRimColor * fres * facing * berkRimStrength * berkAO${isMembrane ? ' * 0.3' : ''};
          ${isMembrane ? 'reflectedLight.indirectDiffuse += vec3(0.05, 0.028, 0.02) * saturate(dot(-normal, sunV));' : ''}
        }`);
  });
}

function eyeHook(m: THREE.Material, u: DragonMaterials['uniforms']): void {
  addCompileHook(m, 'dragoneye', (shader) => {
    shader.uniforms.berkPupil = u.pupil;
    shader.uniforms.berkEyeGlow = u.eyeGlow;
    shader.uniforms.berkIrisDepth = u.irisDepth;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float berkPupil;\nuniform float berkEyeGlow;\nuniform float berkIrisDepth;\nvec3 berkEyeIris; float berkEyeIrisMask;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // parallax: the iris sits behind the cornea, so shift its lookup against the view direction (cotangent frame)
          vec3 eN = normalize(vNormal);
          vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
          vec2 duv1 = dFdx(vUv), duv2 = dFdy(vUv);
          vec3 dp2perp = cross(dp2, eN), dp1perp = cross(eN, dp1);
          vec3 eT = dp2perp * duv1.x + dp1perp * duv2.x;
          vec3 eB = dp2perp * duv1.y + dp1perp * duv2.y;
          float invmax = inversesqrt(max(max(dot(eT, eT), dot(eB, eB)), 1e-12));
          vec3 vTs = normalize(transpose(mat3(eT * invmax, eB * invmax, eN)) * normalize(vViewPosition));
          vec2 uvP = vUv - vTs.xy / max(vTs.z, 0.3) * berkIrisDepth;
          vec2 e = uvP * 2.0 - 1.0;
          // Blender wrote v = -1 on the back hemisphere; the glTF export flips V (v' = 1 - v), so it arrives as 2
          if (vUv.y < -0.01 || vUv.y > 1.01) { diffuseColor.rgb = vec3(0.02); berkEyeIrisMask = 0.0; berkEyeIris = vec3(0.0); }
          else {
            float r = length(e);
            float pw = mix(0.08, 0.5, berkPupil);
            float pupil = 1.0 - smoothstep(0.92, 1.0, length(vec2(e.x / pw, e.y / 0.68)));
            float iris = 1.0 - smoothstep(0.93, 0.99, r);
            vec3 irisCol = mix(vec3(0.46, 0.78, 0.12), vec3(0.93, 0.9, 0.36), 1.0 - smoothstep(0.1, 0.72, r));
            // radial fibres; atan(0, 0) is undefined, and the fibre weight is 0 there anyway
            irisCol *= 0.82 + 0.18 * (r > 0.2 ? sin(atan(e.y, e.x) * 38.0) : 0.0) * smoothstep(0.25, 0.8, r);
            irisCol = mix(irisCol, vec3(0.07, 0.14, 0.04), smoothstep(0.8, 0.97, r));
            berkEyeIris = irisCol;
            berkEyeIrisMask = iris * (1.0 - pupil);
            vec3 col = mix(vec3(0.06, 0.08, 0.05), irisCol, iris);
            diffuseColor.rgb = mix(col, vec3(0.004), pupil);
          }
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += berkEyeIris * berkEyeIrisMask * berkEyeGlow;');
  });
}

/** The nine GLB material names, in the order `mats` below declares them. asset.ts validates the GLB against this. */
export const DRAGON_MATERIAL_NAMES: readonly string[] = [
  'skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal',
];

export function createDragonMaterials(opts: { sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void }): DragonMaterials {
  const uniforms = {
    // scaleBump: bump height in metres. 1.5 mm keeps the ~2.6 cm scales a fine texture; 3 mm read as beads.
    rimColor: { value: new THREE.Color(0.55, 0.68, 0.95) }, rimStrength: { value: 0.35 }, scaleBump: { value: 0.0015 },
    plasmaGlow: { value: 0 }, pupil: { value: 0.15 }, eyeGlow: { value: 0.35 }, irisDepth: { value: 0.08 }, sunDir: { value: opts.sunDir },
  };
  // Half the dielectric reflectance (specularIntensity 0.5 → F0 0.02, F90 0.5): at full F0 the sky reflection alone
  // lifts the lit near-black skin to slate grey (tuned in the viewer under the Neutral curve at exposure 1.8).
  const skin = new THREE.MeshPhysicalMaterial({
    name: 'skin', color: 0x15171d, roughness: 0.62, metalness: 0, specularIntensity: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.5,
    sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x35507a),
  });
  const membrane = new THREE.MeshPhysicalMaterial({
    name: 'membrane', color: 0x1b1e26, roughness: 0.78, metalness: 0, specularIntensity: 0.5,
    sheen: 0.3, sheenColor: new THREE.Color(0x2a3550), side: THREE.DoubleSide,
  });
  const eye = new THREE.MeshPhysicalMaterial({ name: 'eye', color: 0xffffff, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x000000 });
  eye.defines = { ...(eye.defines ?? {}), USE_UV: '' };
  const std = (name: string, color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ name, color, roughness, ...extra });
  const mats = {
    skin, membrane, eye,
    mouth: std('mouth', 0x9c4450, 0.38),
    teeth: std('teeth', 0xf1ede2, 0.3),
    claw: std('claw', 0xd9d0c0, 0.42),
    prosthetic: std('prosthetic', 0x8e1d13, 0.68, { side: THREE.DoubleSide }),
    leather: std('leather', 0x5a3a22, 0.78),
    metal: std('metal', 0x8d9096, 0.35, { metalness: 0.9 }),
  };
  for (const m of Object.values(mats)) opts.prepare(m);    // CSM + fog first (CSM overwrites onBeforeCompile)
  skinHook(skin, uniforms, 'dragonskin');
  skinHook(membrane, uniforms, 'dragonskin-membrane');
  eyeHook(eye, uniforms);
  const byNameMap = new Map<string, THREE.Material>(Object.entries(mats));
  return { ...mats, byName: (n) => byNameMap.get(n), uniforms };
}
