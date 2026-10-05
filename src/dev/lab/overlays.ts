import * as THREE from 'three';
import type { DragonCharacter } from '../../characters/dragon/motion/dragon';

export type OverlayName = 'targets' | 'planted' | 'arcs' | 'support' | 'com' | 'spine' | 'look' | 'proxies';
export const OVERLAY_NAMES: readonly OverlayName[] = ['targets', 'planted', 'arcs', 'support', 'com', 'spine', 'look', 'proxies'];

const MAX = 512;
const _v = new THREE.Vector3();

class LineSet {
  readonly obj: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX * 6);
  private n = 0;
  constructor(color: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    this.obj.renderOrder = 999;
    this.obj.frustumCulled = false;
  }
  clear(): void {
    this.n = 0;
  }
  seg(a: THREE.Vector3, b: THREE.Vector3): void {
    if (this.n >= MAX) return;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], this.n * 6);
    this.n++;
  }
  flush(): void {
    const attr = this.obj.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.obj.geometry.setDrawRange(0, this.n * 2);
  }
}

/** Motion Lab overlays (spec §3.5), each toggled with berk.toggle(name). */
export class MotionOverlays {
  readonly root = new THREE.Group();
  readonly enabled = new Set<OverlayName>(['planted', 'targets', 'support']);
  private readonly sets: Record<OverlayName, LineSet> = {
    targets: new LineSet(0x33ddff), planted: new LineSet(0x44ff66), arcs: new LineSet(0xffcc33), support: new LineSet(0xffffff),
    com: new LineSet(0xff3366), spine: new LineSet(0xcc66ff), look: new LineSet(0x66ffff), proxies: new LineSet(0xff8844),
  };

  constructor() {
    this.root.name = 'MotionOverlays';
    for (const s of Object.values(this.sets)) this.root.add(s.obj);
  }

  toggle(name: OverlayName, on?: boolean): boolean {
    const v = on ?? !this.enabled.has(name);
    if (v) this.enabled.add(name);
    else this.enabled.delete(name);
    return v;
  }

  update(d: DragonCharacter): void {
    for (const [name, set] of Object.entries(this.sets) as Array<[OverlayName, LineSet]>) {
      set.clear();
      set.obj.visible = this.enabled.has(name);
    }
    const S = this.sets;
    const cross = (set: LineSet, p: THREE.Vector3, r: number) => {
      set.seg(_v.copy(p).setX(p.x - r), p.clone().setX(p.x + r));
      set.seg(_v.copy(p).setZ(p.z - r), p.clone().setZ(p.z + r));
      set.seg(_v.copy(p).setY(p.y - r), p.clone().setY(p.y + r));
    };
    d.planner.paws.forEach((paw, i) => {
      if (paw.planted) {
        cross(S.planted, paw.pos, 0.08);
      } else {
        cross(S.targets, paw.to, 0.1);
        let prev = paw.from.clone();
        const save = paw.s;
        for (let k = 1; k <= 16; k++) {
          paw.s = k / 16;
          const q = d.planner.swingPoint(i, new THREE.Vector3());
          S.arcs.seg(prev, q);
          prev = q;
        }
        paw.s = save;
      }
    });
    // support polygon through planted paws, in LH, LF, RF, RH order
    const order = [0, 1, 3, 2].map((i) => d.planner.paws[i]).filter((p) => p.planted).map((p) => p.pos);
    for (let k = 0; k < order.length; k++) S.support.seg(order[k], order[(k + 1) % order.length]);
    // centre of mass ≈ midpoint of pelvis and chest, dropped to the ground
    const s = d.skeleton;
    const com = s.worldPos[s.id('pelvis')].clone().lerp(d.chestPos(new THREE.Vector3()), 0.5);
    S.com.seg(com, com.clone().setY(d.kin.pos.y));
    cross(S.com, com.clone().setY(d.kin.pos.y), 0.12);
    // spine curve: pelvis → … → head
    const chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest', 'neck_01', 'neck_02', 'neck_03', 'neck_04', 'head'].filter((n) => s.has(n)).map((n) => s.worldPos[s.id(n)]);
    for (let k = 0; k + 1 < chain.length; k++) S.spine.seg(chain[k], chain[k + 1]);
    S.look.seg(chain[chain.length - 1], d.look.target);
    d.proxies.items.forEach((p, k) => {
      const c = d.proxies.centers[k];
      for (let a = 0; a < 24; a++) {
        const t0 = (a / 24) * Math.PI * 2;
        const t1 = ((a + 1) / 24) * Math.PI * 2;
        S.proxies.seg(new THREE.Vector3(c.x + Math.cos(t0) * p.radius, c.y + Math.sin(t0) * p.radius, c.z), new THREE.Vector3(c.x + Math.cos(t1) * p.radius, c.y + Math.sin(t1) * p.radius, c.z));
        S.proxies.seg(new THREE.Vector3(c.x, c.y + Math.cos(t0) * p.radius, c.z + Math.sin(t0) * p.radius), new THREE.Vector3(c.x, c.y + Math.cos(t1) * p.radius, c.z + Math.sin(t1) * p.radius));
      }
    });
    for (const set of Object.values(S)) set.flush();
  }
}
