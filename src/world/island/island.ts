import * as THREE from 'three';
import type { App } from '../../app/createApp';
import type { InterestPoint, Region, RegionUpdateContext, SpawnPoint, TreeCapsule } from '../region';
import { Heightfield, type GridHeader } from '../terrain/heightfield';
import { Terrain } from '../terrain/terrain';
import { ISLAND_COLLISION } from '../terrain/collisionMesh';
import { COVE_LAYERS, loadLayerArrays, loadSplatTexture, type LayerArrays } from '../terrain/layers';
import { createSplatMaterial, createSplatUniforms, type SplatUniforms } from '../terrain/splatShader';
import { createHeightTexture, terrainUvTransform } from '../terrain/heightTexture';
import { Ocean } from './ocean';
import { CollisionWorld, type CollisionSet } from '../collision';
import type { ForceUniforms } from '../forceField';
import { buildProps, type Placement, type Props } from './props';
import { Grass } from './grass';
import { createStylizedTerrainMaterial, createStylizedUniforms } from './stylizedTerrain';
import { buildBerk, type BerkLandmarks, type DockPlacement, type HousePlacement } from './berk';

/** `public/assets/world/island/terrain.json` (pipeline/terrain/bakeIsland.mjs). */
export interface IslandHeader extends GridHeader {
  version: number;
  seaLevel: number;
  seed: number;
  sun: { azimuth: number; elevation: number };
  meadow: { x: number; z: number; rx: number; rz: number; height: number };
  ledges: { x: number; z: number; azimuth: number; steps: number; tread: number; rise: number; halfWidth: number };
  stacks: { x: number; z: number; r: number; h: number }[];
  /** The Berk sites (version 2): the Great Hall, the village terraces, the harbour, the Kill Ring, the Cove. */
  hall: { x: number; z: number; height: number; yaw: number; rx: number; rz: number };
  terraces: { x: number; z: number; height: number; rx: number; rz: number; yaw: number }[];
  harbour: { inner: { x: number; z: number }; shelf: number; mouthAzimuth: number };
  killRing: { x: number; z: number; r: number; depth: number; rim: number };
  cove: { x: number; z: number; r: number; rim: number; pond: { x: number; z: number; r: number; depth: number; level: number } };
  /** The eastern cliff-top plateau (gallops, running takeoffs) and its flattened height. */
  plateau: { x: number; z: number; rx: number; rz: number; height: number };
  houses: HousePlacement[];
  docks: DockPlacement[];
  spawn: SpawnPoint[];
  layers: string[];
  files: { height: string; splatA: string; splatB: string };
  trees: Placement[];
  rocks: Placement[];
  stats: Record<string, number>;
}

export interface IslandCollision {
  world: CollisionWorld;
  trees: CollisionSet;
  structures: CollisionSet;
}

/** See IslandRegion.createCollisionWorld. */
export function islandCollisionWorld(terrainRoot: THREE.Object3D, props: Props, berk: BerkLandmarks, tile = 64): IslandCollision {
  const world = CollisionWorld.fromObjects([terrainRoot, ...props.collision.filter((o) => o.name !== 'trunks_collision')], { tile });
  const trees = world.createSet('trees', tile);
  for (const t of props.trunks) trees.add(t.key, t.positions);
  const structures = world.createSet('structures', tile);
  for (const b of berk.structures) structures.add(b.key, b.positions);
  world.flush();
  return { world, trees, structures };
}

export interface IslandOptions {
  /** Where `world/island/` and `textures/terrain/` live. */
  baseUrl?: string;
  /**
   * 'stylised' (default): the palette terrain, grass and flowers — the game's look. 'photo': the Cove's photo-texture
   * splat, no grass (kept for comparison).
   */
  look?: 'stylised' | 'photo';
  /** The shared force field the grass, trees and water react to (docs/superpowers/plans/2026-11-01-world-interaction.md). */
  force?: ForceUniforms;
}

/**
 * The island, after Berk (docs/superpowers/plans/2026-11-01-test-isle.md): the baked terrain (stylised or photo splat),
 * the open sea, pines and boulders, the village with the Great Hall, the piers, the Kill Ring and the Cove's pond. The
 * single owner of everything it adds to the scene.
 */
