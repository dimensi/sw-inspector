from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

project = Path(__file__).resolve().parents[2]
output = project / '.output/safari-mv3'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(output), **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/preview.html':
            body = (output / 'panel.html').read_text().replace('<head>', '<head><script src="/fixture.js"></script>').encode()
            content_type = 'text/html'
        elif path == '/fixture.js':
            body = (project / '.impeccable/preview/fixture.js').read_bytes()
            content_type = 'text/javascript'
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(('127.0.0.1', 4186), Handler).serve_forever()
