import * as THREE from 'three';

/**
 * Unit vector from the scene toward the sun.
 * Azimuth: 0 = north (−Z), 90 = east (+X). Elevation: 0 = horizon, 90 = zenith.
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
