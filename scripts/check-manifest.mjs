import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDir = resolve(process.env.SW_INSPECTOR_BUILD_DIR ?? '.output/safari-mv3');
const manifestPath = resolve(outputDir, 'manifest.json');
const panelPath = resolve(outputDir, 'panel.html');

async function assertExists(path, description) {
  try {
    await access(path);
  } catch {
    throw new Error(`${description} is missing: ${path}`);
  }
}

await assertExists(manifestPath, 'Safari manifest');
await assertExists(panelPath, 'SW Inspector panel HTML');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const devtoolsPage = manifest.devtools_page?.replace(/^\//, '');

if (devtoolsPage !== 'devtools.html') {
  throw new Error(`Expected devtools_page to reference devtools.html, received ${String(manifest.devtools_page)}`);
}

if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('devtools')) {
  throw new Error('Safari manifest must include the devtools permission');
}

console.log(`Safari manifest contract passed for ${outputDir}`);
