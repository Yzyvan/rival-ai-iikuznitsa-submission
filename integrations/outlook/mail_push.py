"""Single-mailbox Graph Inbox creation listener. Run behind the staging TLS proxy."""
import argparse
import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlsplit


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sources"))
from client import SourceClient

CALLBACK = "/vilar/hooks/outlook-calendar"
RESOURCE = "/me/mailFolders('inbox')/messages"


def database(path):
    db = sqlite3.connect(path, timeout=2)
    db.row_factory = sqlite3.Row
    return db


def initialize(db):
    with db:
        db.execute("""CREATE TABLE IF NOT EXISTS incoming(
            message_id TEXT PRIMARY KEY, deliveries INTEGER NOT NULL DEFAULT 1,
            queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, envelope TEXT,
            receipt TEXT, attempts INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT)""")


def queue_notifications(db, payload, subscription, state):
    notes = payload["value"]
    if not isinstance(notes, list) or not 1 <= len(notes) <= 1000:
        raise ValueError("batch")
    with db:
        for note in notes:
            if (note.get("subscriptionId") != subscription or
                    not hmac.compare_digest(str(note.get("clientState", "")).encode(), state.encode())):
                raise PermissionError("unauthorized notification")
            data = note["resourceData"]
            mid = data["id"]
            if (note["changeType"] != "created" or data.get("@odata.type", "").lower() != "#microsoft.graph.message"
                    or not isinstance(mid, str) or not re.fullmatch(r"[A-Za-z0-9_+=/-]{1,1024}", mid)):
                raise ValueError("invalid message notification")
            db.execute("""INSERT INTO incoming(message_id) VALUES (?)
                ON CONFLICT(message_id) DO UPDATE SET deliveries=deliveries+1""", (mid,))


