import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../../..');
const pack = resolve(source, '..');
const build = resolve(root, '.output/safari-mv3');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let body;
    let type;
    if (path === '/panel.html') {
      body = (await readFile(resolve(build, 'panel.html'), 'utf8')).replace('<head>', '<head><script src="/demo-fixture.js"></script>');
      type = 'text/html';
    } else {
      const target = path === '/demo-fixture.js' ? resolve(source, 'demo-fixture.js')
        : path === '/logo.png' ? resolve(root, 'public/icons/128.png')
        : path === '/' || path === '/composition.html' ? resolve(source, 'composition.html')
        : path.startsWith('/pack/') ? resolve(pack, path.slice(6))
        : resolve(build, path.slice(1));
      if (![source, pack, build, resolve(root, 'public')].some(base => target.startsWith(base + sep))) throw new Error('Forbidden');
      body = await readFile(target);
      type = types[extname(target)] ?? 'application/octet-stream';
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(4187, '127.0.0.1', () => console.log('Asset preview: http://127.0.0.1:4187'));
