import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const appleRoot = new URL('../../apple/SW Inspector/', import.meta.url);
const extensionResources = new URL('SW Inspector Extension/Resources/', appleRoot);
const projectFile = new URL('SW Inspector.xcodeproj/project.pbxproj', appleRoot);
const appIconSet = new URL('SW Inspector/Assets.xcassets/AppIcon.appiconset/', appleRoot);

describe('Apple Safari extension icons', () => {
  it('copies every manifest icon into the extension target bundle', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionResources), 'utf8')) as {
      icons: Record<string, string>;
    };
    const project = await readFile(projectFile, 'utf8');

    await Promise.all(Object.values(manifest.icons).map((icon) => stat(new URL(`.${icon}`, extensionResources))));
    expect(project).toMatch(/EEDABA6730864130007892A8 .* icons in Resources .*fileRef = EEDABA6830864130007892A8/);
    expect(project).toMatch(/EEDABA6830864130007892A8 .* icons .*path = Resources\/icons/);
  });

  it('supplies the completed logo at every macOS app icon scale', async () => {
    const catalog = JSON.parse(await readFile(new URL('Contents.json', appIconSet), 'utf8')) as {
      images: Array<{ filename?: string }>;
    };
    const filenames = catalog.images.map((image) => image.filename).filter((filename): filename is string => Boolean(filename));

    expect(filenames).toHaveLength(10);
    await Promise.all(filenames.map((filename) => stat(new URL(filename, appIconSet))));
  });

  it('bundles a dedicated vector toolbar icon for the popup-free Safari action', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionResources), 'utf8')) as {
      icons: Record<string, string>;
      action?: { default_title?: string; default_icon?: string; default_popup?: string };
    };

    expect(manifest.action?.default_title).toBe('SW Inspector');
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(manifest.action?.default_icon).toBe('/icons/toolbar.svg');
    expect(Object.values(manifest.icons)).not.toContain(manifest.action?.default_icon);
    const svg = await readFile(new URL('icons/toolbar.svg', extensionResources), 'utf8');
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#000"');
  });
});
