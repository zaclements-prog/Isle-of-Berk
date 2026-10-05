import type * as THREE from 'three';
import type { FaceState } from './face';

/** The part of Plan 2's DragonAsset the expression binder writes (structural, so tests can pass a stub). */
export interface ExpressionTarget {
  setMorph(name: string, weight: number): void;
  /** Plan 2's look pass: blink through the in-between keys (piecewise). Falls back to the blink_L/R morphs. */
  setBlink?(side: 'L' | 'R', weight: number): void;
  readonly materials: {
    readonly uniforms: {
      pupil: { value: number };
      eyeGlow: { value: number };
      plasmaGlow: { value: number };
      gaze: { value: THREE.Vector2 };
    };
  };
}

/**
 * Copy a FaceState onto the asset once per rendered frame: morph weights, blinks, the membrane pleat correctives, and
 * the eye/skin uniforms. Gaze: the eye shader draws the iris from planar UVs (u toward the dragon's left on both eyes,
 * v downward after the glTF flip), so an eye rotated by yaw/pitch moves the iris centre to (sin yaw, −sin pitch).
 */
export function applyExpression(a: ExpressionTarget, st: FaceState): void {
  if (a.setBlink) {
    a.setBlink('L', st.blinkL);
    a.setBlink('R', st.blinkR);
  } else {
    a.setMorph('blink_L', st.blinkL);
    a.setMorph('blink_R', st.blinkR);
  }
  a.setMorph('squint', st.squint);
  a.setMorph('smile', st.smile);
  a.setMorph('snarl', st.snarl);
  a.setMorph('teeth_out', st.teethOut);
  a.setMorph('nostril_flare', st.nostrilFlare);
  a.setMorph('membrane_pleat_L', st.pleat);
  a.setMorph('membrane_pleat_R', st.pleat);
  const u = a.materials.uniforms;
  u.pupil.value = st.pupil;
  u.eyeGlow.value = st.eyeGlow;
  u.plasmaGlow.value = st.plasmaGlow;
  u.gaze.value.set(Math.sin(st.gazeYaw), -Math.sin(st.gazePitch));
}
