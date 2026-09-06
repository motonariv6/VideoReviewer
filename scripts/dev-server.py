#!/usr/bin/env python3
"""
VideoReviewer Development HTTP Server
Serves static assets with explicit no-cache headers to prevent stale module caching
in Google Chrome and modern browsers during ES module development.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import sys

# VideoReviewer root directory (parent directory of scripts/)
ROOT_DIR = Path(__file__).resolve().parent.parent


class NoCacheDevHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with no-cache headers for all static responses."""

    def __init__(self, *args, **kwargs):
        # Always serve from VideoReviewer root directory regardless of current working directory
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        # Prevent stale ES module cache in modern browsers during development
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Timestamped request logging
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")


def run(host="127.0.0.1", port=8000):
    server_address = (host, port)
    httpd = HTTPServer(server_address, NoCacheDevHandler)
    print("=" * 60)
    print(" VideoReviewer Development Server")
    print(f" URL:             http://localhost:{port}/")
    print(f" Document Root:   {ROOT_DIR}")
    print(" Cache-Control:   no-cache, no-store, must-revalidate")
    print("=" * 60)
    print("Press Ctrl+C to stop the server.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping development server...")
        httpd.server_close()
        print("Server stopped.")


if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Usage: python3 {sys.argv[0]} [port]")
            sys.exit(1)
    run(port=port)
