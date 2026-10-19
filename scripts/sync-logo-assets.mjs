import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const webIconSizes = [16, 32, 48, 128];
const appIconSizes = [16, 32, 64, 128, 256, 512, 1024];
const toolbarIconSizes = [16, 19, 32, 38];

function sourcePath(root, source) {
  return isAbsolute(source) ? source : resolve(root, source);
}

async function resize(source, size, output) {
  await mkdir(dirname(output), { recursive: true });
  await run('sips', ['-z', String(size), String(size), source, '--out', output]);
}

async function renderToolbar(source, size, output) {
  await mkdir(dirname(output), { recursive: true });
  await run('magick', [
    '-background', 'none', '-density', '768', `msvg:${source}`,
    '-resize', `${size}x${size}`, '-strip', `PNG32:${output}`,
  ]);
}

export async function syncLogoAssets({ root = projectRoot, source = 'logo.png' } = {}) {
  const logo = sourcePath(root, source);
  const toolbarSource = join(root, 'public', 'icons', 'toolbar.svg');
  await Promise.all([stat(logo), stat(toolbarSource)]);

  const webIcons = webIconSizes.map((size) => join(root, 'public', 'icons', `${size}.png`));
  const toolbarIcons = toolbarIconSizes.map((size) => join(root, 'public', 'icons', `toolbar-${size}.png`));
  const appIcons = appIconSizes.map((size) => join(
    root,
    'apple',
    'SW Inspector',
    'SW Inspector',
    'Assets.xcassets',
    'AppIcon.appiconset',
    `app-icon-${size}.png`,
  ));
  const wrapperIcon = join(root, 'apple', 'SW Inspector', 'SW Inspector', 'Resources', 'Icon.png');

  await Promise.all([
    ...webIconSizes.map((size, index) => resize(logo, size, webIcons[index])),
    ...appIconSizes.map((size, index) => resize(logo, size, appIcons[index])),
    resize(logo, 256, wrapperIcon),
    ...toolbarIconSizes.map((size, index) => renderToolbar(toolbarSource, size, toolbarIcons[index])),
  ]);

  return { webIcons, appIcons, wrapperIcon, toolbarIcons };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2] ?? 'logo.png';
  syncLogoAssets({ source }).then(({ webIcons, appIcons, toolbarIcons }) => {
    console.log(`Updated ${webIcons.length} extension icons, ${appIcons.length} macOS App Icons, and 1 wrapper window icon from ${source}; ${toolbarIcons.length} transparent toolbar icons from public/icons/toolbar.svg.`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
