#!/usr/bin/env python3
"""Dev server that refuses to be cached.

`python3 -m http.server` sends Last-Modified and no Cache-Control, so browsers
apply heuristic caching to ES modules. The effect during development is worse
than slow: you reload, you see old code, and you debug a bug you already fixed.
Twice in one session that cost more time than writing this file.
"""

import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):        # one line per request is enough
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8290
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCache, directory=root)
    with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'Gzowo Builders → http://localhost:{port}  (bez cache)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
