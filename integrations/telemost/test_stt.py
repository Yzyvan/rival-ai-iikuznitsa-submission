from __future__ import annotations

import array
import sys
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stt import GroqTranscriber, STTError


@contextmanager
def groq_server(status: int, body: bytes):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            self.rfile.read(length)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}/openai/v1/audio/transcriptions"
    finally:
        httpd.shutdown()
        thread.join()
        httpd.server_close()


class GroqTranscriberTest(unittest.TestCase):
    def test_http_status_is_separate_from_body(self):
        pcm = array.array("h", [10000] * 8000).tobytes()
        cases = [
            (429, b'{"error":{"message":"rate"}}', None, "429"),
            (503, b"upstream down", None, "503"),
            (200, b'{"error":{"message":"bad"}}', None, "error"),
            (200, b'{"text":""}', "", None),
            (200, '{"text":"привет"}'.encode("utf-8"), "привет", None),
        ]
        for status, body, expected, error_part in cases:
            with self.subTest(status=status, body=body):
                with groq_server(status, body) as url:
                    transcriber = GroqTranscriber("secret-token", base_url=url)
                    if error_part:
                        with self.assertRaises(STTError) as caught:
                            transcriber.transcribe(pcm)
                        self.assertIn(error_part, str(caught.exception))
                        self.assertNotIn("secret-token", str(caught.exception))
                    else:
                        self.assertEqual(transcriber.transcribe(pcm), expected)


if __name__ == "__main__":
    unittest.main()
