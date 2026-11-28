"""Check repeated mail notifications using only the adapter and Core's published receipts."""
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from mail_backfill import recover_inbox
from mail_push import database, fetch_junk_envelope, initialize, process_one, queue_notifications
from mail_subscription import manage, prepare


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

    def test_poll_failure_preserves_checkpoint_and_overlap_is_idempotent(self):
        start = datetime(2026, 11, 28, 2, 5, tzinfo=timezone.utc)
        first = start.replace(minute=10)
        second = start.replace(minute=15)
        existing = {"id": "first", "receivedDateTime": "2026-11-28T02:08:00Z"}
        new = {"id": "second", "receivedDateTime": "2026-11-28T02:12:00Z"}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "inbox.sqlite3"
            with closing(database(path)) as db:
                initialize(db)
                recover_inbox(db, lambda *_a, **_k: {"value": [existing]},
                              initial_since=start, until=first)

            with closing(database(path)) as db:
                before = db.execute("SELECT recovered_until FROM inbox_recovery").fetchone()[0]
                with self.assertRaises(OSError):
                    recover_inbox(db, Mock(side_effect=OSError("temporary outage")),
                                  initial_since=start, until=second)
                self.assertEqual(db.execute("SELECT recovered_until FROM inbox_recovery").fetchone()[0], before)
                recover_inbox(db, lambda *_a, **_k: {"value": [existing, new]},
                              initial_since=start, until=second)
                self.assertEqual([r[0] for r in db.execute("SELECT message_id FROM incoming ORDER BY message_id")],
                                 ["first", "second"])
                self.assertNotEqual(db.execute("SELECT recovered_until FROM inbox_recovery").fetchone()[0], before)

    def test_junk_uses_verified_folder_and_never_requests_message_content(self):
        message = dict(id="mid", changeKey="r1", internetMessageId="internet",
                       receivedDateTime="2026-11-28T02:15:00Z", isDraft=False)
        provider = Mock(side_effect=[message, {"value": [{"id": "mid", "changeKey": "r1"}]}])
        event = fetch_junk_envelope(provider, "owner@example.test", "mid")
        self.assertEqual(event["source"]["channel"], "junkemail")
        self.assertEqual(event["data"], {"outlook_junk_folder": True})
        fields = provider.call_args_list[0].kwargs["select"].split(",")
        self.assertNotIn("body", fields)
        self.assertNotIn("subject", fields)
        self.assertEqual(provider.call_args_list[1].kwargs["mailFolderId"], "junkemail")

    def test_calendar_reference_verifies_mailbox_without_profile_read(self):
        base = "https://example.test/vilar/hooks/outlook-calendar"
        anchor = dict(id="calendar-id", resource="/me/events", applicationId="app", creatorId="owner",
                      notificationUrl=base, expirationDateTime="2100-01-01T00:00:00Z")
        with tempfile.TemporaryDirectory() as directory:
            ref = Path(directory) / "calendar.json"
            ref.write_text('{"id":"calendar-id"}')
            def read(row):
                provider = Mock(return_value={"value":[row]})
                identity, match = prepare(provider, base+"?vilar_mail_pilot=1", "inbox",
                                          "/vilar/hooks/outlook-calendar", "app", "owner@example.test", ref)
                provider.assert_called_once_with("list")
                self.assertIsNone(match)
                return identity
            self.assertEqual(read(anchor)["creatorId"], "owner")
            for change in ({"id":"other"},{"creatorId":None},{"applicationId":"other"},
                           {"expirationDateTime":"2000-01-01T00:00:00Z"},{"resource":"mail"}):
                with self.assertRaises(ValueError):
                    read({**anchor, **change})

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
            rows.append(mail)
            with self.assertRaises(ValueError):
                run("subscribe")
            with self.assertRaises(ValueError):
                run("recover")
            count = len(calls)
            self.assertEqual(run("unsubscribe"), {"status": "no_owned_subscription"})
            self.assertEqual(len(calls), count)
            self.assertEqual(rows.pop(), mail)
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
            self.assertEqual(run("unsubscribe"), {"status": "no_owned_subscription"})
            with self.assertRaises(TimeoutError):
                run("subscribe")
            run("recover")
            rows.remove(mail)  # Simulate provider expiration of our recorded rule.
            self.assertEqual(run("unsubscribe")["status"], "removed")
            self.assertFalse(record.exists())
            self.assertEqual(sum(c[0] == "remove" for c in calls), 1)
            self.assertEqual(run("unsubscribe"), {"status": "no_owned_subscription"})


if __name__ == "__main__":
    unittest.main()
