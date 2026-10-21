// Test-only server: no preview files are extension entrypoints.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const dependencies = createRequire(require.resolve('@wxt-dev/module-svelte'));
const { createServer } = await import(dependencies.resolve('vite'));
const { svelte } = await import(dependencies.resolve('@sveltejs/vite-plugin-svelte'));
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const alias = [
  ['../../src/bridge/eval-window', 'bridge.ts'],
  ['wxt/browser', 'browser.ts'],
].map(([find, file]) => ({ find, replacement: path.join(root, file) }));
const server = await createServer({ configFile: false, root, cacheDir: '/private/tmp/sw-inspector-night-vite',
  plugins: [svelte()], resolve: { alias }, server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [repo] } } });
let workerVersion = 1;
server.middlewares.use((req, res, next) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/fixture-version') {
    workerVersion = url.searchParams.get('v') === '2' ? 2 : 1;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workerVersion })); return;
  }
  if (url.pathname === '/night-worker.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Service-Worker-Allowed', '/');
    res.end(`const VERSION=${workerVersion}; self.addEventListener('install',()=>{}); self.addEventListener('activate',e=>e.waitUntil(self.clients.claim())); self.addEventListener('message',event=>{ const data=event.data; if(data?.fixture==='silent') return; if(data?.fixture==='broadcast'){event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({fixture:'broadcast',version:VERSION});}));return;} if(event.ports[0]) event.ports[0].postMessage({fixture:'reply',version:VERSION,received:data}); });`); return;
  }
  if (url.pathname === '/fixture-manifest.webmanifest') {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.end(JSON.stringify({name:'Night fixture',short_name:'Night',start_url:'./page.html',scope:'./',display:'standalone',icons:[{src:'./missing-icon.png',sizes:'192x192',type:'image/png'}]}));return;
  }
  next();
});
server.middlewares.use((req, res, next) => {
  if (!req.url?.startsWith('/production/')) return next();
  const file = path.resolve(repo, '.output/safari-mv3', req.url.slice('/production/'.length).split('?')[0]);
  if (!file.startsWith(path.resolve(repo, '.output/safari-mv3') + path.sep) || !fs.existsSync(file)) { res.statusCode=404; res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
server.middlewares.stack.unshift(...server.middlewares.stack.splice(-2));
await server.listen();
console.log('Night real CacheStorage harness: http://127.0.0.1:5198');
