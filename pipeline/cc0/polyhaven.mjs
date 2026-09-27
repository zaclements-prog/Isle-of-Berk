import { isAbsolute, relative, resolve, sep } from 'node:path';

export const API = 'https://api.polyhaven.com';
export const USER_AGENT = 'isle-of-berk-asset-pipeline (personal project)';

/** Our map names → [Poly Haven file key, preferred format]. */
export const TEXTURE_MAPS = {
  diff: ['Diffuse', 'jpg'],
  nor: ['nor_gl', 'png'],
  arm: ['arm', 'jpg'],
  rough: ['Rough', 'jpg'],
  ao: ['AO', 'jpg'],
  disp: ['Displacement', 'png'],
};

/** Our map name → the token Poly Haven puts in file names (`<id>_<token>_<res>.<ext>`). */
export const FILE_TOKEN = { diff: 'diff', nor: 'nor_gl', arm: 'arm', rough: 'rough', ao: 'ao', disp: 'disp' };

/**
 * The cached file holding one map of a manifest entry. Anchored on the `_<token>_<res>.` tail of Poly
 * Haven's `<id>_<token>_<res>.<ext>` names (ids never contain a dot), so an asset id that itself
 * contains a token — `rock_arm_01` holds `_arm_` — can't match another map's file.
 * @param {{ id: string, res: string, files: { path: string }[] }} entry manifest.json entry
 * @param {string} map our map name (a FILE_TOKEN key)
 */
export function findMapFile(entry, map) {
  const token = FILE_TOKEN[map];
  if (!token) throw new Error(`${entry.id}: unknown map '${map}'`);
  const tail = `_${token}_${entry.res}.`.toLowerCase();
  return entry.files.find((f) => f.path.toLowerCase().includes(tail));
}

/**
 * Absolute cache path for one downloaded file, refusing any that resolves outside `cacheDir`: `rel`
 * comes from the Poly Haven API (a glTF's include map), so `../` or an absolute path in it must not
 * write — or read — anywhere else on disk.
 * @param {string} cacheDir the cache root (pipeline/cc0/cache)
 * @param {string} id asset id (its folder under the cache)
 * @param {string} rel file path relative to the asset folder
 */
export function cachePath(cacheDir, id, rel) {
  const root = resolve(cacheDir);
  const full = resolve(root, id, rel);
  const inside = relative(resolve(root, id), full);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || !full.startsWith(root + sep)) {
    throw new Error(`${id}: refusing cache path outside the cache folder: ${rel}`);
  }
  return full;
}

const basename = (u) => u.split('/').pop();

/**
 * @param {Record<string, any>} files JSON from GET /files/{id}
 * @param {{ id: string, type: 'textures'|'models', res: string, maps?: string[] }} want
 * @returns {{ url: string, path: string, size: number, md5: string }[]} paths relative to the asset cache dir
 */
export function selectFiles(files, want) {
  if (want.type === 'models') {
    const g = files?.gltf?.[want.res]?.gltf;
    if (!g) throw new Error(`${want.id}: missing gltf ${want.res}`);
    const out = [{ url: g.url, path: basename(g.url), size: g.size, md5: g.md5 }];
    for (const [rel, f] of Object.entries(g.include ?? {})) out.push({ url: f.url, path: rel, size: f.size, md5: f.md5 });
    return out;
  }
  return (want.maps ?? ['diff', 'nor', 'arm']).map((m) => {
    const spec = TEXTURE_MAPS[m];
    if (!spec) throw new Error(`${want.id}: unknown map '${m}'`);
    const [key, fmt] = spec;
    const f = files?.[key]?.[want.res]?.[fmt];
    if (!f) throw new Error(`${want.id}: missing ${key} ${want.res} ${fmt}`);
    return { url: f.url, path: basename(f.url), size: f.size, md5: f.md5 };
  });
}

export function manifestEntry(want, files) {
  return {
    id: want.id,
    type: want.type,
    res: want.res,
    license: 'CC0',
    source: `https://polyhaven.com/a/${want.id}`,
    files: files.map((f) => ({ path: f.path, md5: f.md5, size: f.size })),
  };
}

export function creditsMarkdown(entries) {
  const lines = [
    '# Credits',
    '',
    'Third-party assets used by Isle of Berk. All are CC0 (public domain); attribution is not required but is recorded here.',
    '',
    '| Asset | Type | Source | Licence |',
    '|---|---|---|---|',
  ];
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| ${e.id} | ${e.type} | ${e.source} | ${e.license} |`);
  }
  return lines.join('\n') + '\n';
}