def receiver(path, subscription, state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            target = urlsplit(self.path)
            if target.path != CALLBACK:
                self.send_error(404)
                return
            validation = parse_qs(target.query).get("validationToken")
            if validation:
                body = validation[0].encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 * 1024:
                    raise ValueError("length")
                with closing(database(path)) as db:
                    queue_notifications(db, json.loads(self.rfile.read(length)), subscription(), state)
            except PermissionError:
                self.send_error(403)
                return
            except (TypeError, AttributeError, ValueError, KeyError):
                self.send_error(400)
                return
            except (OSError, sqlite3.Error):
                self.send_error(503)
                return
            self.send_response(202)
            self.end_headers()

    return Handler


def graph(operation, **args):
    account = os.environ["VILAR_OUTLOOK_ACCOUNT"].lower()
    env = {k: os.environ[k] for k in ("PATH", "HOME", "MS365_MCP_CLIENT_ID") if k in os.environ}
    env.update(XDG_CONFIG_HOME=str(Path.home()/".config/vilar/c01-outlook"/account),
               MS365_MCP_EXPECTED_USERNAME=account, MS365_MCP_TENANT_ID="consumers",
               MS365_MCP_USE_KEYTAR="false", MS365_MCP_BODY_FORMAT="text",
               MS365_MCP_OUTPUT_FORMAT="json", LOG_LEVEL="error")
    reply = subprocess.run(["node", str(Path(__file__).with_name("mail_graph.mjs"))],
                           input=json.dumps({"operation": operation, "args": args}),
                           text=True, capture_output=True, env=env, timeout=45, check=True)
    return json.loads(reply.stdout)


def fetch_envelope(provider, account, mid):
    from import_message import FIELDS, NATIVE_BODY, event_for, required, resolve_parent

    message = provider("message", messageId=mid, select=FIELDS + ",internetMessageId",
                       expand=f"attachments($select=id),singleValueExtendedProperties($filter=id eq '{NATIVE_BODY}')")
    if message["id"] != mid:
        raise ValueError("unexpected Graph message")
    revision = required(message["changeKey"])
    internet_id = required(message["internetMessageId"])
    escaped = internet_id.replace("'", "''")
    inbox = provider("folderMessages", mailFolderId="inbox", top=2,
                     filter=f"internetMessageId eq '{escaped}'", select="id,changeKey")
    if (inbox.get("@odata.nextLink") or len(inbox["value"]) != 1
            or inbox["value"][0]["id"] != mid or inbox["value"][0]["changeKey"] != revision):
        raise ValueError("Inbox revision could not be verified")

    async def parent_lookup(_tool, args):
        return provider("folderMessages", **args)

    try:
        parent = asyncio.run(resolve_parent(parent_lookup, message, internet_id))
        return event_for(message, account, mid, revision, "create", parent)
    except (ValueError, KeyError, TypeError, AttributeError, IndexError):
        # A verified Inbox revision with unsupported material must stay in quarantine.
        source = dict(provider="mail", account=account, channel="inbox", object=mid,
                      revision=revision, change="create", thread=message.get("conversationId"),
                      actor_external=(message.get("from") or {}).get("emailAddress", {}).get("address"),
                      occurred_at=message.get("receivedDateTime"))
        return {"source": source, "original_ref": mid, "data": message}


def process_one(db, fetch, core):
    row = db.execute("""SELECT * FROM incoming WHERE receipt IS NULL AND retry_at<=unixepoch()
                        ORDER BY queued_at, rowid LIMIT 1""").fetchone()
    if row is None:
        return False
    mid = row["message_id"]
    try:
        if not row["envelope"]:
            raw = json.dumps(fetch(mid), ensure_ascii=False, separators=(",", ":"))
            with db:
                db.execute("UPDATE incoming SET envelope=? WHERE message_id=? AND envelope IS NULL", (raw, mid))
        event = json.loads(db.execute("SELECT envelope FROM incoming WHERE message_id=?", (mid,)).fetchone()[0])
        source = event["source"]
        identity = [source[k] for k in ("provider", "account", "channel", "object", "revision")]
        key = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
        status, accepted = core.submit(event, key)
        eid = accepted["event_id"]
        if status != 202 or not re.fullmatch(r"evt-[0-9a-f]{32}", eid):
            raise ValueError("invalid Core acceptance")
        status, result = core.read(eid)
        if (status != 200 or result["event_id"] != eid or result["correlation_id"] != accepted["correlation_id"]
                or result["status"] not in {"received", "admitted", "quarantined"}):
            raise ValueError("invalid Core receipt")
        with db:
            db.execute("UPDATE incoming SET receipt=?,last_error=NULL WHERE message_id=?", (eid, mid))
    except Exception as exc:
        # Retain the frozen revision across a lost response or a service restart.
        delay = min(300, 2 ** min(row["attempts"] + 1, 9))
        with db:
            db.execute("""UPDATE incoming SET attempts=attempts+1,retry_at=unixepoch()+?,last_error=?
                          WHERE message_id=? AND receipt IS NULL""", (delay, type(exc).__name__, mid))
    return True


def remove_subscription(provider, subscription, expected, callback):
    if not expected or expected != subscription.read_text().strip():
        raise ValueError("requested subscription differs from the recorded mail subscription")
    args = {"subscriptionId": expected}
    current = provider("inspect", **args)
    if current is not None:
        if (current.get("id") != expected or current.get("notificationUrl") != callback
                or current.get("resource", "").strip("/").lower() != RESOURCE.strip("/").lower()
                or current.get("changeType") != "created"):
            raise ValueError("subscription does not match the temporary mail input")
        provider("remove", **args, confirm=True)
        if provider("inspect", **args) is not None:
            raise RuntimeError("provider has not confirmed removal")
    subscription.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["serve", "work", "status", "subscribe", "renew", "unsubscribe"])
    parser.add_argument("--expected-id", help="exact recorded mail subscription to remove")
    args = parser.parse_args()
    os.umask(0o077)
    directory = Path(os.environ["VILAR_MAIL_PUSH_DIR"])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / "inbox.sqlite3"
    subscription = directory / "subscription"
    with closing(database(path)) as db:
        initialize(db)
        if args.command == "status":
            for row in db.execute("SELECT queued_at,message_id,deliveries,receipt,attempts,last_error FROM incoming ORDER BY rowid DESC LIMIT 100"):
                entry = dict(row)
                entry["message_id"] = hashlib.sha256(entry["message_id"].encode()).hexdigest()[:16]
                print(json.dumps(entry))
            return
        if args.command == "serve":
            state = os.environ["VILAR_MAIL_CLIENT_STATE"]
            if len(state) < 32:
                parser.error("client state must be at least 32 characters")
            ThreadingHTTPServer(("127.0.0.1", int(os.getenv("VILAR_MAIL_PORT", "18767"))),
                                receiver(path, lambda: subscription.read_text().strip(), state)).serve_forever()
            return
        account = os.environ["VILAR_OUTLOOK_ACCOUNT"].strip().lower()
        if args.command == "work":
            core = SourceClient(os.environ["VILAR_API_URL"], os.environ["VILAR_SOURCE_TOKEN"])
            while True:
                if not process_one(db, lambda mid: fetch_envelope(graph, account, mid), core):
                    time.sleep(0.5)
        else:
            # Serialize operator changes to this mailbox's recorded rule.
            with (directory / "subscription.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                manage_subscription(args, parser, subscription)


def manage_subscription(args, parser, subscription):
    if args.command == "unsubscribe":
        remove_subscription(graph, subscription, args.expected_id, os.environ["VILAR_MAIL_CALLBACK"])
        return
    # This is an explicit operator action on the test mailbox.
    until = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    body = {"expirationDateTime": until}
    if args.command == "subscribe":
        if subscription.exists():
            parser.error("subscription already recorded; use renew")
        state = os.environ["VILAR_MAIL_CLIENT_STATE"]
        url = os.environ["VILAR_MAIL_CALLBACK"]
        if len(state) < 32 or urlsplit(url).scheme != "https" or urlsplit(url).path != CALLBACK:
            parser.error("invalid HTTPS callback or client state")
        body.update(resource=RESOURCE, notificationUrl=url, clientState=state, changeType="created")
        result = graph("create", body=body)
        subscription.write_text(result["id"])
    else:
        graph("renew", subscriptionId=subscription.read_text().strip(), body=body)


if __name__ == "__main__":
    main()
