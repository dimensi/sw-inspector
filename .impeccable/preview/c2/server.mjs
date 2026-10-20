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
const server = await createServer({ configFile: false, root, cacheDir: '/private/tmp/sw-inspector-c2-vite',
  plugins: [svelte()], resolve: { alias }, server: { host: '127.0.0.1', port: 5196, strictPort: true, fs: { allow: [repo] } } });
server.middlewares.use((req, res, next) => {
  if (!req.url?.startsWith('/production/')) return next();
  const file = path.resolve(repo, '.output/safari-mv3', req.url.slice('/production/'.length).split('?')[0]);
  if (!file.startsWith(path.resolve(repo, '.output/safari-mv3') + path.sep) || !fs.existsSync(file)) { res.statusCode=404; res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
server.middlewares.stack.unshift(server.middlewares.stack.pop());
await server.listen();
console.log('C2 real CacheStorage harness: http://127.0.0.1:5196');
