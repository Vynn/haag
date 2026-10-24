#!/usr/bin/env python3
"""
Local development server for Håg.

Serves the repository root on http://127.0.0.1:8117 so the test page in
tools/ can load the plugin from dist/ as ES modules.

- Listens on this machine only (127.0.0.1), never the network.
- Tells the browser never to cache, so every reload shows the latest code.
- Refuses to serve private/ (household data), .git/ and other dotfiles.

Standard library only. Usage (from anywhere):
    python3 tools/dev-server.py [port]
"""

import http.server
import pathlib
import sys

HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8117
ROOT = pathlib.Path(__file__).resolve().parent.parent  # repository root

# Top-level folders that must never be served.
BLOCKED = {"private"}


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _blocked(self):
        # Check the decoded, resolved file path (not the raw URL), so encoded
        # tricks like /%70rivate/ or /a/../private/ can't get around the rule.
        target = pathlib.Path(self.translate_path(self.path)).resolve()
        try:
            parts = target.relative_to(ROOT).parts
        except ValueError:
            return True  # outside the repository
        return bool(parts) and (parts[0] in BLOCKED or any(p.startswith(".") for p in parts))

    def do_GET(self):
        if self._blocked():
            self.send_error(403, "Not served")
            return
        super().do_GET()

    def do_HEAD(self):
        if self._blocked():
            self.send_error(403, "Not served")
            return
        super().do_HEAD()

    def end_headers(self):
        # No caching: edits show up on the next reload.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


# Make sure module and font files get the right content types.
DevHandler.extensions_map.update({
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml",
})

if __name__ == "__main__":
    with http.server.ThreadingHTTPServer((HOST, PORT), DevHandler) as server:
        print(f"Serving {ROOT} at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
        server.serve_forever()
