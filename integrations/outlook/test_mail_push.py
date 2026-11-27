"""Check repeated mail notifications using only the adapter and Core's published receipts."""
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from mail_push import database, initialize, process_one, queue_notifications
from mail_subscription import manage


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

    def test_subscription_recovery_and_precise_removal(self):
        callback = "https://example.test/vilar/hooks/outlook-calendar?vilar_mail_pilot=1"
        route = "/vilar/hooks/outlook-calendar"
        resource = "/me/mailFolders('inbox')/messages"
        calendar = dict(id="calendar", changeType="created,updated,deleted",
                        notificationUrl=callback.split("?")[0], resource="/me/events",
                        applicationId="app", creatorId="owner")
        mail = dict(id="mail-id", changeType="created", notificationUrl=callback,
                    resource=resource, applicationId="app", creatorId="owner")
        rows = [calendar]
        calls = []
        def provider(op, **args):
            calls.append((op, args))
            if op == "me":
                return {"id": "owner"}
            if op == "list":
                return {"value": rows}
            if op == "create":
                rows.append(mail)
                raise TimeoutError("reply lost")
            if op == "inspect":
                return next((r for r in rows if r["id"] == args["subscriptionId"]), None)
            if op == "remove":
                self.assertEqual(args, {"subscriptionId": "mail-id", "confirm": True})
                rows.remove(mail)
                return {}
            self.fail(op)
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "subscription"
            def run(command, expected=None):
                return manage(provider, record, command, expected, callback, "s" * 32, "owner@example.test",
                              None, 45, resource, route)
            with self.assertRaises(TimeoutError):
                run("subscribe")
            self.assertFalse(record.exists())
            rows.pop()
            with self.assertRaises(ValueError):
                run("subscribe")
            rows.append(mail)
            self.assertEqual(run("subscribe")["id"], "mail-id")
            self.assertEqual(sum(c[0] == "create" for c in calls), 1)
            record.unlink()
            for key, value in (("creatorId", "other"), ("applicationId", "foreign"),
                               ("resource", "/me/events"), ("changeType", "deleted")):
                rows[-1] = {**mail, key: value}
                with self.assertRaises(ValueError):
                    run("recover")
            rows[-1] = mail
            rows.append({**mail, "id":"two"})
            with self.assertRaises(ValueError):
                run("unsubscribe")
            rows.pop()
            self.assertEqual(run("recover")["id"], record.read_text())
            with self.assertRaises(ValueError):
                run("unsubscribe","calendar")
            record.unlink()
            self.assertEqual(run("unsubscribe")["status"], "removed")
            self.assertEqual(rows, [calendar])
            self.assertFalse(record.exists())
            self.assertEqual(sum(c[0] == "remove" for c in calls), 1)


if __name__ == "__main__":
    unittest.main()
