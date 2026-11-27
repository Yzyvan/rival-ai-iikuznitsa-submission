"""Offline contracts for the meeting provider, invitation links and speech services."""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import create_meeting
import find_link
import stt


class MeetingConnections(unittest.TestCase):
    def test_create_meeting_sends_options_and_returns_join_url(self):
        link = "https://telemost.yandex.ru/j/fixture"

        def provider(argv, **kwargs):
            self.assertEqual(argv[-1], "https://cloud-api.yandex.net/v1/telemost-api/conferences")
            config = Path(argv[argv.index("-K") + 1])
            self.assertIn("Authorization: OAuth fixture-token", config.read_text())
            payload = Path(argv[argv.index("-d") + 1].removeprefix("@"))
            self.assertEqual(
                json.loads(payload.read_text()),
                {
                    "waiting_room_level": "ORGANIZATION",
                    "is_auto_summarization_enabled": True,
                },
            )
            return subprocess.CompletedProcess(argv, 0, json.dumps({"join_url": link}), "")

        with patch.object(create_meeting.subprocess, "run", side_effect=provider) as call:
            meeting = create_meeting.create_meeting("fixture-token", "ORGANIZATION", True)
        call.assert_called_once()
        self.assertEqual(meeting["join_url"], link)

    def test_meeting_provider_denial_has_no_join_url(self):
        denied = subprocess.CompletedProcess(["curl"], 0, '{"error":"Forbidden"}', "")
        with (
            patch.object(create_meeting.subprocess, "run", return_value=denied),
            self.assertRaisesRegex(RuntimeError, "Forbidden"),
        ):
            create_meeting.create_meeting("fixture-token")

    def test_outlook_reader_scopes_request_and_deduplicates_links(self):
        first = "https://telemost.yandex.ru/j/one"
        second = "https://telemost.yandex.ru/j/two"
        credentials = {
            "VILAR_OUTLOOK_ACCOUNT": "test@example.invalid",
            "C01_OUTLOOK_USER": "fixture",
            "C01_OUTLOOK_HOME": "/fixture",
            "C01_OUTLOOK_WRAPPER": "/fixture/reader",
        }
        output = subprocess.CompletedProcess([], 0, f"{first}\n{second}\n{first}", "")
        with patch.dict(os.environ, credentials, clear=True):
            with patch.object(find_link.subprocess, "run", return_value=output) as reader:
                self.assertEqual(find_link.find_in_outlook(), [first, second])
            argv = reader.call_args.args[0]
            self.assertEqual(
                argv[:-4],
                [
                    "sudo",
                    "-n",
                    "-u",
                    "fixture",
                    "env",
                    "HOME=/fixture",
                    "VILAR_OUTLOOK_ACCOUNT=test@example.invalid",
                    "/fixture/reader",
                    "read",
                ],
            )
            failed = subprocess.CompletedProcess([], 1, first, "reader unavailable")
            with (
                patch.object(find_link.subprocess, "run", return_value=failed),
                self.assertRaisesRegex(RuntimeError, "reader unavailable"),
            ):
                find_link.find_in_outlook()

    def test_folded_calendar_invitation(self):
        with tempfile.TemporaryDirectory() as tmp:
            invitation = Path(tmp) / "invite.ics"
            invitation.write_bytes(
                b"BEGIN:VEVENT\r\nLOCATION:https://telemost.yandex.ru/j/mee\r\n"
                b" ting-123\r\nEND:VEVENT\r\n"
            )
            self.assertEqual(
                find_link.find_in_ics(invitation),
                ["https://telemost.yandex.ru/j/meeting-123"],
            )

    def test_approved_tasks_export_only_valid_deadlines_to_the_calendar(self):
        tasks = [
            {
                "task": "Сверить цифры, единицы",
                "owner": "Анна",
                "deadline": "2028-02-29",
            },
            {"task": "Согласовать отчёт", "deadline": None},
            {"task": "Уточнить дату", "deadline": "2027-02-29"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "protocol.approved.json"
            source.write_text(json.dumps({"approved_by": "reviewer", "tasks": tasks}))
            command = [
                sys.executable,
                str(Path(__file__).with_name("tasks.py")),
                "--protocol",
                str(source),
                "--out",
                str(root),
            ]
            subprocess.run(command, check=True, capture_output=True, timeout=5)
            self.assertEqual(json.loads((root / "tasks.json").read_text()), tasks)
            calendar = (root / "calendar.ics").read_text().splitlines()
            self.assertEqual(calendar.count("BEGIN:VEVENT"), 1)
            self.assertIn("DTSTART;VALUE=DATE:20280229", calendar)
            self.assertIn(r"SUMMARY:Поручение: Сверить цифры\, единицы", calendar)


class SpeechConnections(unittest.TestCase):
    def test_speechkit_receives_raw_pcm_with_folder_and_language(self):
        pcm = b"\x01\x00" * 160
        with patch.object(
            stt.urllib.request,
            "urlopen",
            return_value=io.BytesIO(b'{"result":"  speech  "}'),
        ) as call:
            result = stt.YandexTranscriber("fixture-key", "folder-1").transcribe(pcm)
        self.assertEqual(result, "speech")
        request = call.call_args.args[0]
        endpoint = urlsplit(request.full_url)
        self.assertEqual(
            (request.method, endpoint.netloc, endpoint.path),
            ("POST", "stt.api.cloud.yandex.net", "/speech/v1/stt:recognize"),
        )
        self.assertEqual(
            parse_qs(endpoint.query),
            {
                "folderId": ["folder-1"],
                "lang": ["ru-RU"],
                "sampleRateHertz": ["16000"],
                "format": ["lpcm"],
            },
        )
        self.assertEqual(request.get_header("Authorization"), "Api-Key fixture-key")
        self.assertEqual(request.data, pcm)

    def test_groq_receives_mono_wav_and_returns_text(self):
        pcm = b"\xff\x00" * 160

        def provider(argv, **kwargs):
            self.assertEqual(argv[-1], "https://api.groq.com/openai/v1/audio/transcriptions")
            self.assertIn("language=ru", argv)
            self.assertIn("model=whisper-large-v3-turbo", argv)
            (part,) = [arg for arg in argv if arg.startswith("file=@")]
            with wave.open(part.removeprefix("file=@").removesuffix(";type=audio/wav")) as wav:
                self.assertEqual(
                    (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()),
                    (16000, 1, 2),
                )
                self.assertEqual(wav.readframes(wav.getnframes()), pcm)
            return subprocess.CompletedProcess(argv, 0, '{"text":" speech "}\nHTTP_STATUS:200', "")

        with patch.object(stt.subprocess, "run", side_effect=provider):
            self.assertEqual(stt.GroqTranscriber("fixture-key").transcribe(pcm), "speech")

    def test_groq_rate_limit_is_reported_as_transcription_failure(self):
        class RateLimited(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":{"code":"rate_limit_exceeded"}}')

            def log_message(self, *_):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), RateLimited) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            run_curl = subprocess.run

            def send_to_fixture(argv, **kwargs):
                self.assertEqual(argv[-1], "https://api.groq.com/openai/v1/audio/transcriptions")
                url = f"http://127.0.0.1:{server.server_port}/openai/v1/audio/transcriptions"
                return run_curl([*argv[:-1], "--noproxy", "*", url], **kwargs)

            try:
                with (
                    patch.object(stt.subprocess, "run", side_effect=send_to_fixture),
                    self.assertRaises(stt.STTError),
                ):
                    stt.GroqTranscriber("fixture-key").transcribe(b"\x01\x00" * 160)
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()
