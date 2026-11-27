"""Check repeated mail notifications using only the adapter and Core's published receipts."""
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from mail_push import database, initialize, process_one, queue_notifications, remove_subscription


class MailPushContractTest(unittest.TestCase):
    def test_duplicate_notification_preserves_one_receipt(self):
        note = {
            "subscriptionId": "subscription",
            "clientState": "test-state",
            "changeType": "created",
            "resourceData": {"@odata.type": "#Microsoft.Graph.Message", "id": "message-1"},
        }
        event = {"source": {
            "provider": "mail", "account": "owner@example.test", "channel": "inbox",
            "object": "message-1", "revision": "r1",
        }, "data": {"text": "Test message"}}
        receipt = {"event_id": "evt-" + "a" * 32, "correlation_id": "correlation-1"}
        core = Mock()
        core.submit.return_value = (202, receipt)
        core.read.return_value = (200, {**receipt, "status": "received"})
        fetch = Mock(return_value=event)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "queue.sqlite3"
            with closing(database(path)) as db:
                initialize(db)
                queue_notifications(db, {"value": [note]}, "subscription", "test-state")
                self.assertTrue(process_one(db, fetch, core))
            with closing(database(path)) as db:
                queue_notifications(db, {"value": [note]}, "subscription", "test-state")
                self.assertFalse(process_one(db, fetch, core))
        fetch.assert_called_once_with("message-1")
        core.submit.assert_called_once()
        self.assertEqual(core.submit.call_args.args[0], event)
        self.assertTrue(core.submit.call_args.args[1])
        core.read.assert_called_once_with(receipt["event_id"])

    def test_remove_only_the_expected_mail_rule(self):
        callback = "https://example.test/callback"
        rule = {"id": "mail-id", "notificationUrl": callback,
                "resource": "/me/mailFolders('inbox')/messages", "changeType": "created"}
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "subscription"
            record.write_text("mail-id")
            provider = Mock()
            with self.assertRaises(ValueError):
                remove_subscription(provider, record, "other", callback)
            provider.assert_not_called()
            for changed in ({"resource": "/me/events"}, {"notificationUrl": "https://other.test/cb"},
                            {"id": "different-rule"}, {"changeType": "deleted"}):
                provider = Mock(return_value={**rule, **changed})
                with self.assertRaises(ValueError):
                    remove_subscription(provider, record, "mail-id", callback)
                provider.assert_called_once_with("inspect", subscriptionId="mail-id")
                self.assertTrue(record.exists())
            provider = Mock(side_effect=[rule, {}, rule])
            with self.assertRaises(RuntimeError):
                remove_subscription(provider, record, "mail-id", callback)
            self.assertTrue(record.exists())
            provider = Mock(return_value=None)
            remove_subscription(provider, record, "mail-id", callback)
            provider.assert_called_once_with("inspect", subscriptionId="mail-id")
            self.assertFalse(record.exists())


if __name__ == "__main__":
    unittest.main()
