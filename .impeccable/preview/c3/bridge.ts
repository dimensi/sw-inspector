// Test-only inspected document adapter; production transport, expressions, runner and controller remain real.
const frame = document.createElement('iframe');
frame.src = '/page.html'; frame.hidden = true; document.body.append(frame);
window.c3calls = []; window.c3deletes = []; window.c3mode = 'normal';
window.c3ready = new Promise<void>(resolve => frame.onload = async () => {
  const page = frame.contentWindow!;
  window.c3page = page;
  const nativeDelete = page.caches.delete.bind(page.caches);
  page.caches.delete = async name => {
    window.c3deletes.push(name);
    if (window.c3mode === 'absent') { await nativeDelete(name); return false; }
    if (window.c3mode === 'middle-fails' && name.includes('beta')) throw new page.Error('Fixture middle deletion rejected');
    if (window.c3mode === 'navigate-after-first' && window.c3deletes.length === 1) page.history.pushState({}, '', '/page.html?navigated=1');
    if (window.c3mode === 'reject') throw new page.Error('Fixture deletion rejected');
    const deleted = await nativeDelete(name);
    if (window.c3mode === 'recreate') await page.caches.open(name);
    if (window.c3mode === 'overview-error') window.c3overviewError = true;
    return deleted;
  };
  window.c3reset = async (long = false) => {
    window.c3mode = 'normal'; window.c3overviewError = false;
    for (const name of await page.caches.keys()) if (name.startsWith('c3-qa-')) await nativeDelete(name);
    const selected = long ? 'c3-qa-' + 'long-namespace/'.repeat(35) : 'c3-qa-assets';
    for (const name of [selected, 'c3-qa-unrelated']) {
      const cache = await page.caches.open(name);
      await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body', { headers: { 'content-type': 'text/plain' } }));
    }
    window.c3deletes.length = 0; window.c3calls.length = 0;
    return selected;
  };
  window.c3seed = async (names) => {
    if (!names.every(name => typeof name === 'string' && name.startsWith('c3-qa-'))) throw new Error('Only c3-qa-* fixture names are allowed');
    window.c3mode = 'normal'; window.c3overviewError = false;
    page.history.replaceState({}, '', '/page.html');
    for (const name of await page.caches.keys()) if (name.startsWith('c3-qa-')) await nativeDelete(name);
    for (const name of names) { const cache = await page.caches.open(name); await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body')); }
    window.c3deletes.length = 0; window.c3calls.length = 0;
  };
  window.c3entryDeletes = [];
  const nativeEntryDelete = page.Cache.prototype.delete;
  page.Cache.prototype.delete = async function(request, options) {
    window.c3entryDeletes.push({url:request.url,language:request.headers.get('accept-language'),options});
    if(window.c3mode === 'entry-reject') throw new page.Error('Fixture entry deletion rejected');
    if(window.c3mode === 'entry-absent') { await nativeEntryDelete.call(this,request,options); return false; }
    const result = await nativeEntryDelete.call(this,request,options);
    if(window.c3mode === 'overview-error') window.c3overviewError = true;
    return result;
  };
  window.c3seedEntries = async (long = false) => {
    await window.c3seed(['c3-qa-selected','c3-qa-unrelated']);
    const cache = await page.caches.open('c3-qa-selected');
    for(const request of await cache.keys()) await nativeEntryDelete.call(cache,request);
    const url=location.origin+'/same-resource'+(long?'/'+'long-resource-segment/'.repeat(30):'');
    for(const language of ['en','ru']) await cache.put(new page.Request(url,{headers:{'Accept-Language':language}}),new page.Response(language+' body',{headers:{'Vary':'Accept-Language','Content-Type':'text/plain'}}));
    for(const version of ['1','2']) await cache.put(new page.Request(location.origin+'/query-resource?v='+version),new page.Response('query '+version));
    window.c3retainedCache=cache; window.c3entryDeletes.length=0; return url;
  };
  await window.c3reset(); resolve();
});
export const evaluateInspectedWindow = async source => {
  await window.c3ready;
  window.c3calls.push(source);
  if (window.c3holdPrepare && source.includes('"type":"prepare-action"')) await new Promise<void>(resolve => { window.c3releasePrepare = resolve; });
  if (window.c3holdContext && source.includes('"type":"page-context"')) await new Promise<void>(resolve => { window.c3releaseContext = resolve; });
  if (window.c3overviewError && source.includes('"type":"overview"')) return [null, { isException: true, value: 'Fixture overview read rejected' }];
  try {
    const result = frame.contentWindow!.eval(source);
    if (window.c3mode === 'unknown' && source.includes('"type":"commit-action"')) return [null, { isException: true, value: 'Fixture lost commit acknowledgement' }];
    return [result, undefined];
  } catch (error) { return [null, { isException: true, value: String(error) }]; }
};
export const subscribeInspectedNavigation = cb => { window.c3navigate = cb; return () => {}; };
export const subscribePanelReturn = cb => { window.c3return = cb; return () => {}; };
export const initializePanelActivation = async () => {};
export const requestPanelActivation = async () => {};
export const cancelPanelActivation = () => {};
