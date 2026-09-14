"""A tiny standalone HTTP server that serves tokens.py's fake JWKS document, standing
in for Keycloak's real `GET {keycloak_internal_url}/protocol/openid-connect/certs` (see
app/core/auth.py's _get_jwks). This has to be a real, separately-reachable HTTP
process rather than an in-test monkeypatch because the API server under test
(uvicorn, started by CI as its own OS process -- see .github/workflows/test.yml) is not
the same Python process pytest runs in and does its own independent JWKS fetch.

Single-purpose: every GET request gets the same JWKS JSON body, regardless of path, so
it works whatever KEYCLOAK_INTERNAL_URL is pointed at it.

Usage (as a standalone CI step, run from services/api so tests/ resolves):
    python tests/hermetic/jwks_server.py --port 9999
    # or, imported from a fixture (tests/ is already on sys.path under pytest):
    from hermetic.jwks_server import serve_in_background
    server = serve_in_background(port=9999)
    ...
    server.shutdown()
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Allow `python tests/hermetic/jwks_server.py` (run as a plain script, no package
# context) to find its sibling tokens.py, while also working when imported normally
# as `hermetic.jwks_server` (tests/ already on sys.path under pytest -- see
# tests/conftest.py).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tokens import jwks_document  # noqa: E402


class _JWKSHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (stdlib method name)
        body = json.dumps(jwks_document()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # Quiet by default -- this fires on every JWKS fetch (every _get_jwks cache
        # miss, roughly once per _JWKS_TTL_SECONDS), which would otherwise spam CI logs.
        pass


def serve_in_background(port: int, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), _JWKSHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), _JWKSHandler)
    print(f"Hermetic JWKS server listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
