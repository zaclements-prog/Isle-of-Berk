// Downloads every asset in wanted.json into pipeline/cc0/cache/<id>/ (md5-verified, skips cached files),
// then writes pipeline/cc0/manifest.json and CREDITS.md.  Usage: npm run cc0:fetch
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, USER_AGENT, selectFiles, manifestEntry, creditsMarkdown } from './polyhaven.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CACHE = join(HERE, 'cache');

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function download(file, dest) {
  if (existsSync(dest) && md5(await readFile(dest)) === file.md5) return 'cached';
  const res = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${file.url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (md5(buf) !== file.md5) throw new Error(`md5 mismatch for ${file.url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return 'downloaded';
}

const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = [];
for (const want of wanted) {
  const files = selectFiles(await getJson(`${API}/files/${want.id}`), want);
  for (const f of files) {
    const status = await download(f, join(CACHE, want.id, f.path));
    console.log(`${want.id}/${f.path}: ${status}`);
  }
  manifest.push(manifestEntry(want, files));
}
await writeFile(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(ROOT, 'CREDITS.md'), creditsMarkdown(manifest));
console.log(`manifest: ${manifest.length} assets`);
