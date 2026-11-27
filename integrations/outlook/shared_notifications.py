"""Use the existing calendar listener with the mail queue.

In calendar_notifications.py, import shared_callback from this module and supply
shared_callback(sys.modules[__name__], Path(os.environ["VILAR_MAIL_PUSH_DIR"]),
                lambda: os.environ["VILAR_MAIL_CLIENT_STATE"])
in place of Callback in the existing ThreadingHTTPServer constructor. Keep the
existing calendar workers, socket, port and route. The outlook integration and
its sources dependency must be on the listener's Python import path.
"""
from contextlib import closing
import hmac
import json
import sqlite3
from urllib.parse import parse_qs, urlsplit

import mail_push


def saved_id(path, *, calendar=False):
    try:
        value = path.read_text().strip()
    except FileNotFoundError:
        return None
    return json.loads(value)["id"] if calendar else value


def shared_callback(calendar, mail_dir, mail_secret):
    class SharedCallback(calendar.Callback):
        def do_POST(self):
            target = urlsplit(self.path)
            if target.path != calendar.ROUTE:
                return self.respond(404)
            query = parse_qs(target.query, keep_blank_values=True)
            if "validationToken" in query:
                tokens = query["validationToken"]
                if len(tokens) != 1 or not 0 < len(tokens[0]) <= 4096:
                    return self.respond(400)
                return self.respond(200, tokens[0].encode())

            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 262144:
                    return self.respond(400)
                notices = json.loads(self.rfile.read(size))["value"]
                if not isinstance(notices, list) or not 1 <= len(notices) <= 1000:
                    return self.respond(400)

                calendar_id = saved_id(calendar.STATE / "subscription.json", calendar=True)
                mail_id = saved_id(mail_dir / "subscription")
                if calendar_id and calendar_id == mail_id:
                    return self.respond(503)

                mail = []
                calendar_pending = False
                states = {}
                for note in notices:
                    if not isinstance(note, dict):
                        return self.respond(400)
                    sid = note.get("subscriptionId")
                    if not isinstance(sid, str) or not sid or sid not in (mail_id, calendar_id):
                        return self.respond(403)
                    if sid not in states:
                        states[sid] = mail_secret() if sid == mail_id else calendar.secret()
                    expected = states[sid]
                    if not expected:
                        return self.respond(503)
                    presented = note.get("clientState")
                    if not isinstance(presented, str) or not hmac.compare_digest(
                            presented.encode(), expected.encode()):
                        return self.respond(403)
                    if sid == mail_id:
                        mail.append(note)
                    elif note.get("changeType") in ("created", "updated", "deleted"):
                        calendar_pending = True
                    else:
                        return self.respond(400)

                if mail:
                    with closing(mail_push.database(mail_dir / "inbox.sqlite3")) as db:
                        mail_push.initialize(db)
                        mail_push.queue_notifications(db, {"value": mail}, mail_id, states[mail_id])
                if calendar_pending:
                    # A failed calendar enqueue after a mail commit is retryable:
                    # mail work is keyed by message ID and calendar uses a pending flag.
                    calendar.enqueue()
            except PermissionError:
                return self.respond(503)  # local filesystem permission failure
            except (OSError, sqlite3.Error):
                return self.respond(503)
            except (TypeError, ValueError, KeyError, AttributeError):
                return self.respond(400)
            return self.respond(202)

    return SharedCallback
