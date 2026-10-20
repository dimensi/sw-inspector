// Synthetic, in-memory UI fixture. Never included in the extension bundle.
(() => {
  const origin = 'https://fixture.example.test';
  const paths = ['/','/manifest.webmanifest','/assets/app.8e7c4a.js','/assets/vendor.c2f18b.js','/assets/styles.a36de1.css','/assets/worker.25cf19.js','/fonts/ui-regular.woff2','/fonts/ui-medium.woff2', ...Array.from({length: 24}, (_, i) => `/assets/chunks/route-${String(i + 1).padStart(2,'0')}.b7d4e2.js`)];
  const namespaces = ['app-cache-20122', 'image-cache-v3', 'runtime-cache-long-namespace-for-overflow-verification'];
  const resources = paths.map((path) => new Request(origin + path));
  const responseFor = (request) => {
    const url = typeof request === 'string' ? request : request.url;
    if (!resources.some(r => r.url === url)) return undefined;
    return new Response('// Synthetic response used for UI verification.\nexport const revision = "20122";\n', {status: 200, headers: {'content-type': 'application/javascript; charset=utf-8','cache-control':'public, max-age=31536000, immutable','content-length':'84'}});
  };
  const cacheAPI = { keys: async () => namespaces, open: async () => ({keys: async () => resources, match: async (r) => responseFor(r)}), match: async (r) => responseFor(r) };
  const worker = {scriptURL: origin + '/service-worker.js',state:'activated'};
  const fakeNavigator = {serviceWorker:{controller:worker,getRegistrations:async () => [{scope:origin+'/',active:worker,waiting:null,installing:null}]},storage:{estimate:async()=>({usage:9243650,quota:10737418240})}};
  const lifecycle = new EventTarget();
  const scope = {caches:cacheAPI,addEventListener:lifecycle.addEventListener.bind(lifecycle),removeEventListener:lifecycle.removeEventListener.bind(lifecycle)};
  window.previewControl = {denied:false,calls:[],listeners:new Set()};
  const evaluate = (source) => new Function('globalThis','navigator','caches','location',`return (${source});`)(scope,fakeNavigator,cacheAPI,{origin,href:origin+'/'});
  window.browser = {
    runtime:{id:'synthetic-ui-fixture',getURL:path=>new URL(path,location.origin).href,onMessage:{addListener:listener=>previewControl.listeners.add(listener),removeListener:listener=>previewControl.listeners.delete(listener)},
      async sendMessage(message) {
        previewControl.calls.push(message.source);
        if (previewControl.denied) return {kind:'sw-inspector/evaluated',session:message.session,result:null,exception:{isException:true,value:'Invalid call to devtools.inspectedWindow.eval(). This extension does not have access to this tab.'}};
        try {return {kind:'sw-inspector/evaluated',session:message.session,result:evaluate(message.source)??null,exception:null};}
        catch (error) {return {kind:'sw-inspector/evaluated',session:message.session,result:null,exception:{isException:true,value:error.message}};}
      }},
    devtools:{inspectedWindow:{eval:()=>{throw new Error('Panel native eval must not be used');}}}
  };
})();
