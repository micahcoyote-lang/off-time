#!/usr/bin/env python3
"""Tiny no-cache static server for Off Time development.

Run it instead of `python3 -m http.server` so that edits to JS/CSS/data files
always take effect on a normal browser refresh (no stale caching).

    python3 serve.py          # serves this folder on http://localhost:8000
    python3 serve.py 8124     # custom port
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Off Time dev server (no-cache) running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
