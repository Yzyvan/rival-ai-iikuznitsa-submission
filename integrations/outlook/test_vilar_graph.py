"""Проверка публичного адаптера с синтетическими письмами без учётной записи."""
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import httpx

from vilar_graph import GraphError, Outlook


class MailTest(unittest.TestCase):
    def test_inbox_and_thread(self):
        calls = []
        def exchange(request):
            calls.append(request)
            message = {"id": "m1", "conversationId": "thread'1", "subject": "Встреча"}
            if request.url.path.endswith("/inbox/messages"):
                return httpx.Response(200, json={"value": [message]})
            if "$skiptoken" in request.url.params:
                return httpx.Response(200, json={"value": [message | {"id": "m2"}]})
            return httpx.Response(200, json={"value": [message],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=two"})
        with httpx.Client(transport=httpx.MockTransport(exchange)) as http:
            outlook = Outlook(http, "test-only")
            mail = outlook.latest()
            thread = outlook.thread(mail[0]["conversationId"])
        self.assertEqual([m["id"] for m in thread], ["m1", "m2"])
        self.assertEqual(calls[1].url.params["$filter"], "conversationId eq 'thread''1'")
        self.assertEqual(calls[0].url.params["$top"], "10")

    def test_unexpected_page_host_is_rejected_before_request(self):
        calls = []
        def exchange(request):
            calls.append(request)
            return httpx.Response(200, json={"value": [], "@odata.nextLink": "https://example.org/other"})
        with httpx.Client(transport=httpx.MockTransport(exchange)) as http:
            with self.assertRaises(GraphError):
                Outlook(http, "test-only").thread("id")
        self.assertEqual(len(calls), 1)


class CalendarTest(unittest.TestCase):
    def test_repeated_hour_and_events_crossing_day_boundaries(self):
        def event(start, end, *, show_as="busy", cancelled=False):
            return {"start": {"dateTime": start}, "end": {"dateTime": end},
                    "showAs": show_as, "isCancelled": cancelled}

        # Berlin clocks go back at 01:00 UTC; the local day spans 25 hours.
        events = [
            event("2026-10-25T22:00:00", "2026-10-26T02:00:00"),
            event("2026-10-25T00:20:00", "2026-10-25T01:40:00"),
            event("2026-10-24T20:00:00", "2026-10-24T23:00:00"),
            event("2026-10-25T08:00:00", "2026-10-25T09:00:00", cancelled=True),
            event("2026-10-25T10:00:00", "2026-10-25T11:00:00", show_as="free"),
        ]

        def exchange(request):
            self.assertEqual(request.url.path, "/v1.0/me/calendarView")
            self.assertEqual(request.url.params["startDateTime"], "2026-10-25T00:00:00+02:00")
            self.assertEqual(request.url.params["endDateTime"], "2026-10-26T00:00:00+01:00")
            return httpx.Response(200, json={"value": events})

        with httpx.Client(transport=httpx.MockTransport(exchange)) as http:
            result = Outlook(http, "fixture").tomorrow(
                ZoneInfo("Europe/Berlin"), datetime(2026, 10, 24, 21, tzinfo=timezone.utc))
        self.assertEqual(result["free_windows_utc"], [
            ["2026-10-24T23:00:00+00:00", "2026-10-25T00:20:00+00:00"],
            ["2026-10-25T01:40:00+00:00", "2026-10-25T22:00:00+00:00"],
        ])

    def test_incomplete_calendar_does_not_offer_free_slots(self):
        continuation = "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=page2"
        calls = []

        def exchange(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(200, json={"value": [], "@odata.nextLink": continuation})
            return httpx.Response(429, headers={"Retry-After": "15"})

        with httpx.Client(transport=httpx.MockTransport(exchange)) as http:
            with self.assertRaises(GraphError) as failure:
                Outlook(http, "fixture").tomorrow(ZoneInfo("UTC"))
        self.assertEqual(len(calls), 2)
        self.assertEqual(str(calls[1].url), continuation)
        self.assertEqual((failure.exception.status, failure.exception.retry_after), (429, "15"))
