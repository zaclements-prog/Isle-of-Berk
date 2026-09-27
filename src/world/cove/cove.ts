import * as THREE from 'three';
import type { App } from '../../app/createApp';
import type { InterestPoint, Region, RegionUpdateContext, SpawnPoint, TreeCapsule } from '../region';
import { Heightfield, type TerrainHeader } from '../terrain/heightfield';
import { Terrain } from '../terrain/terrain';
import { COVE_LAYERS, loadLayerArrays, loadSplatTexture, type LayerArrays } from '../terrain/layers';
import { createSplatMaterial, createSplatUniforms, type SplatUniforms } from '../terrain/splatShader';
import { createHeightTexture, terrainUvTransform } from '../terrain/heightTexture';

export interface CoveOptions {
  /** Where `world/cove/` and `textures/terrain/` live (relative URLs resolve from every page). */
  baseUrl?: string;
}

type Updater = (dt: number, ctx: RegionUpdateContext) => void;

/**
 * The Cove region (spec §7). Built by `createCove`; its parts (rocks, pond, backdrop, M7b vegetation and life)
 * attach through `add`, `addCollision`, `onUpdate` and `onDispose`, so the region stays the single owner of
 * everything it puts in the scene.
 */
export class CoveRegion implements Region {
  readonly id = 'cove';
  readonly bounds: THREE.Box3;
  readonly transform = new THREE.Matrix4();
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[] = [];
  readonly root = new THREE.Group();
  readonly heightTexture: THREE.DataTexture;
  readonly capsules: TreeCapsule[] = [];
  /** Low preset: cheaper shader variants (no triplanar rock, no rock ground blend). */
  readonly low: boolean;
  private readonly collision: THREE.Object3D[] = [];
  private readonly updaters: Updater[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(
    readonly app: App,
    readonly baseUrl: string,
    readonly header: TerrainHeader,
    readonly hf: Heightfield,
    readonly terrain: Terrain,
    readonly splat: SplatUniforms,
    readonly layers: LayerArrays,
  ) {
    this.root.name = 'Cove';
    this.low = app.preset.name === 'low';
    const half = ((hf.size - 1) * hf.spacing) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-half, header.stats.heightMin ?? -8, -half), new THREE.Vector3(half, header.stats.heightMax ?? 72, half));
    this.spawnPoints = header.spawn.map((s) => ({ ...s }));
    this.heightTexture = createHeightTexture(hf);
    this.interestPoints.push({ id: 'pond', kind: 'water', position: new THREE.Vector3(header.pond.cx, header.waterLevel, header.pond.cz), weight: 0.3 });
    this.root.add(terrain.root);
    this.disposers.push(() => {
      terrain.dispose();
      terrain.material.dispose();
      layers.dispose();
      this.heightTexture.dispose();
      splat.tTerrainSplatA.value?.dispose();
      splat.tTerrainSplatB.value?.dispose();
    });
  }

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hf.normalAt(x, z, out);
  }

  collisionRoots(): THREE.Object3D[] {
    return [this.terrain.collisionRoot, ...this.collision];
  }

  treeCapsules(): readonly TreeCapsule[] {
    return this.capsules;
  }

  /** Adds a render subtree: every material goes through the app pipeline (CSM + fog). */
  add(object: THREE.Object3D): void {
    this.app.materials.prepareTree(object);
    this.root.add(object);
  }

  /** Adds an invisible collision subtree (world-space meshes; never rendered). */
  addCollision(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    this.collision.push(root);
  }

  onUpdate(fn: Updater): void {
    this.updaters.push(fn);
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  update(dt: number, ctx: RegionUpdateContext): void {
    this.terrain.update(ctx.camera);
    for (const u of this.updaters) u(dt, ctx);
  }

  dispose(): void {
    for (const d of this.disposers.splice(0).reverse()) d();
    this.app.remove(this.root);
  }
}

/**
 * Loads and assembles the Cove (so far: the terrain), adds it to the app, sets the golden-hour sun and compiles every
 * shader before resolving (so the first frames don't hitch). Tasks 11–13 add the rocks, the pond and the backdrop.
 */
export async function createCove(app: App, opts: CoveOptions = {}): Promise<CoveRegion> {
  const base = opts.baseUrl ?? 'assets/';
  const header = (await (await fetch(`${base}world/cove/terrain.json`)).json()) as TerrainHeader;
  const low = app.preset.name === 'low';
  const [heightBuf, layers, splatA, splatB] = await Promise.all([
    fetch(`${base}world/cove/${header.files.height}`).then((r) => r.arrayBuffer()),
    loadLayerArrays(`${base}textures/terrain/`, COVE_LAYERS, low ? 512 : 1024),
    loadSplatTexture(`${base}world/cove/${header.files.splatA}`),
    loadSplatTexture(`${base}world/cove/${header.files.splatB}`),
  ]);
  const hf = Heightfield.fromUint16LE(header, heightBuf);
  const splat = createSplatUniforms();
  splat.tTerrainAlbedo.value = layers.albedo;
  splat.tTerrainNormal.value = layers.normal;
  splat.tTerrainArmh.value = layers.armh;
  splat.tTerrainSplatA.value = splatA;
  splat.tTerrainSplatB.value = splatB;
  terrainUvTransform(hf, splat.uTerrainExtent.value);
  const terrain = new Terrain(hf, createSplatMaterial(splat, low), app.preset.lodDistanceScale);
  const cove = new CoveRegion(app, base, header, hf, terrain, splat, layers);
  app.materials.prepareTree(cove.root);
  app.scene.add(cove.root);
  app.setSun(header.sun.azimuth, header.sun.elevation);
  await app.renderer.compileAsync(app.scene, app.camera);
  return cove;
}
