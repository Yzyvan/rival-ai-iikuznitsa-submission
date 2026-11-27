"""Проверка публичного адаптера с синтетическими письмами без учётной записи."""
import unittest
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
