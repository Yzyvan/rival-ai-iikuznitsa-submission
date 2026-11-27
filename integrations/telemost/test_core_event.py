from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
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


class LostResponseTransport(FakeTransport):
    def submit(self, event, key):
        self.sent.append((event, key))
        if len(self.sent) == 1:
            raise TimeoutError("response lost")
        return 202, {"event_id": "evt-1", "status": "received"}


class CoreEventTest(unittest.TestCase):
    def test_event_shape(self):
        event, key = core_event.build_meeting_event(MEETING, PROTOCOL)
        self.assertEqual(key, "meeting/m1/3")
        self.assertEqual(event["source"]["provider"], "meeting")
        self.assertEqual(event["source"]["channel"], "telemost")
        self.assertEqual(event["source"]["object"], "room-1")
        self.assertEqual(event["source"]["thread"], "m1")
        self.assertEqual(event["source"]["revision"], "3")
        self.assertNotIn("received_at", event["source"])
        self.assertEqual(set(event["source"]), {
            "provider", "account", "channel", "object", "revision", "thread",
            "reply_to", "actor_external", "occurred_at", "change",
        })
        self.assertEqual(event["data"]["calendar_ref"], "daily-01/20261208")
        self.assertEqual(event["data"]["fragment_id"], "m1:3")
        self.assertTrue(event["data"]["recording_skipped"])
        self.assertEqual(event["data"]["gaps"], [])
        self.assertTrue(event["data"]["transcript_complete"])
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

    def test_gaps_are_passed_to_core(self):
        gaps = [{"track": "mix", "speaker": "Иван", "start": 10.0, "end": 20.0, "reason": "429"}]
        event, _ = core_event.build_meeting_event(MEETING, PROTOCOL, gaps=gaps)
        self.assertEqual(event["data"]["gaps"], gaps)
        self.assertFalse(event["data"]["transcript_complete"])

    def test_retry_after_restart_sends_stored_event(self):
        fake = LostResponseTransport()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(TimeoutError):
                core_event.submit_meeting_event(
                    MEETING, PROTOCOL, tmp,
                    base_url="https://core.example", token="token",
                    transport=fake, transcript_text="[10:00:00] [Иван] Начали.\n",
                )
            result = core_event.retry_core_outbox(
                tmp, "https://core.example", "token",
                transport=fake, now=time.time() + 1000,
            )
            records = list((Path(tmp) / "core_outbox").glob("*.json"))
            record = json.loads(records[0].read_text(encoding="utf-8"))
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["pending"], 0)
        self.assertEqual(len(fake.sent), 2)
        self.assertEqual(fake.sent[0], fake.sent[1])
        self.assertEqual(record["event_id"], "evt-1")

    def test_naive_start_gets_meeting_timezone(self):
        meeting = dict(MEETING)
        meeting["start"] = "2026-12-07T11:00:00"
        meeting["timezone"] = "Europe/Moscow"
        event, _ = core_event.build_meeting_event(meeting, PROTOCOL)
        self.assertTrue(event["source"]["occurred_at"].endswith("+03:00"))

    def test_transcript_is_passed_to_core(self):
        event, _ = core_event.build_meeting_event(
            MEETING, PROTOCOL, "[10:00:00] [Иван] Начали.\n"
        )
        self.assertTrue(event["data"]["transcript"].startswith("[10:00:00]"))

    def test_dry_run_writes_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = core_event.submit_meeting_event(MEETING, PROTOCOL, tmp)
            self.assertEqual(result["mode"], "dry_run")
            rows = [json.loads(line) for line in Path(result["path"]).read_text().splitlines()]
            self.assertEqual(rows[-1]["key"], "meeting/m1/3")
            self.assertEqual(rows[-1]["event"]["source"]["object"], "room-1")

    def test_sent_mode_uses_idempotency_key_and_reads_receipt(self):
        fake = FakeTransport()
        with tempfile.TemporaryDirectory() as tmp:
            result = core_event.submit_meeting_event(
                MEETING, PROTOCOL, tmp,
                base_url="https://core.example", token="token", transport=fake,
            )
        self.assertEqual(result["mode"], "sent")
        self.assertEqual(result["event_id"], "evt-1")
        self.assertEqual(result["receipt"]["status"], "processed")
        self.assertEqual(fake.sent[0][1], "meeting/m1/3")
        self.assertEqual(fake.reads, ["evt-1"])

    def test_lost_response_retry_uses_stored_event(self):
        fake = LostResponseTransport()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(TimeoutError):
                core_event.submit_meeting_event(
                    MEETING, PROTOCOL, tmp,
                    base_url="https://core.example", token="token",
                    transport=fake, transcript_text="[10:00:00] [Иван] Начали.\n",
                )
            result = core_event.submit_meeting_event(
                MEETING, PROTOCOL, tmp,
                base_url="https://core.example", token="token",
                transport=fake, transcript_text="[10:00:00] [Иван] Начали.\n",
            )
        self.assertEqual(len(fake.sent), 2)
        self.assertEqual(fake.sent[0], fake.sent[1])
        self.assertEqual(result["event_id"], "evt-1")

    def test_empty_start_retry_keeps_first_body(self):
        original_now = core_event._now
        clock = ["2026-12-07T10:00:00+00:00"]
        core_event._now = lambda: clock[0]
        fake = FakeTransport()
        meeting = dict(MEETING)
        meeting["start"] = ""
        try:
            with tempfile.TemporaryDirectory() as tmp:
                core_event.submit_meeting_event(
                    meeting, PROTOCOL, tmp,
                    base_url="https://core.example", token="token", transport=fake,
                )
                clock[0] = "2026-12-07T11:00:00+00:00"
                core_event.submit_meeting_event(
                    meeting, PROTOCOL, tmp,
                    base_url="https://core.example", token="token", transport=fake,
                )
        finally:
            core_event._now = original_now
        self.assertEqual(fake.sent[0], fake.sent[1])

    def test_changed_transcript_same_revision_conflicts(self):
        fake = FakeTransport()
        with tempfile.TemporaryDirectory() as tmp:
            core_event.submit_meeting_event(
                MEETING, PROTOCOL, tmp,
                base_url="https://core.example", token="token",
                transport=fake, transcript_text="Первый транскрипт",
            )
            with self.assertRaises(core_event.CoreEventConflict):
                core_event.submit_meeting_event(
                    MEETING, PROTOCOL, tmp,
                    base_url="https://core.example", token="token",
                    transport=fake, transcript_text="Другой транскрипт",
                )
        self.assertEqual(len(fake.sent), 1)

    def test_new_revision_gets_new_event(self):
        fake = FakeTransport()
        meeting = dict(MEETING)
        meeting["revision"] = 4
        with tempfile.TemporaryDirectory() as tmp:
            core_event.submit_meeting_event(
                MEETING, PROTOCOL, tmp,
                base_url="https://core.example", token="token", transport=fake,
            )
            core_event.submit_meeting_event(
                meeting, PROTOCOL, tmp,
                base_url="https://core.example", token="token", transport=fake,
            )
            files = list((Path(tmp) / "core_outbox").glob("*.json"))
        self.assertEqual(len(files), 2)
        self.assertEqual(fake.sent[0][1], "meeting/m1/3")
        self.assertEqual(fake.sent[1][1], "meeting/m1/4")

    def test_concurrent_first_attempts_share_one_event(self):
        fake = FakeTransport()
        errors = []

        def run():
            try:
                core_event.submit_meeting_event(
                    MEETING, PROTOCOL, tmp,
                    base_url="https://core.example", token="token", transport=fake,
                )
            except Exception as error:
                errors.append(error)

        with tempfile.TemporaryDirectory() as tmp:
            threads = [threading.Thread(target=run) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(fake.sent), 2)
        self.assertEqual(fake.sent[0], fake.sent[1])


if __name__ == "__main__":
    unittest.main()
