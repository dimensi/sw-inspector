// Test-only inspected document adapter; production transport, expressions, runner and controller remain real.
const frame = document.createElement('iframe');
frame.src = '/page.html'; frame.hidden = true; document.body.append(frame);
window.c2calls = []; window.c2deletes = []; window.c2mode = 'normal';
window.c2ready = new Promise<void>(resolve => frame.onload = async () => {
  const page = frame.contentWindow!;
  window.c2page = page;
  const nativeDelete = page.caches.delete.bind(page.caches);
  page.caches.delete = async name => {
    window.c2deletes.push(name);
    if (window.c2mode === 'absent') { await nativeDelete(name); return false; }
    if (window.c2mode === 'middle-fails' && name.includes('beta')) throw new page.Error('Fixture middle deletion rejected');
    if (window.c2mode === 'navigate-after-first' && window.c2deletes.length === 1) page.history.pushState({}, '', '/page.html?navigated=1');
    if (window.c2mode === 'reject') throw new page.Error('Fixture deletion rejected');
    const deleted = await nativeDelete(name);
    if (window.c2mode === 'recreate') await page.caches.open(name);
    if (window.c2mode === 'overview-error') window.c2overviewError = true;
    return deleted;
  };
  window.c2reset = async (long = false) => {
    window.c2mode = 'normal'; window.c2overviewError = false;
    for (const name of await page.caches.keys()) if (name.startsWith('c2-qa-')) await nativeDelete(name);
    const selected = long ? 'c2-qa-' + 'long-namespace/'.repeat(35) : 'c2-qa-assets';
    for (const name of [selected, 'c2-qa-unrelated']) {
      const cache = await page.caches.open(name);
      await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body', { headers: { 'content-type': 'text/plain' } }));
    }
    window.c2deletes.length = 0; window.c2calls.length = 0;
    return selected;
  };
  window.c2seed = async (names) => {
    if (!names.every(name => typeof name === 'string' && name.startsWith('c2-qa-'))) throw new Error('Only c2-qa-* fixture names are allowed');
    window.c2mode = 'normal'; window.c2overviewError = false;
    page.history.replaceState({}, '', '/page.html');
    for (const name of await page.caches.keys()) if (name.startsWith('c2-qa-')) await nativeDelete(name);
    for (const name of names) { const cache = await page.caches.open(name); await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body')); }
    window.c2deletes.length = 0; window.c2calls.length = 0;
  };
  await window.c2reset(); resolve();
});
export const evaluateInspectedWindow = async source => {
  await window.c2ready;
  window.c2calls.push(source);
  if (window.c2holdContext && source.includes('"type":"page-context"')) await new Promise<void>(resolve => { window.c2releaseContext = resolve; });
  if (window.c2overviewError && source.includes('"type":"overview"')) return [null, { isException: true, value: 'Fixture overview read rejected' }];
  try {
    const result = frame.contentWindow!.eval(source);
    if (window.c2mode === 'unknown' && source.includes('"type":"commit-action"')) return [null, { isException: true, value: 'Fixture lost commit acknowledgement' }];
    return [result, undefined];
  } catch (error) { return [null, { isException: true, value: String(error) }]; }
};
export const subscribeInspectedNavigation = cb => { window.c2navigate = cb; return () => {}; };
export const subscribePanelReturn = cb => { window.c2return = cb; return () => {}; };
export const initializePanelActivation = async () => {};
export const requestPanelActivation = async () => {};
export const cancelPanelActivation = () => {};
