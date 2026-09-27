// Converts cached textures that have an `install` entry in wanted.json into WebP under public/assets.
// diff/arm → quality 88/90; nor → quality 95 (normals are sensitive). Usage: npm run cc0:textures
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findMapFile, cachePath } from './polyhaven.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const QUALITY = { diff: 88, arm: 90, rough: 90, ao: 90, nor: 95, disp: 95 };

const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(HERE, 'manifest.json'), 'utf8'));

for (const want of wanted.filter((w) => w.type === 'textures' && w.install)) {
  const entry = manifest.find((m) => m.id === want.id);
  if (!entry) throw new Error(`${want.id} is not in manifest.json — run npm run cc0:fetch first`);
  const outDir = join(ROOT, 'public', 'assets', want.install.dir);
  await mkdir(outDir, { recursive: true });
  for (const map of want.maps ?? ['diff', 'nor', 'arm']) {
    const file = findMapFile(entry, map);
    if (!file) throw new Error(`${want.id}: no cached file for map ${map}`);
    const out = join(outDir, `${map}.webp`);
    await sharp(cachePath(join(HERE, 'cache'), want.id, file.path))
      .resize(want.install.size, want.install.size)
      .webp({ quality: QUALITY[map] })
      .toFile(out);
    console.log(`${want.id} ${map} → ${out}`);
  }
}
