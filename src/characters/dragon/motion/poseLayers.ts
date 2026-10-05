import * as THREE from 'three';
import { LEG_KEYS, type LimbKey, type Vec3 } from './rigTypes';
import type { RigSkeleton } from './skeleton';

/** A face channel curve: [time (s), value] keys, linear, constant outside the keys. */
export type FaceCurve = ReadonlyArray<readonly [number, number]>;

export interface PoseClipMeta {
  mask: 'all' | string[];
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
  /** 'exit': any input plays the exit blend at once; 'finish': the clip completes first; 'none': an action. */
  interrupt?: string;
  /** Legs this layer drives instead of the leg IK (M6). */
  ownsLegs?: LimbKey[];
  /** Body placement the body solver blends toward: pelvis-head height above the ground (m) and pitch (rad, + nose up). */
  root?: { height: number; pitch: number };
  /** Head-look gain while this layer is live (0: the pose's head wins — shake, sleep; absent = 1). */
  look?: number;
  /** An airborne pose's body pitch (rad, + nose up): the jump pitches the body to it (the pose has no root). */
  bodyPitch?: number;
  /** Wing state while this layer is active (fold 0 spread … 1 folded, lift rad, flare 0…1). */
  wings?: { fold: number; lift: number; flare: number };
  /** Sole spots of the owned grounded paws, character frame (glTF, +Z forward). */
  soles?: Partial<Record<LimbKey, Vec3>>;
  /** Clip length (s); 0 for a single-frame pose. */
  duration?: number;
  /** A looping clip wraps into [loopStart, duration): an intro before it plays once. */
  loopStart?: number;
  /** 'reverse': the clip plays backwards to its first frame (the pose beneath it) instead of blending out. */
  exit?: string;
  /** Face channel curves over the layer's time (jaw, blink, squint, smile, snarl, teeth_out, nostril_flare, pupil, ears, plasmaGlow). */
  face?: Record<string, FaceCurve>;
}

export interface PosesMeta {
  version?: number;
  /** Degrees a full wing flare swings / lifts the folded humerus (the Blender library's FLARE_DEG / FLARE_LIFT_DEG). */
  wingFlare?: { deg: number; liftDeg: number };
  clips: Record<string, PoseClipMeta>;
}

const INTERRUPTS = ['exit', 'finish', 'none'];

