// Served with explicit v1/v2 bytes by server.py; no automatic activation helpers.
const FIXTURE_VERSION = '__FIXTURE_VERSION__';

// Cooperative fixture protocol only; Inspector has no built-in commands/presets.
self.addEventListener('message', event => {
  if (!['http://localhost:4174', 'http://127.0.0.1:4174'].includes(self.location.origin)) return;
  const command = event.data;
  if (!command || typeof command !== 'object' || !['echo', 'no-reply', 'delayed-reply', 'page-directed'].includes(command.fixture)) return;
  const port = event.ports[0];
  if (command.fixture === 'no-reply') { port?.close(); return; }
  if (command.fixture === 'page-directed') {
    // Only the originating page receives this ordinary, uncorrelated message.
    if (event.source && 'url' in event.source && new URL(event.source.url).pathname === '/sw-inspector-worker/') event.source.postMessage({ fixture: 'page-directed', value: command.value ?? null });
    port?.close(); return;
  }
  if (!port) return;
  event.waitUntil((async () => {
    if (command.fixture === 'delayed-reply') await new Promise(resolve => setTimeout(resolve, 1000));
    port.postMessage(command.value ?? null); port.close();
  })());
});
