import * as THREE from 'three';

export interface TestScene {
  root: THREE.Group;
  update(t: number): void;
}

/** M1 look-dev scene: material swatches, distant blocks for fog/cascades, a transparent sprite for AO. */
export function createTestScene(): TestScene {
  const root = new THREE.Group();
  root.name = 'TestScene';

  const tl = new THREE.TextureLoader();
  const tex = (url: string, srgb: boolean) => {
    const t = tl.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(80, 80);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const base = 'assets/textures/terrain/forest_ground_04/';
  const arm = tex(`${base}arm.webp`, false);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: tex(`${base}diff.webp`, true),
      normalMap: tex(`${base}nor.webp`, false),
      aoMap: arm,
      roughnessMap: arm,
      metalnessMap: arm,
      metalness: 1, // the ARM texture's blue channel is metalness (0 for ground)
    }),
  );
  ground.name = 'ground';
  ground.receiveShadow = true;
  root.add(ground);

  const swatches: Array<{ name: string; mat: THREE.Material; geo: THREE.BufferGeometry }> = [
    {
      name: 'dragonSkin',
      mat: new THREE.MeshPhysicalMaterial({
        color: 0x14161c, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4,
        sheen: 0.6, sheenColor: new THREE.Color(0x3a4a66), sheenRoughness: 0.5,
      }),
      geo: new THREE.CapsuleGeometry(0.7, 2.2, 8, 24).rotateZ(Math.PI / 2),
    },
    { name: 'rock', mat: new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9 }), geo: new THREE.IcosahedronGeometry(1.2, 3) },
    { name: 'wood', mat: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }), geo: new THREE.BoxGeometry(1.6, 1.6, 1.6) },
    { name: 'mirror', mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 }), geo: new THREE.SphereGeometry(1, 48, 32) },
    { name: 'emissive', mat: new THREE.MeshStandardMaterial({ color: 0x223311, emissive: 0x9cff44, emissiveIntensity: 4 }), geo: new THREE.SphereGeometry(0.5, 32, 16) },
  ];
  swatches.forEach((s, i) => {
    const m = new THREE.Mesh(s.geo, s.mat);
    m.name = s.name;
    m.position.set((i - 2) * 4, 1.4, 0);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  });

  const blockMat = new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 0.9 });
  for (let i = 0; i < 24; i++) {
    const h = 6 + (i % 5) * 3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), blockMat);
    b.position.set(((i % 6) - 2.5) * 18, h / 2, -30 - Math.floor(i / 6) * 45);
    b.castShadow = b.receiveShadow = true;
    root.add(b);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xb080ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.name = 'glowSprite';
  glow.position.set(0, 3.5, 2);
  glow.scale.setScalar(2.5);
  root.add(glow);

  return {
    root,
    update(t) {
      glow.material.rotation = t * 0.5;
    },
  };
}
