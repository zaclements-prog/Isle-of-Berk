// Packs every wanted.json texture with a `terrainLayer` entry into the runtime's three maps:
// public/assets/<dir>/{albedo,nor,armh}.webp at `size`². Needs `npm run cc0:fetch` first.
// Usage: npm run cc0:terrain
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LAYER_TOKENS, packArmh } from './terrainLayers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(HERE, 'manifest.json'), 'utf8'));

for (const want of wanted.filter((w) => w.type === 'textures' && w.terrainLayer)) {
  const entry = manifest.find((m) => m.id === want.id);
  if (!entry) throw new Error(`${want.id} is not in manifest.json — run npm run cc0:fetch first`);
  const file = (map) => {
    const f = entry.files.find((x) => x.path.toLowerCase().includes(`_${LAYER_TOKENS[map]}_`));
    if (!f) throw new Error(`${want.id}: no cached ${map} map (add it to "maps" in wanted.json)`);
    return join(HERE, 'cache', want.id, f.path);
  };
  const { dir, size } = want.terrainLayer;
  const out = join(ROOT, 'public', 'assets', dir);
  await mkdir(out, { recursive: true });
  const fit = { width: size, height: size, fit: 'fill' };
  await sharp(file('diff')).resize(fit).removeAlpha().webp({ quality: 88 }).toFile(join(out, 'albedo.webp'));
  await sharp(file('nor')).resize(fit).removeAlpha().webp({ quality: 95 }).toFile(join(out, 'nor.webp'));
  const arm = await sharp(file('arm')).resize(fit).removeAlpha().raw({ depth: 'uchar' }).toBuffer();
  const disp = await sharp(file('disp')).resize(fit).toColourspace('b-w').normalise().raw({ depth: 'uchar' }).toBuffer();
  await sharp(packArmh(arm, disp, size * size), { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality: 95 }).toFile(join(out, 'armh.webp'));
  console.log(`${want.id} → ${dir}/{albedo,nor,armh}.webp`);
}
