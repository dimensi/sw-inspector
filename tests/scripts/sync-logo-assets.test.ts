import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { syncLogoAssets } from '../../scripts/sync-logo-assets.mjs';

const sourceLogo = new URL('../../logo.png', import.meta.url);
const sourceToolbar = new URL('../../public/icons/toolbar.svg', import.meta.url);
const run = promisify(execFile);

describe('syncLogoAssets', () => {
  it('keeps transparent monochrome toolbar icons separate from the identity logo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sw-inspector-logo-test-'));
    const logo = join(root, 'logo.png');
    await cp(sourceLogo, logo);
    await mkdir(join(root, 'public/icons'), { recursive: true });
    await cp(sourceToolbar, join(root, 'public/icons/toolbar.svg'));

    try {
      const generated = await syncLogoAssets({ root, source: logo });

      expect(generated.webIcons).toHaveLength(4);
      expect(generated.appIcons).toHaveLength(7);
      expect(generated.toolbarIcons).toHaveLength(4);
      await Promise.all([...generated.webIcons, ...generated.appIcons].map((file) => stat(file)));
      expect(generated.webIcons).toContain(join(root, 'public/icons/48.png'));
      expect(generated.appIcons).toContain(join(root, 'apple/SW Inspector/SW Inspector/Assets.xcassets/AppIcon.appiconset/app-icon-1024.png'));
      const wrapperIcon = join(root, 'apple/SW Inspector/SW Inspector/Resources/Icon.png');
      expect(generated.wrapperIcon).toBe(wrapperIcon);
      const wrapperPng = await readFile(wrapperIcon);
      expect(wrapperPng.subarray(1, 4).toString()).toBe('PNG');
      expect(wrapperPng.readUInt32BE(16)).toBe(256);
      expect(wrapperPng.readUInt32BE(20)).toBe(256);

      for (const size of [16, 19, 32, 38]) {
        const icon = join(root, `public/icons/toolbar-${size}.png`);
        expect(generated.toolbarIcons).toContain(icon);
        const png = await readFile(icon);
        expect(png.readUInt32BE(16)).toBe(size);
        expect(png.readUInt32BE(20)).toBe(size);
        const { stdout: rgba } = await run('magick', [icon, '-depth', '8', 'rgba:-'], { encoding: 'buffer' });
        expect(rgba).toHaveLength(size * size * 4);
        const alpha = Array.from({ length: size * size }, (_, pixel) => rgba[pixel * 4 + 3]);
        expect(alpha[0]).toBe(0);
        expect(alpha.at(-1)).toBe(0);
        expect(Math.max(...alpha)).toBeGreaterThan(200);
        for (let pixel = 0; pixel < alpha.length; pixel++) {
          if (alpha[pixel] > 0) expect([...rgba.subarray(pixel * 4, pixel * 4 + 3)]).toEqual([0, 0, 0]);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
