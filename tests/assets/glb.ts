import { readFileSync } from 'node:fs';

/** Parse the JSON chunk of a .glb file (no binary buffers needed for structure checks). */
export function readGlbJson(path: string): any {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}