export class IslandRegion implements Region {
  readonly id = 'island';
  readonly bounds: THREE.Box3;
  readonly transform = new THREE.Matrix4();
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[] = [];
  readonly root = new THREE.Group();
  readonly heightTexture: THREE.DataTexture;

  constructor(
    readonly app: App,
    readonly header: IslandHeader,
    readonly hf: Heightfield,
    readonly terrain: Terrain,
    readonly splat: SplatUniforms | null,
    readonly layers: LayerArrays | null,
    readonly ocean: Ocean,
    readonly props: Props,
    readonly grass: Grass | null,
    private readonly splatTextures: THREE.Texture[],
    readonly berk: BerkLandmarks,
    readonly pond: Ocean,
  ) {
    this.root.name = 'Island';
    const half = ((hf.size - 1) * hf.spacing) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-half, header.heightMin, -half), new THREE.Vector3(half, header.heightMax, half));
    this.spawnPoints = header.spawn.map((s) => ({ ...s }));
    this.heightTexture = ocean.uniforms.tOceanHeight.value as THREE.DataTexture;
    this.interestPoints.push({ id: 'pond', kind: 'water', position: new THREE.Vector3(header.cove.pond.x, header.cove.pond.level, header.cove.pond.z), weight: 0.3 });
    for (const s of header.stacks) this.interestPoints.push({ id: `stack-${s.x}`, kind: 'view', position: new THREE.Vector3(s.x, s.h, s.z), weight: 0.2 });
    this.root.add(terrain.root, ocean.mesh, props.root, berk.root, pond.mesh);
    if (grass) this.root.add(grass.root);
  }

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hf.normalAt(x, z, out);
  }

  collisionRoots(): THREE.Object3D[] {
    return [this.terrain.collisionRoot, ...this.props.collision, ...this.berk.collision];
  }

  /**
   * The island's collision as a layered world (world-interaction plan §3): the terrain and boulders in 64 m static
   * tiles (a crater rebuilds one), the trees' trunks and the village's houses, hall and pier decks as dynamic sets
   * keyed `tree:<i>`, `house:<i>`, `hall`, `pier:<i>` (felled or broken ones are removed).
   */
  createCollisionWorld(tile = 64): IslandCollision {
    return islandCollisionWorld(this.terrain.collisionRoot, this.props, this.berk, tile);
  }

  treeCapsules(): readonly TreeCapsule[] {
    return [];
  }

  update(dt: number, ctx: RegionUpdateContext): void {
    this.terrain.update(ctx.camera);
    this.ocean.update(dt);
    this.pond.update(dt);
    this.grass?.update(dt, ctx.camera, ctx.interactions);
    this.props.update(dt);
  }

  dispose(): void {
    this.app.remove(this.root);
    this.terrain.dispose();
    this.terrain.material.dispose();
    this.layers?.dispose();
    this.ocean.dispose();
    this.pond.dispose();
    this.berk.dispose();
    this.props.dispose();
    this.grass?.dispose();
    this.heightTexture.dispose();
    for (const t of this.splatTextures) t.dispose();
  }
}

