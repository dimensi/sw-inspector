// Synthetic, local-only App Store capture data. Not evidence of native Safari behavior.
// Inject this file before the built panel only on the dedicated capture route.
// It does not register a worker, write Cache Storage, or perform network requests.
(() => {
  const origin = 'https://demo.example.test';
  const encoder = new TextEncoder();
  const NativeDate = window.Date;
  const displayTime = new NativeDate(2026, 9, 19, 10, 9, 41).valueOf();

  // Freeze new Date() for display/export, but retain real Date.now() so transport
  // deadlines and snapshot expiration behave normally within this capture page.
  window.Date = class CaptureDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [displayTime]));
    }

    toLocaleTimeString() {
      return '10:09:41';
    }
  };

  const appConfig = [
    '{',
    '  "app": "Field Notes",',
    '  "version": "1.12.0",',
    '  "locale": "en",',
    '  "routes": [',
    '    "/", "/projects", "/settings"',
    '  ],',
    '  "features": {',
    '    "offlineShell": true,',
    '    "localDrafts": true',
    '  }',
    '}',
  ].join('\n') + '\n';

  const shellPaths = [
    '/',
    '/offline.html',
    '/manifest.webmanifest',
    '/api/app-config.json',
    '/assets/app.3c7a90.js',
    '/assets/vendor.91d2b4.js',
    '/assets/router.5f18c2.js',
    '/assets/styles.2a41c8.css',
    '/assets/theme.6d09aa.css',
    '/assets/chunks/home.a03b91.js',
    '/assets/chunks/projects.b18c42.js',
    '/assets/chunks/inbox.c29d53.js',
    '/assets/chunks/settings.d30e64.js',
    '/assets/chunks/search.e41f75.js',
    '/assets/chunks/help.f52a86.js',
    '/assets/chunks/about.a63b97.js',
    '/assets/chunks/activity.b74ca8.js',
    '/assets/chunks/files.c85db9.js',
    '/assets/chunks/workspace.d96eca.js',
    '/assets/icons.svg',
    '/assets/logo.svg',
    '/assets/empty-state.svg',
    '/robots.txt',
    '/docs/getting-started.html',
    '/docs/offline.html',
    '/projects',
    '/settings',
    '/help',
  ];

  const runtimeBodies = {
    '/api/projects.json': JSON.stringify({ projects: [{ id: 'notes', title: 'Field Notes', items: 8 }, { id: 'research', title: 'Research', items: 5 }] }, null, 2) + '\n',
    '/api/recent-items.json': JSON.stringify({ items: [{ id: 'welcome', title: 'Getting started', project: 'notes' }, { id: 'offline', title: 'Working offline', project: 'notes' }] }, null, 2) + '\n',
    '/api/preferences.json': JSON.stringify({ theme: 'system', locale: 'en', density: 'compact', autosave: true }, null, 2) + '\n',
    '/api/status.json': JSON.stringify({ status: 'available', revision: '12', generatedAt: '2026-10-19T07:09:41.000Z' }, null, 2) + '\n',
  };
  const fontPaths = ['/fonts/ui-regular.woff2', '/fonts/ui-medium.woff2', '/fonts/mono-regular.woff2'];

  function html(title) {
    return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${title} · Field Notes</title>\n  <link rel="stylesheet" href="/assets/styles.2a41c8.css">\n</head>\n<body>\n  <main><h1>${title}</h1><p>Your workspace, available locally.</p></main>\n  <script type="module" src="/assets/app.3c7a90.js"></script>\n</body>\n</html>\n`;
  }

  function contentFor(path) {
    if (path === '/api/app-config.json') return ['application/json; charset=utf-8', appConfig];
    if (path in runtimeBodies) return ['application/json; charset=utf-8', runtimeBodies[path]];
    if (path === '/manifest.webmanifest') {
      return ['application/manifest+json; charset=utf-8', JSON.stringify({ name: 'Field Notes', short_name: 'Notes', start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#0a62c9' }, null, 2) + '\n'];
    }
    if (path.endsWith('.js')) {
      const name = path.split('/').pop().split('.')[0];
      return ['application/javascript; charset=utf-8', `// Field Notes: ${name} module\nexport const revision = "12";\nexport const moduleName = "${name}";\nexport function mount(root) {\n  root.dataset.module = moduleName;\n  return () => delete root.dataset.module;\n}\n`];
    }
    if (path.endsWith('.css')) {
      return ['text/css; charset=utf-8', ':root { color-scheme: light dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; line-height: 1.5; }\nmain { max-width: 64rem; margin: auto; padding: 2rem; }\na { color: #0a62c9; }\n'];
    }
    if (path.endsWith('.svg')) {
      const title = path.split('/').pop().replace('.svg', '').replaceAll('-', ' ');
      return ['image/svg+xml; charset=utf-8', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${title}</title><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" fill="none" stroke="#242424" stroke-width="1.5"/></svg>\n`];
    }
    if (path.endsWith('.woff2')) {
      // Deterministic binary placeholders, never rendered as fonts by the page.
      const bytes = new Uint8Array(2048 + fontPaths.indexOf(path) * 512);
      bytes.set(encoder.encode('wOF2synthetic-capture-font'));
      for (let index = 32; index < bytes.length; index += 1) bytes[index] = (index * 31 + path.length) % 256;
      return ['font/woff2', bytes];
    }
    if (path === '/robots.txt') return ['text/plain; charset=utf-8', 'User-agent: *\nDisallow: /api/\n'];
    const titles = { '/': 'Field Notes', '/offline.html': 'You are offline', '/projects': 'Projects', '/settings': 'Settings', '/help': 'Help', '/docs/getting-started.html': 'Getting started', '/docs/offline.html': 'Working offline' };
    return ['text/html; charset=utf-8', html(titles[path] ?? 'Field Notes')];
  }

  function recordFor(path) {
    const [contentType, content] = contentFor(path);
    const body = typeof content === 'string' ? encoder.encode(content) : content;
    const immutable = /\.[a-f0-9]{6}\.(js|css)$/.test(path) || path.endsWith('.woff2');
    return {
      request: new Request(origin + path, { method: 'GET', mode: 'same-origin' }),
      body,
      status: 200,
      headers: {
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : path.startsWith('/api/') ? 'public, max-age=300' : 'public, max-age=3600',
        'content-length': String(body.byteLength),
        'content-type': contentType,
        'etag': `"v12-${body.byteLength.toString(16)}"`,
        'last-modified': 'Mon, 19 Oct 2026 07:00:00 GMT',
      },
    };
  }

  const records = new Map([
    ['shell-v12', shellPaths.map(recordFor)],
    ['runtime-v4', Object.keys(runtimeBodies).map(recordFor)],
    ['fonts-v2', fontPaths.map(recordFor)],
  ]);
  const bodyBytes = [...records.values()].flat().reduce((total, record) => total + record.body.byteLength, 0);

  function matchRecord(entries, input) {
    const request = input instanceof Request ? input : new Request(new URL(String(input), origin));
    if (request.method !== 'GET') return undefined;
    const found = entries.find((record) => record.request.url === request.url);
    return found ? new Response(found.body.slice(), { status: found.status, headers: found.headers }) : undefined;
  }

  const cacheAPI = {
    keys: async () => [...records.keys()],
    async open(name) {
      const entries = records.get(name);
      if (!entries) throw new Error(`Synthetic cache does not exist: ${name}`);
      return {
        keys: async () => entries.map((record) => record.request.clone()),
        match: async (input) => matchRecord(entries, input),
      };
    },
    async match(input) {
      for (const entries of records.values()) {
        const response = matchRecord(entries, input);
        if (response) return response;
      }
      return undefined;
    },
  };
  const active = { scriptURL: origin + '/service-worker.js?v=12', state: 'activated' };
  const waiting = { scriptURL: origin + '/service-worker.js?v=13', state: 'installed' };
  const fakeNavigator = {
    serviceWorker: { controller: active, getRegistrations: async () => [{ scope: origin + '/', active, waiting, installing: null }] },
    storage: { estimate: async () => ({ usage: bodyBytes + 32768, quota: 1073741824 }) },
  };
  const scope = { caches: cacheAPI };
  const control = window.previewControl = { denied: false, calls: [], listeners: new Set() };
  window.storeDemo = Object.freeze({
    synthetic: true,
    origin,
    shellPaths: Object.freeze([...shellPaths]),
    runtimePaths: Object.freeze(Object.keys(runtimeBodies)),
    fontPaths: Object.freeze([...fontPaths]),
    cacheBodyBytes: bodyBytes,
    originUsageBytes: bodyBytes + 32768,
    suggestedOfflinePaths: '/\n/offline.html\n/api/app-config.json\n/projects\n/account',
  });

  const evaluate = (source) => new Function('globalThis', 'navigator', 'caches', 'location', 'Date', `return (${source});`)(scope, fakeNavigator, cacheAPI, { origin }, NativeDate);
  window.browser = {
    runtime: {
      id: 'synthetic-app-store-capture',
      getURL: (path) => new URL(path, location.origin).href,
      onMessage: {
        addListener: (listener) => control.listeners.add(listener),
        removeListener: (listener) => control.listeners.delete(listener),
      },
      async sendMessage(message) {
        control.calls.push(message.source);
        if (control.denied) return { kind: 'sw-inspector/evaluated', session: message.session, result: null, exception: { isException: true, value: 'Invalid call to devtools.inspectedWindow.eval(). This extension does not have access to this tab.' } };
        try {
          return { kind: 'sw-inspector/evaluated', session: message.session, result: evaluate(message.source) ?? null, exception: null };
        } catch (error) {
          return { kind: 'sw-inspector/evaluated', session: message.session, result: null, exception: { isException: true, value: error.message } };
        }
      },
    },
    devtools: { inspectedWindow: { eval: () => { throw new Error('Panel native eval must not be used by the capture fixture'); } } },
  };
})();
