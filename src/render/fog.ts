import * as THREE from 'three';
import { addCompileHook } from './materials';

export interface FogParams {
  /** Haze colour away from the sun (linear). */
  color: THREE.Color;
  /** In-scattered colour toward the sun (linear). */
  sunColor: THREE.Color;
  /** Extinction per metre at baseHeight. */
  density: number;
  /** Per metre; larger = fog hugs the ground. */
  heightFalloff: number;
  baseHeight: number;
  inscatterExponent: number;
  /** 0..1 cap so distant geometry never fully vanishes. */
  maxOpacity: number;
}

export const GOLDEN_FOG: FogParams = {
  color: new THREE.Color(0.62, 0.7, 0.8),
  sunColor: new THREE.Color(1.0, 0.78, 0.52),
  density: 0.0035,
  heightFalloff: 0.035,
  baseHeight: 0,
  inscatterExponent: 6,
  maxOpacity: 0.92,
};

/** Shared uniforms — every fogged material references these same objects. */
export const fogUniforms = {
  berkFogColor: { value: new THREE.Color() },
  berkFogSunColor: { value: new THREE.Color() },
  berkFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  berkFogDensity: { value: 0 },
  berkFogHeightFalloff: { value: 0 },
  berkFogBaseHeight: { value: 0 },
  berkFogInscatterExp: { value: 1 },
  berkFogMaxOpacity: { value: 1 },
};

export function setFogParams(p: FogParams, sunDir: THREE.Vector3): void {
  fogUniforms.berkFogColor.value.copy(p.color);
  fogUniforms.berkFogSunColor.value.copy(p.sunColor);
  fogUniforms.berkFogSunDir.value.copy(sunDir).normalize();
  fogUniforms.berkFogDensity.value = p.density;
  fogUniforms.berkFogHeightFalloff.value = p.heightFalloff;
  fogUniforms.berkFogBaseHeight.value = p.baseHeight;
  fogUniforms.berkFogInscatterExp.value = p.inscatterExponent;
  fogUniforms.berkFogMaxOpacity.value = p.maxOpacity;
}

/** CPU reference of the shader maths (tests + tools): exponential height fog integrated along the view ray. */
export function berkFogFactor(p: FogParams, cam: THREE.Vector3, point: THREE.Vector3): number {
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const dist = Math.hypot(dx, dy, dz);
  const k = Math.max(-20, Math.min(20, p.heightFalloff * dy));
  const line = Math.abs(k) > 1e-4 ? (1 - Math.exp(-k)) / k : 1;
  const optical = p.density * Math.exp(-p.heightFalloff * (cam.y - p.baseHeight)) * dist * line;
  return Math.min(1 - Math.exp(-optical), p.maxOpacity);
}

let installed = false;

/** Adds a BERK_FOG branch to three's fog chunks. Materials without the define are untouched. */
export function installFogChunks(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex += `
#ifdef BERK_FOG
  varying vec3 vBerkWorldPos;
#endif
`;
  C.fog_vertex += `
#ifdef BERK_FOG
  {
    vec4 berkWP = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      berkWP = batchingMatrix * berkWP;
    #endif
    #ifdef USE_INSTANCING
      berkWP = instanceMatrix * berkWP;
    #endif
    vBerkWorldPos = (modelMatrix * berkWP).xyz;
  }
#endif
`;
  C.fog_pars_fragment += `
#ifdef BERK_FOG
  varying vec3 vBerkWorldPos;
  uniform vec3 berkFogColor;
  uniform vec3 berkFogSunColor;
  uniform vec3 berkFogSunDir;
  uniform float berkFogDensity;
  uniform float berkFogHeightFalloff;
  uniform float berkFogBaseHeight;
  uniform float berkFogInscatterExp;
  uniform float berkFogMaxOpacity;
#endif
`;
  C.fog_fragment = `
#ifdef BERK_FOG
  {
    vec3 berkRay = vBerkWorldPos - cameraPosition;
    float berkDist = length(berkRay);
    float berkK = clamp(berkFogHeightFalloff * berkRay.y, -20.0, 20.0);
    float berkLine = abs(berkK) > 1e-4 ? (1.0 - exp(-berkK)) / berkK : 1.0;
    float berkOptical = berkFogDensity * exp(-berkFogHeightFalloff * (cameraPosition.y - berkFogBaseHeight)) * berkDist * berkLine;
    float berkF = min(1.0 - exp(-berkOptical), berkFogMaxOpacity);
    float berkSun = pow(max(dot(berkRay / max(berkDist, 1e-4), berkFogSunDir), 0.0), berkFogInscatterExp);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(berkFogColor, berkFogSunColor, berkSun), berkF);
  }
#else
${C.fog_fragment}
#endif
`;
}

/** Opt a material into Berk fog (define + shared uniforms). Respects material.fog === false. */
export function applyBerkFog(material: THREE.Material): void {
  const m = material as THREE.Material & { fog?: boolean; defines?: Record<string, unknown> };
  if (m.fog === false) return;
  m.defines = { ...(m.defines ?? {}), BERK_FOG: '' };
  addCompileHook(material, 'berkfog', (shader) => {
    Object.assign(shader.uniforms, fogUniforms);
  });
}
