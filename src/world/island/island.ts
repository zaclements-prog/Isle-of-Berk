import * as THREE from 'three';
import type { App } from '../../app/createApp';
import type { InterestPoint, Region, RegionUpdateContext, SpawnPoint, TreeCapsule } from '../region';
import { Heightfield, type GridHeader } from '../terrain/heightfield';
import { Terrain } from '../terrain/terrain';
import { COVE_LAYERS, loadLayerArrays, loadSplatTexture, type LayerArrays } from '../terrain/layers';
import { createSplatMaterial, createSplatUniforms, type SplatUniforms } from '../terrain/splatShader';
import { createHeightTexture, terrainUvTransform } from '../terrain/heightTexture';
import { Ocean } from './ocean';
import { buildProps, type Placement, type Props } from './props';

/** `public/assets/world/island/terrain.json` (pipeline/terrain/bakeIsland.mjs). */
export interface IslandHeader extends GridHeader {
  version: 1;
  seaLevel: number;
  seed: number;
  sun: { azimuth: number; elevation: number };
  meadow: { x: number; z: number; rx: number; rz: number; height: number };
  ledges: { x: number; z: number; azimuth: number; steps: number; tread: number; rise: number; halfWidth: number };
  stacks: { x: number; z: number; r: number; h: number }[];
  hill: { x: number; z: number };
  spawn: SpawnPoint[];
  layers: string[];
  files: { height: string; splatA: string; splatB: string };
  trees: Placement[];
  rocks: Placement[];
  stats: Record<string, number>;
}

export interface IslandOptions {
  /** Where `world/island/` and `textures/terrain/` live. */
  baseUrl?: string;
}

/**
 * The Test Isle (docs/superpowers/plans/2026-11-01-test-isle.md): the baked terrain with the Cove's splat material,
 * the open sea, pines and boulders. The single owner of everything it adds to the scene.
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
    readonly splat: SplatUniforms,
    readonly layers: LayerArrays,
    readonly ocean: Ocean,
    readonly props: Props,
  ) {
    this.root.name = 'Island';
    const half = ((hf.size - 1) * hf.spacing) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-half, header.heightMin, -half), new THREE.Vector3(half, header.heightMax, half));
    this.spawnPoints = header.spawn.map((s) => ({ ...s }));
    this.heightTexture = ocean.uniforms.tOceanHeight.value as THREE.DataTexture;
    for (const s of header.stacks) this.interestPoints.push({ id: `stack-${s.x}`, kind: 'view', position: new THREE.Vector3(s.x, s.h, s.z), weight: 0.2 });
    this.root.add(terrain.root, ocean.mesh, props.root);
  }

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hf.normalAt(x, z, out);
  }

  collisionRoots(): THREE.Object3D[] {
    return [this.terrain.collisionRoot, ...this.props.collision];
  }

  treeCapsules(): readonly TreeCapsule[] {
    return [];
  }

  update(dt: number, ctx: RegionUpdateContext): void {
    this.terrain.update(ctx.camera);
    this.ocean.update(dt);
  }

  dispose(): void {
    this.app.remove(this.root);
    this.terrain.dispose();
    this.terrain.material.dispose();
    this.layers.dispose();
    this.ocean.dispose();
    this.props.dispose();
    this.heightTexture.dispose();
    this.splat.tTerrainSplatA.value?.dispose();
    this.splat.tTerrainSplatB.value?.dispose();
  }
}

/** Loads and assembles the Test Isle, adds it to the app, sets its sun and compiles every shader before resolving. */
export async function createIsland(app: App, opts: IslandOptions = {}): Promise<IslandRegion> {
  const base = opts.baseUrl ?? 'assets/';
  const header = (await (await fetch(`${base}world/island/terrain.json`)).json()) as IslandHeader;
  const low = app.preset.name === 'low';
  const [heightBuf, layers, splatA, splatB] = await Promise.all([
    fetch(`${base}world/island/${header.files.height}`).then((r) => r.arrayBuffer()),
    loadLayerArrays(`${base}textures/terrain/`, COVE_LAYERS, low ? 512 : 1024),
    loadSplatTexture(`${base}world/island/${header.files.splatA}`),
    loadSplatTexture(`${base}world/island/${header.files.splatB}`),
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
  const ocean = new Ocean({ seaLevel: header.seaLevel, heightTexture: createHeightTexture(hf), extent: terrainUvTransform(hf) });
  const props = buildProps(header.trees, header.rocks, (x, z) => hf.heightAt(x, z));
  const island = new IslandRegion(app, header, hf, terrain, splat, layers, ocean, props);
  app.materials.prepareTree(island.root);
  app.scene.add(island.root);
  app.setSun(header.sun.azimuth, header.sun.elevation);
  await app.renderer.compileAsync(app.scene, app.camera);
  return island;
}
