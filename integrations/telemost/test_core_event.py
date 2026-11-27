from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import core_event


MEETING = {
    "id": "m1",
    "profile": "demo-A",
    "revision": 3,
    "start": "2026-12-07T11:00:00+03:00",
    "link": "https://telemost.yandex.ru/j/room-1",
    "organizer_email": "ivan@example.com",
    "source_ref": "daily-01/20261208",
    "attendance": "both",
}
PROTOCOL = {
    "summary": "Обсудили запуск.",
    "decisions": [{"text": "Запуск 25 декабря", "source": "10:00:15"}],
    "tasks": [{"task": "Подготовить отчёт", "owner": "Мария", "deadline": "5 декабря", "source": "Мария, подготовь отчёт к 5 декабря"}],
    "events": [{"text": "Встреча по бюджету", "when": "8 декабря", "source": "10:00:30"}],
    "open_questions": [],
}


class FakeTransport:
    def __init__(self):
        self.sent = []
        self.reads = []

    def submit(self, event, key):
        self.sent.append((event, key))
        return 202, {"event_id": "evt-1", "status": "received"}

    def read(self, event_id):
        self.reads.append(event_id)
        return 200, {"event_id": event_id, "status": "processed"}


class CoreEventTest(unittest.TestCase):
    def test_event_shape(self):
        event, key = core_event.build_meeting_event(MEETING, PROTOCOL)
        self.assertEqual(key, "meeting/m1/3")
        self.assertEqual(event["source"]["provider"], "meeting")
        self.assertEqual(event["source"]["channel"], "telemost")
        self.assertEqual(event["source"]["object"], "room-1")
        self.assertEqual(event["source"]["thread"], "m1")
        self.assertEqual(event["source"]["revision"], "3")
        self.assertEqual(event["data"]["calendar_ref"], "daily-01/20261208")
        self.assertEqual(event["data"]["fragment_id"], "m1:3")
        self.assertTrue(event["data"]["recording_skipped"])
        self.assertIn("Мария", event["data"]["quote"])
        self.assertEqual(event["data"]["protocol"]["tasks"][0]["owner"], "Мария")

    def test_timecode_source_resolves_to_transcript_line(self):
        protocol = dict(PROTOCOL)
        protocol["tasks"] = [
            {"task": "Подготовить отчёт", "owner": "Мария", "deadline": "5 декабря", "source": "10:00:00"}
        ]
        event, _ = core_event.build_meeting_event(
            MEETING, protocol,
            "[10:00:00] [Иван] Мария, подготовь отчёт к пятнице, 5 декабря.\n",
        )
        self.assertIn("Мария, подготовь отчёт", event["data"]["quote"])
        self.assertNotEqual(event["data"]["quote"], "10:00:00")

    def test_dry_run_writes_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = core_event.submit_meeting_event(MEETING, PROTOCOL, tmp)
            self.assertEqual(result["mode"], "dry_run")
            rows = [json.loads(line) for line in Path(result["path"]).read_text().splitlines()]
            self.assertEqual(rows[-1]["key"], "meeting/m1/3")
            self.assertEqual(rows[-1]["event"]["source"]["object"], "room-1")

    def test_sent_mode_uses_idempotency_key_and_reads_receipt(self):
        fake = FakeTransport()
        result = core_event.submit_meeting_event(
            MEETING, PROTOCOL, "/tmp",
            base_url="https://core.example", token="token", transport=fake,
        )
        self.assertEqual(result["mode"], "sent")
        self.assertEqual(result["event_id"], "evt-1")
        self.assertEqual(result["receipt"]["status"], "processed")
        self.assertEqual(fake.sent[0][1], "meeting/m1/3")
        self.assertEqual(fake.reads, ["evt-1"])


if __name__ == "__main__":
    unittest.main()
