import * as THREE from 'three';
import type { RigSkeleton } from './skeleton';

export interface PoseClipMeta {
  mask: 'all' | string[];
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
  interrupt?: string;
}

export interface PosesMeta {
  clips: Record<string, PoseClipMeta>;
}

export function parsePosesMeta(raw: unknown): PosesMeta {
  const r = raw as { clips?: unknown } | null;
  if (!r || typeof r !== 'object' || !r.clips || typeof r.clips !== 'object') throw new Error('poses.json: missing "clips"');
  for (const [name, c] of Object.entries(r.clips as Record<string, unknown>)) {
    const m = (c as { mask?: unknown } | null)?.mask;
    if (!(m === 'all' || (Array.isArray(m) && m.every((x) => typeof x === 'string')))) {
      throw new Error(`poses.json: clip '${name}' needs mask "all" or a list of bone-name prefixes`);
    }
  }
  return r as PosesMeta;
}

export async function loadPosesMeta(url: string): Promise<PosesMeta> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`poses.json: ${url} → HTTP ${res.status}`);
  return parsePosesMeta(await res.json());
}

/** Bone indices selected by a mask: 'all', or every bone whose name starts with one of the prefixes. */
export function maskBones(s: RigSkeleton, mask: 'all' | readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.count; i++) if (mask === 'all' || mask.some((p) => s.names[i].startsWith(p))) out.push(i);
  return out;
}

/** Samples a clip's rotation tracks for the masked bones (local rotations, slerped between keys). */
export class ClipPose {
  readonly bones: number[] = [];
  readonly duration: number;
  private readonly interpolants: THREE.Interpolant[] = [];

  constructor(clip: THREE.AnimationClip, s: RigSkeleton, mask: 'all' | readonly string[]) {
    const allowed = new Set(maskBones(s, mask));
    for (const track of clip.tracks) {
      if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
      const dot = track.name.lastIndexOf('.');
      const bone = track.name.slice(0, dot);
      if (!s.has(bone) || !allowed.has(s.id(bone))) continue;
      this.bones.push(s.id(bone));
      this.interpolants.push(track.InterpolantFactoryMethodLinear(new Float32Array(4)));
    }
    this.duration = clip.duration;
  }

  sample(t: number, out: THREE.Quaternion[]): void {
    for (let k = 0; k < this.bones.length; k++) {
      const v = this.interpolants[k].evaluate(t);
      out[k].set(v[0], v[1], v[2], v[3]).normalize();
    }
  }
}

interface Layer {
  pose: ClipPose;
  weight: number;
  time: number;
  additive: boolean;
}

const _d = new THREE.Quaternion();
const _w = new THREE.Quaternion();

/**
 * Library pose layers (spec §6.10): applied after the body pose and before the procedural finals (look, IK, springs),
 * in the order they were first set. Override layers slerp masked bones toward the clip; additive layers post-multiply
 * the clip's offset from bind.
 */
export class PoseLayerStack {
  private readonly layers = new Map<string, Layer>();
  private readonly tmp: THREE.Quaternion[] = [];

  constructor(
    private readonly skeleton: RigSkeleton,
    private readonly clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly meta: PosesMeta,
  ) {}

  has(name: string): boolean {
    return this.clips.has(name) && name in this.meta.clips;
  }

  set(name: string, weight: number, time = 0, additive = false): void {
    if (weight <= 0) {
      this.layers.delete(name);
      return;
    }
    let layer = this.layers.get(name);
    if (!layer) {
      const clip = this.clips.get(name);
      const m = this.meta.clips[name];
      if (!clip || !m) throw new Error(`pose layer '${name}': no clip in the poses GLB or no entry in poses.json`);
      layer = { pose: new ClipPose(clip, this.skeleton, m.mask), weight, time, additive };
      this.layers.set(name, layer);
    }
    layer.weight = Math.min(weight, 1);
    layer.time = time;
    layer.additive = additive;
  }

  weight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  apply(s: RigSkeleton): void {
    for (const l of this.layers.values()) {
      while (this.tmp.length < l.pose.bones.length) this.tmp.push(new THREE.Quaternion());
      l.pose.sample(l.time, this.tmp);
      for (let k = 0; k < l.pose.bones.length; k++) {
        const b = l.pose.bones[k];
        if (l.additive) {
          _d.copy(s.bindLocalQuat[b]).invert().multiply(this.tmp[k]);
          s.localQuat[b].multiply(_w.identity().slerp(_d, l.weight));
        } else {
          s.localQuat[b].slerp(this.tmp[k], l.weight);
        }
      }
    }
  }
}

/**
 * Merge ordered single-frame fold samples (rig.json wings.<side>.foldClips) into ONE multi-key clip, keyed at
 * t = i/(n−1), so sampling it at fold amount f ∈ [0,1] slerps only between neighbouring samples (each step < 120°).
 * Registers meta[name] with the mask of the last sample (the fully folded pose). Returns new maps; inputs untouched.
 */
export function withFoldClip(
  clips: ReadonlyMap<string, THREE.AnimationClip>,
  meta: PosesMeta,
  foldClips: readonly string[],
  name = 'wingFold',
): { clips: Map<string, THREE.AnimationClip>; meta: PosesMeta } {
  if (foldClips.length < 2) throw new Error(`withFoldClip: '${name}' needs at least 2 foldClips, got ${foldClips.length}`);
  const samples = foldClips.map((clipName) => {
    const c = clips.get(clipName);
    if (!c || !meta.clips[clipName]) {
      throw new Error(`withFoldClip: '${name}' references fold clip '${clipName}', missing from the poses GLB or poses.json`);
    }
    return c;
  });
  const n = samples.length;

  // Every bone with a QuaternionKeyframeTrack in any sample.
  const boneNames = new Set<string>();
  for (const c of samples) {
    for (const track of c.tracks) {
      if (track instanceof THREE.QuaternionKeyframeTrack) boneNames.add(track.name.slice(0, track.name.lastIndexOf('.')));
    }
  }

  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  for (const bone of boneNames) {
    const trackName = `${bone}.quaternion`;
    const perSample = samples.map((c) => {
      const track = c.tracks.find(
        (t): t is THREE.QuaternionKeyframeTrack => t instanceof THREE.QuaternionKeyframeTrack && t.name === trackName,
      );
      return track ? new THREE.Quaternion(track.values[0], track.values[1], track.values[2], track.values[3]) : null;
    });
    // Fill missing samples from the previous one; the first sample missing a track borrows the first that has one.
    let prev = perSample.find((v): v is THREE.Quaternion => v !== null)!;
    const resolved = perSample.map((v) => {
      prev = v ?? prev;
      return prev.clone();
    });
    // Keep neighbouring keys in one hemisphere so the interpolant never takes the long way around.
    for (let i = 1; i < resolved.length; i++) {
      if (resolved[i].dot(resolved[i - 1]) < 0) resolved[i].set(-resolved[i].x, -resolved[i].y, -resolved[i].z, -resolved[i].w);
    }
    const times = resolved.map((_, i) => i / (n - 1));
    const values = resolved.flatMap((qv) => qv.toArray());
    tracks.push(new THREE.QuaternionKeyframeTrack(trackName, times, values));
  }

  const outClips = new Map(clips);
  outClips.set(name, new THREE.AnimationClip(name, 1, tracks));
  const outMeta: PosesMeta = { clips: { ...meta.clips, [name]: { mask: meta.clips[foldClips[n - 1]].mask, loop: false } } };
  return { clips: outClips, meta: outMeta };
}
