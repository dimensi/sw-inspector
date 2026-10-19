import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const pack = resolve(source, '..');
const root = resolve(pack, '../..');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function inspectPng(data) {
  if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG');
  const chunks = [];
  let offset = 8;
  let end = false;
  const compressed = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const payload = data.subarray(offset + 8, offset + 8 + length);
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) throw new Error(`Bad ${type} checksum`);
    chunks.push(type);
    if (type === 'IDAT') compressed.push(payload);
    if (type === 'IEND') end = true;
    offset += length + 12;
  }
  if (!end || offset !== data.length) throw new Error('Incomplete PNG');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  const bitDepth = data[24], colorType = data[25];
  if (bitDepth !== 8 || data[28] !== 0) throw new Error('Unexpected bit depth or interlacing');
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels || inflateSync(Buffer.concat(compressed)).length !== height * (1 + width * channels)) throw new Error('Invalid pixel data');
  return { width, height, bitDepth, colorType, hasAlpha: colorType === 6 || chunks.includes('tRNS') };
}
const files = [];
for (const group of ['screenshots', 'mockups', 'raw']) {
  const images = (await readdir(resolve(pack, group))).filter(file => file.endsWith('.png')).sort();
  if (images.length !== (group === 'screenshots' ? 5 : group === 'mockups' ? 2 : 7)) throw new Error(`Unexpected ${group} count`);
  for (const name of images) {
    const path = resolve(pack, group, name);
    const data = await readFile(path);
    const info = inspectPng(data);
    if (group !== 'raw') {
      const [width, height] = group === 'screenshots' ? [2880, 1800] : [3200, 2000];
      if (info.width !== width || info.height !== height || info.colorType !== 2 || info.hasAlpha) throw new Error(`Wrong upload format: ${path}`);
    }
    files.push({ file: relative(pack, path), ...info, bytes: data.length, sha256: sha256(data) });
  }
}
const buildFiles = [];
for (const dir of ['', 'assets', 'chunks']) {
  for (const file of (await readdir(resolve(root, '.output/safari-mv3', dir))).sort()) {
    if (!/\.(html|js|css|json)$/.test(file)) continue;
    const path = resolve(root, '.output/safari-mv3', dir, file);
    buildFiles.push({ file: relative(root, path), sha256: sha256(await readFile(path)) });
  }
}
await writeFile(resolve(pack, 'manifest.json'), JSON.stringify({
  generatedOn: '2026-10-19',
  language: 'en',
  capture: 'Actual compiled Safari-MV3 panel rendered in Playwright WebKit at 2x with local synthetic browser APIs. Display time fixed at 10:09:41.',
  composition: 'HTML/CSS in Chromium at 2x; opaque RGB PNG export. Generic window frames on promotional mockups only.',
  dataOrigin: 'https://demo.example.test',
  nativeSafariAcceptance: false,
  iconProvenance: '../../.impeccable/assets/logo.json',
  sources: ['source/demo-fixture.js', 'source/capture.js', 'source/compose.js', 'source/composition.html', 'source/cli.config.json'],
  files, buildFiles,
}, null, 2) + '\n');
console.log(`Validated ${files.length} PNGs: 5 App Store screenshots, 2 mockups, 7 raw inputs. RGB/no-alpha and exact dimensions confirmed for all 7 finished assets.`);
