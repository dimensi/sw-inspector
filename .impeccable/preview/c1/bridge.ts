// Test-only inspected document adapter; production transport, expressions, runner and controller remain real.
const frame = document.createElement('iframe');
frame.src = '/page.html'; frame.hidden = true; document.body.append(frame);
window.c1calls = []; window.c1deletes = []; window.c1mode = 'normal';
window.c1ready = new Promise<void>(resolve => frame.onload = async () => {
  const page = frame.contentWindow!;
  window.c1page = page;
  const nativeDelete = page.caches.delete.bind(page.caches);
  page.caches.delete = async name => {
    window.c1deletes.push(name);
    if (window.c1mode === 'absent') { await nativeDelete(name); return false; }
    if (window.c1mode === 'reject') throw new page.Error('Fixture deletion rejected');
    const deleted = await nativeDelete(name);
    if (window.c1mode === 'recreate') await page.caches.open(name);
    if (window.c1mode === 'overview-error') window.c1overviewError = true;
    return deleted;
  };
  window.c1reset = async (long = false) => {
    window.c1mode = 'normal'; window.c1overviewError = false;
    for (const name of await page.caches.keys()) if (name.startsWith('c1-qa-')) await nativeDelete(name);
    const selected = long ? 'c1-qa-' + 'long-namespace/'.repeat(35) : 'c1-qa-assets';
    for (const name of [selected, 'c1-qa-unrelated']) {
      const cache = await page.caches.open(name);
      await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body', { headers: { 'content-type': 'text/plain' } }));
    }
    window.c1deletes.length = 0; window.c1calls.length = 0;
    return selected;
  };
  await window.c1reset(); resolve();
});
export const evaluateInspectedWindow = async source => {
  await window.c1ready;
  window.c1calls.push(source);
  if (window.c1holdContext && source.includes('"type":"page-context"')) await new Promise<void>(resolve => { window.c1releaseContext = resolve; });
  if (window.c1overviewError && source.includes('"type":"overview"')) return [null, { isException: true, value: 'Fixture overview read rejected' }];
  try {
    const result = frame.contentWindow!.eval(source);
    if (window.c1mode === 'unknown' && source.includes('"type":"commit-action"')) return [null, { isException: true, value: 'Fixture lost commit acknowledgement' }];
    return [result, undefined];
  } catch (error) { return [null, { isException: true, value: String(error) }]; }
};
export const subscribeInspectedNavigation = cb => { window.c1navigate = cb; return () => {}; };
export const subscribePanelReturn = cb => { window.c1return = cb; return () => {}; };
export const initializePanelActivation = async () => {};
export const requestPanelActivation = async () => {};
export const cancelPanelActivation = () => {};
