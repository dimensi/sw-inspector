// Test-only server: no preview files are extension entrypoints.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dependencies = createRequire(require.resolve('@wxt-dev/module-svelte'));
const { createServer } = await import(dependencies.resolve('vite'));
const { svelte } = await import(dependencies.resolve('@sveltejs/vite-plugin-svelte'));
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const alias = [
  ['../../src/ui/action-controller', 'controller.ts'],
  ['../../src/bridge/eval-window', 'bridge.ts'],
  ['../../src/bridge/transport', 'transport.ts'],
  ['wxt/browser', 'browser.ts'],
].map(([find, file]) => ({ find, replacement: path.join(root, file) }));
const server = await createServer({ configFile: false, root, cacheDir: '/private/tmp/sw-inspector-a4-vite',
  plugins: [svelte()], resolve: { alias }, server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [repo] } } });
await server.listen();
console.log('A4 test-only harness: http://127.0.0.1:5194');
