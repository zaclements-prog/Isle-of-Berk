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
