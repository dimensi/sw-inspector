async (page) => {
  const base = 'http://127.0.0.1:4187';
  const out = 'marketing/app-store';
  const names = ['01-service-workers', '02-cache-storage', '03-response-preview', '04-body-measurement', '05-offline-resources'];
  const notes = [];
  async function render(mode, file, fullPage = false) {
    await page.goto(`${base}/composition.html?${mode}`);
    await page.evaluate(() => window.assetReady);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/${file}.png`, fullPage, scale: fullPage ? 'css' : 'device', animations: 'disabled', omitBackground: false });
    notes.push(file);
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let shot = 0; shot < names.length; shot++) await render(`mode=store&shot=${shot}`, `screenshots/${names[shot]}`);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await render('mode=workspace', 'mockups/01-workspace');
  await render('mode=themes', 'mockups/02-appearance');
  await page.setViewportSize({ width: 1440, height: 900 });
  await render('mode=contact', 'overview', true);
  return { captured: notes, pixelRatio: await page.evaluate(() => devicePixelRatio), browser: await page.evaluate(() => navigator.userAgent) };
}
