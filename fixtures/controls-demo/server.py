#!/usr/bin/env python3
"""Loopback-only disposable fixture server; changing worker bytes is explicit."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKER_SCOPE = '/sw-inspector-worker/'


class FixtureHandler(SimpleHTTPRequestHandler):
    worker_version = 1

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == WORKER_SCOPE + 'sw.js':
            # No fetch interception, claim, skipWaiting, cache writes or messaging.
            source = (ROOT / 'sw.js').read_text().replace('__FIXTURE_VERSION__', str(FixtureHandler.worker_version))
            self.send_bytes(200, source.encode(), 'text/javascript; charset=utf-8')
        elif self.path == '/worker-version':
            self.send_bytes(200, json.dumps({'version': FixtureHandler.worker_version}).encode(), 'application/json')
        else:
            if self.path == WORKER_SCOPE:
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        origins = {'http://localhost:4174', 'http://127.0.0.1:4174'}
        if self.path != '/worker-version' or self.headers.get('Origin') not in origins:
            self.send_bytes(403, b'Fixture origin required', 'text/plain')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 64 or self.headers.get('Content-Type') != 'application/json':
                raise ValueError('Invalid request')
            version = json.loads(self.rfile.read(length))['version']
            if type(version) is not int or version not in (1, 2):
                raise ValueError('Invalid version')
        except (ValueError, KeyError, TypeError):
            self.send_bytes(400, b'Expected version 1 or 2', 'text/plain')
            return
        FixtureHandler.worker_version = version
        self.send_bytes(200, json.dumps({'version': version}).encode(), 'application/json')


if __name__ == '__main__':
    handler = partial(FixtureHandler, directory=str(ROOT))
    print('Disposable fixture: http://localhost:4174/sw-inspector-worker/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 4174), handler).serve_forever()