export function parsePosesMeta(raw: unknown): PosesMeta {
  const r = raw as { clips?: unknown } | null;
  if (!r || typeof r !== 'object' || !r.clips || typeof r.clips !== 'object') throw new Error('poses.json: missing "clips"');
  for (const [name, c] of Object.entries(r.clips as Record<string, unknown>)) {
    const m = c as PoseClipMeta | null;
    const mask = m?.mask as unknown;
    if (!(mask === 'all' || (Array.isArray(mask) && mask.every((x) => typeof x === 'string')))) {
      throw new Error(`poses.json: clip '${name}' needs mask "all" or a list of bone-name prefixes`);
    }
    if (m!.ownsLegs !== undefined && !(Array.isArray(m!.ownsLegs) && m!.ownsLegs.every((k) => (LEG_KEYS as readonly string[]).includes(k)))) {
      throw new Error(`poses.json: clip '${name}' ownsLegs must list leg keys (${LEG_KEYS.join(', ')})`);
    }
    if (m!.exit !== undefined && m!.exit !== 'blend' && m!.exit !== 'reverse') {
      throw new Error(`poses.json: clip '${name}' exit must be "blend" or "reverse"`);
    }
    if (m!.interrupt !== undefined && !INTERRUPTS.includes(m!.interrupt)) {
      throw new Error(`poses.json: clip '${name}' interrupt must be one of ${INTERRUPTS.join(', ')}`);
    }
    for (const [channel, curve] of Object.entries(m!.face ?? {})) {
      if (!Array.isArray(curve) || !curve.every((k) => Array.isArray(k) && k.length === 2 && k.every(Number.isFinite))) {
        throw new Error(`poses.json: clip '${name}' face.${channel} must be [[t, value], ...]`);
      }
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

/** A looping clip's time wrapped into [loopStart, duration); other clips' time unchanged. */
export function loopTime(meta: PoseClipMeta, duration: number, t: number): number {
  const a = meta.loopStart ?? 0;
  if (!meta.loop || duration - a <= 0 || t < a) return t;
  const span = duration - a;
  return a + (((t - a) % span) + span) % span;
}

/** Value of a face curve at time t (linear between keys, clamped at the ends). */
export function sampleCurve(curve: FaceCurve, t: number): number {
  if (!curve.length) return 0;
  if (t <= curve[0][0]) return curve[0][1];
  for (let k = 1; k < curve.length; k++) {
    const [t1, v1] = curve[k];
    if (t <= t1) {
      const [t0, v0] = curve[k - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return curve[curve.length - 1][1];
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
  name: string;
  pose: ClipPose;
  meta: PoseClipMeta;
  weight: number;
  time: number;
  additive: boolean;
  order: number;
  seq: number;
}

/** A live layer as behaviours, the wing controller, the body placement and the face read it. */
export interface ActiveLayer {
  readonly name: string;
  readonly weight: number;
  /** Layer time (s); a looping clip's time is wrapped into [0, duration) when set. */
  readonly time: number;
  readonly meta: PoseClipMeta;
}

const _d = new THREE.Quaternion();
const _w = new THREE.Quaternion();

/**
 * Library pose layers (spec §6.10): applied after the body pose and before the procedural finals (look, IK, springs).
 * Layers apply by `order` (posture 0 < gesture 1 < action 2), then in the order they were first set. Override layers
 * slerp masked bones toward the clip; additive layers post-multiply the clip's offset from bind. Looping clips wrap
 * their time. Masks, leg ownership, body placement, wing state and face curves are explicit metadata (spec §5.11).
 */
export class PoseLayerStack {
  private readonly layers = new Map<string, Layer>();
  private sorted: Layer[] = [];
  private seq = 0;
  private readonly tmp: THREE.Quaternion[] = [];

  constructor(
    private readonly skeleton: RigSkeleton,
    private readonly clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly metaAll: PosesMeta,
  ) {}

  has(name: string): boolean {
    return this.clips.has(name) && name in this.metaAll.clips;
  }

  meta(name: string): PoseClipMeta | undefined {
    return this.metaAll.clips[name];
  }

  set(name: string, weight: number, time = 0, additive = false, order = 0): void {
    if (weight <= 0) {
      if (this.layers.delete(name)) this.resort();
      return;
    }
    let layer = this.layers.get(name);
    if (!layer) {
      const clip = this.clips.get(name);
      const m = this.metaAll.clips[name];
      if (!clip || !m) throw new Error(`pose layer '${name}': no clip in the poses GLB or no entry in poses.json`);
      layer = { name, pose: new ClipPose(clip, this.skeleton, m.mask), meta: m, weight, time, additive, order, seq: this.seq++ };
      this.layers.set(name, layer);
      this.resort();
    }
    layer.weight = Math.min(weight, 1);
    layer.time = loopTime(layer.meta, layer.pose.duration, time);
    layer.additive = additive;
    if (layer.order !== order) {
      layer.order = order;
      this.resort();
    }
  }

  weight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  /** Live layers in application order (no allocation: the stack's own records, read-only). */
  active(): ReadonlyArray<ActiveLayer> {
    return this.sorted;
  }

  /** Per leg (LEG_KEYS order): the largest weight of a layer that owns it (0 = the leg IK drives it alone). */
  legOwnership(out: number[]): number[] {
    out.fill(0, 0, LEG_KEYS.length);
    for (const l of this.sorted) {
      for (const key of l.meta.ownsLegs ?? []) {
        const i = LEG_KEYS.indexOf(key);
        out[i] = Math.max(out[i], l.weight);
      }
    }
    return out;
  }

  apply(s: RigSkeleton): void {
    for (const l of this.sorted) {
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

  private resort(): void {
    this.sorted = [...this.layers.values()].sort((a, b) => a.order - b.order || a.seq - b.seq);
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
  // M6: keep every other poses.json field (version, wingFlare)
  const outMeta: PosesMeta = { ...meta, clips: { ...meta.clips, [name]: { mask: meta.clips[foldClips[n - 1]].mask, loop: false } } };
  return { clips: outClips, meta: outMeta };
}
