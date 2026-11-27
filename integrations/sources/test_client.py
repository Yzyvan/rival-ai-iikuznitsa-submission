import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from client import SourceClient


class Handler(BaseHTTPRequestHandler):
    seen = []

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length))
        Handler.seen.append((self.path, body, self.headers.get("Idempotency-Key")))
        self._reply(202, {"event_id": "evt-1", "status": "received"})

    def do_GET(self):
        self._reply(200, {"event_id": "evt-1", "status": "processed"})

    def log_message(self, *args):
        pass


class SourceClientTest(unittest.TestCase):
    def test_submit_and_read(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = SourceClient(f"http://127.0.0.1:{server.server_address[1]}", "test-token")
            status, payload = client.submit({"source": {"provider": "meeting"}}, "meeting/m1/1")
            self.assertEqual(status, 202)
            self.assertEqual(payload["event_id"], "evt-1")
            self.assertEqual(Handler.seen[-1][2], "meeting/m1/1")
            status, receipt = client.read("evt-1")
            self.assertEqual(status, 200)
            self.assertEqual(receipt["status"], "processed")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
