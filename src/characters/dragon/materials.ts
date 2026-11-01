import * as THREE from 'three';
import { addCompileHook } from '../../render/materials';
import type { DragonLook } from './facet';

/**
 * The engine's own materials for the dragon GLB (whose materials are placeholders), one per GLB material name.
 * Film look (spec §4.5, §5.7, §5.8): near-black skin with procedural scales, vertex AO from `_mask`, a cool rim and
 * sheen; procedural eyes; a plasma-glow hook on the dorsal plates. Faceted look (the default, see facet.ts): flat
 * shaded slate planes, two-tone counter-shading from the baked underside mask, darker dorsal plates and a sky rim on
 * the silhouette, with the same procedural eyes (brighter) and plasma glow. Tunables are shared uniforms (`uniforms`).
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
    plasmaGlow: { value: number };
    /**
     * The plates' glow along the spine: x = the lit front's position from the tail tip (0) to the head (1; ≥ 1.1 all
     * lit), y = the share of plasmaGlow the plates behind it (toward the head) still get. (1.2, 1): all of them alike.
     * The plasma's long charge runs the front up the spine (PlasmaAction.sweep).
     */
    plasmaSweep: { value: THREE.Vector2 };
    pupil: { value: number }; eyeGlow: { value: number }; irisDepth: { value: number };
    sunDir: { value: THREE.Vector3 };
    /** Multiplies eyeGlow (the face drives eyeGlow; the look sets how far it carries). */
    eyeGlowGain: { value: number };
    /** Faceted look: the underside colour, how far the underside mask blends to it, and the dorsal plates' colour. */
    bellyColor: { value: THREE.Color }; bellyMix: { value: number }; plateColor: { value: THREE.Color };
    /** Iris offset in eye-UV units (x toward the dragon's left, y down): the eyes' gaze (M6). */
    gaze: { value: THREE.Vector2 };
  };
}

/**
 * The plates' share of the plasma glow at bind-pose z (the spine runs from the tail tip at z ≈ −4.9 to the head at
 * z ≈ 1.9, +Z forward): full behind the sweep's front (berkPlasmaSweep.x, 0 = tail tip … 1 = head) with a soft edge
 * and a hot band just at it, berkPlasmaSweep.y ahead of it.
 */