/** Loads and assembles the Test Isle, adds it to the app, sets its sun and compiles every shader before resolving. */
export async function createIsland(app: App, opts: IslandOptions = {}): Promise<IslandRegion> {
  const base = opts.baseUrl ?? 'assets/';
  const look = opts.look ?? 'stylised';
  const header = (await (await fetch(`${base}world/island/terrain.json`)).json()) as IslandHeader;
  const low = app.preset.name === 'low';
  const [heightBuf, splatA, splatB, layers] = await Promise.all([
    fetch(`${base}world/island/${header.files.height}`).then((r) => r.arrayBuffer()),
    loadSplatTexture(`${base}world/island/${header.files.splatA}`),
    loadSplatTexture(`${base}world/island/${header.files.splatB}`),
    look === 'photo' ? loadLayerArrays(`${base}textures/terrain/`, COVE_LAYERS, low ? 512 : 1024) : Promise.resolve(null),
  ]);
  const hf = Heightfield.fromUint16LE(header, heightBuf);
  let splat: SplatUniforms | null = null;
  let material: THREE.Material;
  if (layers) {
    splat = createSplatUniforms();
    splat.tTerrainAlbedo.value = layers.albedo;
    splat.tTerrainNormal.value = layers.normal;
    splat.tTerrainArmh.value = layers.armh;
    splat.tTerrainSplatA.value = splatA;
    splat.tTerrainSplatB.value = splatB;
    terrainUvTransform(hf, splat.uTerrainExtent.value);
    material = createSplatMaterial(splat, low);
  } else {
    const u = createStylizedUniforms();
    u.tTerrainSplatA.value = splatA;
    u.tTerrainSplatB.value = splatB;
    terrainUvTransform(hf, u.uTerrainExtent.value);
    material = createStylizedTerrainMaterial(u);
  }
  const terrain = new Terrain(hf, material as THREE.MeshStandardMaterial, app.preset.lodDistanceScale, 1.5, ISLAND_COLLISION);
  const force = opts.force;
  const ocean = new Ocean({ seaLevel: header.seaLevel, heightTexture: createHeightTexture(hf), extent: terrainUvTransform(hf), force });
  const props = buildProps(header.trees, header.rocks, (x, z) => hf.heightAt(x, z), force);
  const grassMap = look === 'stylised' ? await loadGrassMap(`${base}world/island/${header.files.splatA}`) : null;
  const grass = look === 'stylised' ? new Grass(islandGrassField(header, hf, grassMap), low ? { radius: 28, cell: 0.6 } : { radius: 46, cell: 0.5 }, force) : null;
  const berk = buildBerk(header);
  const P = header.cove.pond;
  const pond = new Ocean({ seaLevel: P.level, heightTexture: ocean.uniforms.tOceanHeight.value as THREE.Texture, extent: terrainUvTransform(hf), size: P.r * 2 + 16, center: { x: P.x, z: P.z }, force });
  pond.uniforms.uShallow.value.set(0.16, 0.36, 0.3);
  pond.uniforms.uDeep.value.set(0.04, 0.12, 0.1);
  const island = new IslandRegion(app, header, hf, terrain, splat, layers, ocean, props, grass, [splatA, splatB], berk, pond);
  app.materials.prepareTree(island.root);
  app.scene.add(island.root);
  app.setSun(header.sun.azimuth, header.sun.elevation);
  await app.renderer.compileAsync(app.scene, app.camera);
  return island;
}

/**
 * Where the island's grass grows: above the shingle, on ground gentle enough, in drifting patches (denser on the
 * meadow); flowers on the meadow and thinly elsewhere.
 */
/**
 * The baked grass weight (splatA's red channel) as a CPU map, for the grass to grow where the terrain is grass (not on
 * the village's earth and stone, the beaches or rock). Null where the page can't decode it (then height and slope rule).
 */
export async function loadGrassMap(url: string): Promise<{ size: number; data: Uint8ClampedArray } | null> {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    return { size: bmp.width, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
  } catch {
    return null;
  }
}

export function islandGrassField(header: IslandHeader, hf: Heightfield, grassMap: { size: number; data: Uint8ClampedArray } | null = null): import('./grass').GrassField {
  const n = new THREE.Vector3();
  const m = header.meadow;
  const meadow = (x: number, z: number) => {
    const q = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
    return 1 - Math.min(1, Math.max(0, (q - 0.8) / 0.4));
  };
  const patch = (x: number, z: number) => 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.sin(z * 0.09 + Math.sin(x * 0.05) * 2);
  return {
    height: (x, z) => hf.heightAt(x, z),
    upness: (x, z) => hf.normalAt(x, z, n).y,
    density: (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < header.seaLevel + 2.4) return 0;
      const shore = Math.min(1, (h - header.seaLevel - 2.4) / 2.5);
      let grassW = 1;
      if (grassMap) {
        const i = Math.round((x - hf.origin) / hf.spacing);
        const j = Math.round((z - hf.origin) / hf.spacing);
        if (i < 0 || j < 0 || i >= grassMap.size || j >= grassMap.size) return 0;
        grassW = Math.min(1, (grassMap.data[(j * grassMap.size + i) * 4] / 255) * 1.6);
      }
      return shore * grassW * Math.min(1, 0.35 + 0.65 * patch(x, z) + 0.4 * meadow(x, z));
    },
    flowers: (x, z) => 0.15 + 0.85 * meadow(x, z),
  };
}
