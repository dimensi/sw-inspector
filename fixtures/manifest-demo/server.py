#!/usr/bin/env python3
"""Two disposable loopback origins for explicit Web App Manifest inspection."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
CASES = {'absent', 'valid', 'redirect', 'invalid-json', 'wrong-mime', 'slow', 'large', 'cors-denied', 'credentials', 'csp-connect', 'csp-manifest'}
ORIGINS = {'http://127.0.0.1:4187', 'http://127.0.0.1:4188'}
REQUESTS = []
LOCK = threading.Lock()


class FixtureHandler(BaseHTTPRequestHandler):
    def send(self, status, body=b'', content_type='application/json', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Aborting a bounded Inspector read is expected.

    def record(self):
        destination = self.headers.get('Sec-Fetch-Dest')
        category = 'browser-declarative' if destination == 'manifest' else 'fetch-style' if destination == 'empty' else 'unknown'
        cookie = self.headers.get('Cookie', '')
        row = {'port': self.server.server_port, 'path': self.path, 'destination': destination,
               'category': category, 'dummyCookiePresent': 'manifest-fixture=demo' in [item.strip() for item in cookie.split(';')]}
        with LOCK:
            REQUESTS.append(row)
            # Keep the disposable diagnostic report bounded as well.
            del REQUESTS[:-200]

    def do_POST(self):
        if self.headers.get('Origin') not in ORIGINS:
            self.send(403, b'{"error":"Fixture origin required"}')
        elif self.path == '/stats/reset':
            with LOCK:
                REQUESTS.clear()
            self.send(200, b'{"reset":true}')
        elif self.path == '/fake-cookie':
            self.send(200, b'{"dummyCookie":"manifest-fixture=demo"}', headers={'Set-Cookie': 'manifest-fixture=demo; Path=/; SameSite=Lax; HttpOnly'})
        else:
            self.send(404, b'{}')

    def do_GET(self):
        request = urlsplit(self.path)
        case = parse_qs(request.query).get('case', ['valid'])[0]
        if case not in CASES:
            case = 'valid'
        if request.path == '/stats':
            with LOCK:
                rows = list(REQUESTS)
            summary = {key: sum(row['category'] == key for row in rows) for key in ['browser-declarative', 'fetch-style', 'unknown']}
            self.send(200, json.dumps({'summary': summary, 'requests': rows, 'attribution': 'Sec-Fetch-Dest is a hint, not Inspector identity. Counts are HTTP hops; redirects may add a hop. Reports retain at most 200 requests.'}).encode())
            return
        if request.path == '/':
            cross = case in {'cors-denied', 'credentials', 'csp-connect', 'csp-manifest'}
            target = f'http://127.0.0.1:4188/manifest.webmanifest?case={case}' if cross else f'/manifest.webmanifest?case={case}'
            attribute = ' crossorigin="use-credentials"' if case == 'credentials' else ''
            link = '' if case == 'absent' else f'<link rel="alternate MANIFEST" href="{target}"{attribute}>'
            html = (ROOT / 'index.html').read_text().replace('<!-- MANIFEST_LINK -->', link).replace('<!-- CASE_NAME -->', case)
            headers = {}
            if case == 'csp-connect':
                headers['Content-Security-Policy'] = "connect-src 'self'; manifest-src http://127.0.0.1:4188"
            elif case == 'csp-manifest':
                headers['Content-Security-Policy'] = "connect-src 'self' http://127.0.0.1:4188; manifest-src 'none'"
            self.send(200, html.encode(), 'text/html; charset=utf-8', headers)
            return
        if request.path in {'/icons/not-loaded.svg', '/redirect/icons/not-loaded.svg'}:
            self.record()
            self.send(404, b'Icon bytes are not provided by this fixture', 'text/plain')
            return
        if request.path not in {'/manifest.webmanifest', '/redirect/deeper/final.webmanifest'}:
            self.send(404, b'Fixture resource not found', 'text/plain')
            return
        self.record()
        headers = {}
        if case != 'cors-denied' and self.server.server_port == 4188:
            origin = self.headers.get('Origin')
            if origin in ORIGINS:
                headers['Access-Control-Allow-Origin'] = origin
                headers['Vary'] = 'Origin'
                if case == 'credentials':
                    headers['Access-Control-Allow-Credentials'] = 'true'
        if case == 'redirect' and request.path == '/manifest.webmanifest':
            self.send(302, b'', headers={'Location': '/redirect/deeper/final.webmanifest?case=redirect'})
            return
        manifest = {'name': 'Manifest fixture ' + case, 'short_name': 'Fixture', 'start_url': './launch?from=' + case,
                    'scope': './', 'display': 'standalone', 'theme_color': '#145caa',
                    'icons': [{'src': '../icons/not-loaded.svg', 'sizes': '16x16', 'type': 'image/svg+xml'}, {'src': '../icons/not-loaded.svg', 'purpose': 'maskable'}]}
        body = json.dumps(manifest).encode()
        mime = 'text/plain' if case == 'wrong-mime' else 'application/manifest+json'
        if case == 'invalid-json':
            body = b'{broken JSON'
        elif case == 'large':
            body = b'x' * 262145
        elif case == 'slow':
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            try:
                self.wfile.write(body[:8])
                self.wfile.flush()
                time.sleep(9)
                self.wfile.write(body[8:])
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        self.send(200, body, mime, headers)


if __name__ == '__main__':
    servers = [ThreadingHTTPServer(('127.0.0.1', port), FixtureHandler) for port in (4187, 4188)]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    print('Manifest fixtures: http://127.0.0.1:4187/?case=valid and http://127.0.0.1:4188', flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        for server in servers:
            server.shutdown()
            server.server_close()