const PLATE_GLSL = /* glsl */ `
  float berkPlateLit(float z) {
    float u = (z + 4.9) / 6.8;
    float f = berkPlasmaSweep.x;
    float lit = 1.0 - smoothstep(f - 0.05, f + 0.05, u);
    float band = f < 1.05 ? 0.6 * exp(-pow((u - f + 0.03) / 0.05, 2.0)) : 0.0;
    return mix(berkPlasmaSweep.y, 1.0, lit) + band;
  }`;

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
    shader.uniforms.berkPlasmaSweep = u.plasmaSweep;
    shader.uniforms.berkSunDirW = u.sunDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _mask;\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBerkMask = _mask; vBerkBindPos = position; vBerkBindNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;\nuniform vec3 berkRimColor;\nuniform float berkRimStrength;\nuniform float berkScaleBump;\nuniform float berkPlasmaGlow;\nuniform vec2 berkPlasmaSweep;\n${PLATE_GLSL}\nuniform vec3 berkSunDirW;\n${SCALE_GLSL}`)
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.25, 0.55, 1.6) * vBerkMask.z * berkPlasmaGlow * berkPlateLit(vBerkBindPos.z);')   // dorsal plates glow during plasma charge
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

/**
 * The faceted look's skin and membrane hook (keys 'dragonfacet' / 'dragonfacet-membrane'): no scales. Flat shading
 * makes `normal` the face normal, so lighting, rim and AO all step per plane.
 */
function facetHook(m: THREE.Material, u: DragonMaterials['uniforms'], key: 'dragonfacet' | 'dragonfacet-membrane'): void {
  const isMembrane = key === 'dragonfacet-membrane';
  addCompileHook(m, key, (shader) => {
    shader.uniforms.berkRimColor = u.rimColor;
    shader.uniforms.berkRimStrength = u.rimStrength;
    shader.uniforms.berkPlasmaGlow = u.plasmaGlow;
    shader.uniforms.berkPlasmaSweep = u.plasmaSweep;
    shader.uniforms.berkSunDirW = u.sunDir;
    shader.uniforms.berkBelly = u.bellyColor;
    shader.uniforms.berkBellyMix = u.bellyMix;
    shader.uniforms.berkPlates = u.plateColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _mask;\nvarying vec3 vBerkMask;\nvarying float vBerkBindZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBerkMask = _mask; vBerkBindZ = position.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBerkMask;\nvarying float vBerkBindZ;\nuniform vec3 berkRimColor;\nuniform float berkRimStrength;\nuniform float berkPlasmaGlow;\nuniform vec2 berkPlasmaSweep;\n${PLATE_GLSL}\nuniform vec3 berkSunDirW;\nuniform vec3 berkBelly;\nuniform float berkBellyMix;\nuniform vec3 berkPlates;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // _mask: x = baked AO, y = underside, z = dorsal plates. Two-tone: a lighter underside (counter-shading, so he
        // separates from dark forest from below) and darker plates along the spine
        diffuseColor.rgb = mix(diffuseColor.rgb, berkBelly, smoothstep(0.2, 0.8, vBerkMask.y) * berkBellyMix${isMembrane ? ' * 0.5' : ''});
        diffuseColor.rgb = mix(diffuseColor.rgb, berkPlates, smoothstep(0.3, 0.7, vBerkMask.z));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.25, 0.55, 1.6) * vBerkMask.z * berkPlasmaGlow * berkPlateLit(vBerkBindZ);')   // dorsal plates glow during plasma charge
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float berkAO = mix(1.0, vBerkMask.x, 0.7);
          reflectedLight.indirectDiffuse *= berkAO;
          reflectedLight.indirectSpecular *= berkAO;
          // sky rim on the silhouette's planes: the brightest on the side away from the sun, like a back-lit edge
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(abs(dot(normal, V))), 3.0);
          vec3 sunV = normalize((viewMatrix * vec4(berkSunDirW, 0.0)).xyz);
          float facing = saturate(dot(normal, sunV) * 0.4 + 0.7);
          reflectedLight.directSpecular += berkRimColor * fres * facing * berkRimStrength * berkAO${isMembrane ? ' * 0.4' : ''};
          ${isMembrane ? 'reflectedLight.indirectDiffuse += vec3(0.05, 0.028, 0.02) * saturate(dot(-normal, sunV));' : ''}
        }`);
  });
}

function eyeHook(m: THREE.Material, u: DragonMaterials['uniforms']): void {
  addCompileHook(m, 'dragoneye', (shader) => {
    shader.uniforms.berkPupil = u.pupil;
    shader.uniforms.berkEyeGlow = u.eyeGlow;
    shader.uniforms.berkEyeGlowGain = u.eyeGlowGain;
    shader.uniforms.berkIrisDepth = u.irisDepth;
    shader.uniforms.berkEyeGaze = u.gaze;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float berkPupil;\nuniform float berkEyeGlow;\nuniform float berkEyeGlowGain;\nuniform float berkIrisDepth;\nuniform vec2 berkEyeGaze;\nvec3 berkEyeIris; float berkEyeIrisMask;')
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
          vec2 e = uvP * 2.0 - 1.0 - berkEyeGaze;
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += berkEyeIris * berkEyeIrisMask * berkEyeGlow * berkEyeGlowGain;');
  });
}

/** The nine GLB material names, in the order `mats` below declares them. asset.ts validates the GLB against this. */
export const DRAGON_MATERIAL_NAMES: readonly string[] = [
  'skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal',
];

/**
 * The faceted look's palette (from the style lab's "Faceted body, bold light" pick): slate body and wings, a
 * blue-grey underside, near-black plates, his red tail fin, and bright gold-green eyes.
 */
export const FACET_PALETTE = {
  body: 0x2a3446, belly: 0x56698a, plates: 0x161b27, membrane: 0x34425c, mouth: 0x8a3a44, bone: 0xe6dccb,
  accent: 0xb02a1a, tack: 0x6b4428, metal: 0x8d9096,
};

