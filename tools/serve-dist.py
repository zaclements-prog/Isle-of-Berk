# Tiny static file server for the built game (dist/), bound to localhost only.
#
# Used by serve-dist.ps1 instead of `python -m http.server` because that
# command's MIME guessing (SimpleHTTPRequestHandler.guess_type -> the
# mimetypes module, which on Windows can consult the registry) is not
# reliable on every machine. Measured on this machine (Python 3.10.6):
# .js came back as application/javascript (fine), but .webp came back as
# application/octet-stream instead of image/webp. guess_type() checks
# extensions_map before mimetypes.guess_type(), so overriding it here for
# .webp (and defensively for .js/.mjs, in case another machine's registry
# maps those to text/plain) is authoritative regardless of the registry.
#
# Usage: python serve-dist.py <port> <directory>
import http.server
import sys

port = int(sys.argv[1])
directory = sys.argv[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webp': 'image/webp',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)


# Bind to the IPv4 loopback address only -- never 0.0.0.0 -- so dist/ is not
# reachable from the LAN.
with http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler) as httpd:
    httpd.serve_forever()
