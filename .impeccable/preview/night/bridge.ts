// Test-only inspected document adapter; production transport, expressions, runner and controller remain real.
const frame = document.createElement('iframe');
frame.src = '/page.html'; frame.hidden = true; document.body.append(frame);
window.nightcalls = []; window.nightdeletes = []; window.nightmode = 'normal';
window.nightready = new Promise<void>(resolve => frame.onload = async () => {
  const page = frame.contentWindow!;
  window.nightpage = page;
  const nativeDelete = page.caches.delete.bind(page.caches);
  page.caches.delete = async name => {
    window.nightdeletes.push(name);
    if (window.nightmode === 'absent') { await nativeDelete(name); return false; }
    if (window.nightmode === 'middle-fails' && name.includes('beta')) throw new page.Error('Fixture middle deletion rejected');
    if (window.nightmode === 'navigate-after-first' && window.nightdeletes.length === 1) page.history.pushState({}, '', '/page.html?navigated=1');
    if (window.nightmode === 'reject') throw new page.Error('Fixture deletion rejected');
    const deleted = await nativeDelete(name);
    if (window.nightmode === 'recreate') await page.caches.open(name);
    if (window.nightmode === 'overview-error') window.nightoverviewError = true;
    return deleted;
  };
  window.nightreset = async (long = false) => {
    window.nightmode = 'normal'; window.nightoverviewError = false;
    for (const name of await page.caches.keys()) if (name.startsWith('night-qa-')) await nativeDelete(name);
    const selected = long ? 'night-qa-' + 'long-namespace/'.repeat(35) : 'night-qa-assets';
    for (const name of [selected, 'night-qa-unrelated']) {
      const cache = await page.caches.open(name);
      await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body', { headers: { 'content-type': 'text/plain' } }));
    }
    window.nightdeletes.length = 0; window.nightcalls.length = 0;
    return selected;
  };
  window.nightseed = async (names) => {
    if (!names.every(name => typeof name === 'string' && name.startsWith('night-qa-'))) throw new Error('Only night-qa-* fixture names are allowed');
    window.nightmode = 'normal'; window.nightoverviewError = false;
    page.history.replaceState({}, '', '/page.html');
    for (const name of await page.caches.keys()) if (name.startsWith('night-qa-')) await nativeDelete(name);
    for (const name of names) { const cache = await page.caches.open(name); await cache.put(new page.Request(location.origin + '/fixture-resource?cache=' + encodeURIComponent(name)), new page.Response('fixture body')); }
    window.nightdeletes.length = 0; window.nightcalls.length = 0;
  };
  window.nightentryDeletes = [];
  const nativeEntryDelete = page.Cache.prototype.delete;
  page.Cache.prototype.delete = async function(request, options) {
    window.nightentryDeletes.push({url:request.url,language:request.headers.get('accept-language'),options});
    if(window.nightmode === 'entry-reject') throw new page.Error('Fixture entry deletion rejected');
    if(window.nightmode === 'entry-absent') { await nativeEntryDelete.call(this,request,options); return false; }
    const result = await nativeEntryDelete.call(this,request,options);
    if(window.nightmode === 'overview-error') window.nightoverviewError = true;
    return result;
  };
  window.nightseedEntries = async (long = false) => {
    await window.nightseed(['night-qa-selected','night-qa-unrelated']);
    const cache = await page.caches.open('night-qa-selected');
    for(const request of await cache.keys()) await nativeEntryDelete.call(cache,request);
    const url=location.origin+'/same-resource'+(long?'/'+'long-resource-segment/'.repeat(30):'');
    for(const language of ['en','ru']) await cache.put(new page.Request(url,{headers:{'Accept-Language':language}}),new page.Response(language+' body',{headers:{'Vary':'Accept-Language','Content-Type':'text/plain'}}));
    for(const version of ['1','2']) await cache.put(new page.Request(location.origin+'/query-resource?v='+version),new page.Response('query '+version));
    window.nightretainedCache=cache; window.nightentryDeletes.length=0; return url;
  };
  const realGetRegistrations = page.navigator.serviceWorker.getRegistrations.bind(page.navigator.serviceWorker);
  window.nightRestoreWorkers = () => { page.navigator.serviceWorker.getRegistrations = realGetRegistrations; };
  window.nightSyntheticWorkers = (count=2,long=false) => {
    window.nightoverviewError=false; window.nightmode='normal'; window.nightWorkerCalls.length=0;
    const registrationList = Array.from({length:count},(_,index)=>{
      const scope=location.origin+'/worker-scope-'+index+'/'+(long?'long-scope-segment/'.repeat(24):'');
      const record={scope,installing:null,waiting:null,active:{scriptURL:location.origin+'/shared-worker.js'+(long?'?value='+'long-script-value/'.repeat(24):''),state:'activated'}};
      const effect=async method=>{
        window.nightWorkerCalls.push({method,scope});
        if(window.nightmode==='worker-pending')await new Promise(resolve=>window.nightReleaseWorker=resolve);
        if(window.nightmode==='worker-reject')throw new page.Error('Fixture worker operation rejected');
        if(window.nightmode==='worker-read-failure')window.nightoverviewError=true;
        return window.nightmode==='worker-absent'?false:true;
      };
      return Object.assign(record,{update:()=>effect('update'),unregister:()=>effect('unregister')});
    });
    page.navigator.serviceWorker.getRegistrations=async()=>registrationList;
    window.nightSyntheticRegistrations=registrationList;
  };
  window.nightWorkerCalls = [];
  for (const method of ['update', 'unregister']) {
    const original = page.ServiceWorkerRegistration.prototype[method];
    page.ServiceWorkerRegistration.prototype[method] = async function(...args) {
      window.nightWorkerCalls.push({method,scope:this.scope});
      if(window.nightmode === 'worker-reject') throw new page.Error('Fixture worker action rejected');
      const result = await original.apply(this,args);
      if(window.nightmode === 'worker-read-failure') window.nightoverviewError = true;
      return result;
    };
  }
  window.nightSetupWorkers = async () => {
    await fetch('/fixture-version?v=1');
    for(const scope of ['/', '/secondary/']) {
      const registration = await page.navigator.serviceWorker.register('/night-worker.js',{scope,updateViaCache:'none'});
      const worker = registration.installing || registration.waiting || registration.active;
      if(worker && worker.state !== 'activated') await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Fixture worker activation timeout')),10000);
        worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}});
      });
    }
    window.nightWorkerCalls.length=0;
    return (await page.navigator.serviceWorker.getRegistrations()).map(registration=>({scope:registration.scope,active:registration.active?.scriptURL}));
  };
  window.nightManifestRequests=[]; window.nightManifestMode='valid';
  const realPageFetch=page.fetch.bind(page);
  page.fetch=async (...args)=>{
    window.nightManifestRequests.push({url:String(args[0])});
    const mode=window.nightManifestMode;
    if(mode==='network-error')throw new page.TypeError('Fixture network read failed');
    if(mode==='old-delayed')await new Promise(resolve=>window.nightReleaseManifest=resolve);
    const native=await realPageFetch(...args);
    if(mode==='valid')return native;
    let text=mode==='invalid-json'?'<script>window.nightScriptExecuted=true</script>':mode==='too-large'?' '.repeat(262145):JSON.stringify({name:mode==='old-delayed'?'Old delayed manifest':'<img src=x onerror="window.nightScriptExecuted=true"> '+ 'long-manifest-name/'.repeat(60),start_url:'./page.html',icons:[{src:'./same.png',sizes:'192x192'},{src:'./same.png',sizes:'512x512'}]});
    const response=new page.Response(text,{headers:{'Content-Type':'application/manifest+json'}});
    Object.defineProperty(response,'url',{value:native.url});return response;
  };
  window.nightSetManifest = (href='/fixture-manifest.webmanifest') => {
    for(const link of page.document.querySelectorAll('link[rel=manifest]'))link.remove();
    if(href!==null){const link=page.document.createElement('link');link.rel='manifest';link.href=href;page.document.head.append(link);}
  };
  await window.nightreset(); resolve();
});
export const evaluateInspectedWindow = async source => {
  await window.nightready;
  window.nightcalls.push(source);
  if (window.nightholdInventory && source.includes('"type":"list-cache-keys"')) await new Promise<void>(resolve => { window.nightreleaseInventory = resolve; });
  if (window.nightholdPrepare && source.includes('"type":"prepare-action"')) await new Promise<void>(resolve => { window.nightreleasePrepare = resolve; });
  if (window.nightinventoryError && source.includes('"type":"list-cache-keys"')) return [null, { isException: true, value: 'Fixture inventory read rejected' }];
  if (window.nightholdContext && source.includes('"type":"page-context"')) await new Promise<void>(resolve => { window.nightreleaseContext = resolve; });
  if (window.nightoverviewError && source.includes('"type":"overview"')) return [null, { isException: true, value: 'Fixture overview read rejected' }];
  if(window.nightExternalEnabled===true&&window.nightExternalEval)return window.nightExternalEval(source);
  try {
    const result = frame.contentWindow!.eval(source);
    if (window.nightmode === 'unknown' && source.includes('"type":"commit-action"')) return [null, { isException: true, value: 'Fixture lost commit acknowledgement' }];
    return [result, undefined];
  } catch (error) { return [null, { isException: true, value: String(error) }]; }
};
export const subscribeInspectedNavigation = cb => { window.nightnavigate = cb; return () => {}; };
export const subscribePanelReturn = cb => { window.nightreturn = cb; return () => {}; };
export const initializePanelActivation = async () => {};
export const requestPanelActivation = async () => {};
export const cancelPanelActivation = () => {};