export function createDragonMaterials(opts: { sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void; look?: DragonLook }): DragonMaterials {
  const faceted = (opts.look ?? 'film') === 'faceted';
  const P = FACET_PALETTE;
  const uniforms = {
    // scaleBump: bump height in metres. 1.5 mm keeps the ~2.6 cm scales a fine texture; 3 mm read as beads.
    rimColor: { value: faceted ? new THREE.Color(0.62, 0.76, 1.0) : new THREE.Color(0.55, 0.68, 0.95) }, rimStrength: { value: faceted ? 0.5 : 0.35 },
    scaleBump: { value: 0.0015 },
    plasmaGlow: { value: 0 }, plasmaSweep: { value: new THREE.Vector2(1.2, 1) }, pupil: { value: 0.15 }, eyeGlow: { value: 0.35 }, irisDepth: { value: 0.08 }, sunDir: { value: opts.sunDir },
    gaze: { value: new THREE.Vector2() },
    eyeGlowGain: { value: faceted ? 2.4 : 1 },
    bellyColor: { value: new THREE.Color(P.belly) }, bellyMix: { value: 0.8 }, plateColor: { value: new THREE.Color(P.plates) },
  };
  const mats = faceted ? facetedMaterials() : filmMaterials();
  for (const m of Object.values(mats)) opts.prepare(m);    // CSM + fog first (CSM overwrites onBeforeCompile)
  if (faceted) {
    facetHook(mats.skin, uniforms, 'dragonfacet');
    facetHook(mats.membrane, uniforms, 'dragonfacet-membrane');
  } else {
    skinHook(mats.skin, uniforms, 'dragonskin');
    skinHook(mats.membrane, uniforms, 'dragonskin-membrane');
  }
  eyeHook(mats.eye, uniforms);
  const byNameMap = new Map<string, THREE.Material>(Object.entries(mats));
  return { ...mats, byName: (n) => byNameMap.get(n), uniforms };
}

const std = (name: string, color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ name, color, roughness, ...extra });

function proceduralEye(): THREE.MeshPhysicalMaterial {
  const eye = new THREE.MeshPhysicalMaterial({ name: 'eye', color: 0xffffff, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x000000 });
  eye.defines = { ...(eye.defines ?? {}), USE_UV: '' };
  return eye;
}

function filmMaterials() {
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
  return {
    skin, membrane, eye: proceduralEye(),
    mouth: std('mouth', 0x9c4450, 0.38),
    teeth: std('teeth', 0xf1ede2, 0.3),
    claw: std('claw', 0xd9d0c0, 0.42),
    prosthetic: std('prosthetic', 0x8e1d13, 0.68, { side: THREE.DoubleSide }),
    leather: std('leather', 0x5a3a22, 0.78),
    metal: std('metal', 0x8d9096, 0.35, { metalness: 0.9 }),
  };
}

/** Flat-shaded matte planes; the eye stays smooth so the procedural iris reads. */
function facetedMaterials() {
  const P = FACET_PALETTE;
  const flat = { flatShading: true };
  return {
    skin: new THREE.MeshPhysicalMaterial({ name: 'skin', color: P.body, roughness: 0.82, metalness: 0, specularIntensity: 0.5, ...flat }),
    membrane: new THREE.MeshPhysicalMaterial({ name: 'membrane', color: P.membrane, roughness: 0.88, metalness: 0, specularIntensity: 0.4, side: THREE.DoubleSide, ...flat }),
    eye: proceduralEye(),
    mouth: std('mouth', P.mouth, 0.6, flat),
    teeth: std('teeth', P.bone, 0.5, flat),
    claw: std('claw', P.bone, 0.55, flat),
    prosthetic: std('prosthetic', P.accent, 0.75, { side: THREE.DoubleSide, ...flat }),
    leather: std('leather', P.tack, 0.85, flat),
    metal: std('metal', P.metal, 0.4, { metalness: 0.8, ...flat }),
  };
}
