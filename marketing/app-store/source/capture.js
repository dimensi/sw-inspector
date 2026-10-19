async (page) => {
  const base = 'http://127.0.0.1:4187';
  const out = 'marketing/app-store';
  const names = ['01-service-workers', '02-cache-storage', '03-response-preview', '04-body-measurement', '05-offline-resources'];
  const notes = [];
  async function settle() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
  }
  async function capture(file, fullPage = false) {
    await settle();
    await page.screenshot({ path: `${out}/${file}.png`, fullPage, scale: 'device', animations: 'disabled', omitBackground: false });
    notes.push(file);
  }
  async function fresh(theme = 'light', width = 1342, height = 670) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto(`${base}/panel.html?session=store`);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('https://demo.example.test', { exact: true }).first().waitFor();
    await page.getByRole('heading', { name: 'Origin storage' }).waitFor();
  }
  async function cache() {
    await page.getByRole('button', { name: 'shell-v12 28', exact: true }).click();
    await page.getByRole('button', { name: 'GET https://demo.example.test/api/app-config.json', exact: true }).click();
    await page.getByRole('button', { name: 'Load text / JSON', exact: true }).waitFor();
  }
  await fresh();
  await capture(`raw/${names[0]}`);
  await cache();
  await page.locator('summary').filter({ hasText: 'Response headers' }).click();
  await capture(`raw/${names[1]}`);

  await fresh('dark');
  await cache();
  await page.getByRole('button', { name: 'Load text / JSON', exact: true }).click();
  await page.locator('pre.preview').waitFor();
  await capture(`raw/${names[2]}`);
  // A body preview releases its request snapshot; select the cache again first.
  await cache();
  await page.getByLabel('Filter cached request URLs').fill('/assets/');
  await page.getByRole('button', { name: 'GET https://demo.example.test/assets/app.3c7a90.js', exact: true }).click();
  await page.getByRole('button', { name: 'Load text / JSON', exact: true }).click();
  await page.locator('pre.preview').filter({ hasText: 'Field Notes: app module' }).waitFor();
  await page.getByRole('button', { name: 'Measure bodies', exact: true }).click();
  await page.getByText('28 scanned · 0 unknown · 0 failed', { exact: true }).waitFor();
  await capture(`raw/${names[3]}`);

  await fresh();
  await page.getByRole('button', { name: 'Offline Resources', exact: true }).click();
  await page.getByLabel('Same-origin URLs or paths, one per line').fill('/\n/offline.html\n/manifest.webmanifest\n/api/app-config.json\n/projects\n/settings\n/help\n/account\n/assets/missing.js');
  await page.getByRole('button', { name: 'Check keys', exact: true }).click();
  await page.getByText('Not present', { exact: true }).first().waitFor();
  await capture(`raw/${names[4]}`);

  // Exact compact interface captures for the appearance mockup, not crops.
  for (const [theme, file] of [['light', '06-compact-light'], ['dark', '07-compact-dark']]) {
    await fresh(theme, 714, 670);
    await cache();
    // Metadata-only view keeps the compact pane clean; do not auto-scroll to preview.
    await page.locator('.details-scroll').evaluate(element => { element.scrollTop = 0; });
    await capture(`raw/${file}`);
  }

  return { captured: notes, pixelRatio: await page.evaluate(() => devicePixelRatio), browser: 'Playwright WebKit; actual compiled panel with synthetic APIs' };
}
