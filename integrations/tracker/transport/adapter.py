"""Vilar tracker HTTP transport and durable inbox delivery."""

import hashlib
import http.client
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit


class ApiError(Exception):
    def __init__(self, status, payload):
        super().__init__(f"HTTP {status}: {payload}")
        self.status, self.payload = status, payload


class Core:
    def __init__(self, origin, token):
        url = urlsplit(origin)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.path not in ("", "/")
            or url.query
            or url.fragment
        ):
            raise ValueError("Expected a core origin")
        if url.scheme == "http" and url.hostname not in (
            "127.0.0.1",
            "localhost",
            "::1",
        ):
            raise ValueError("Remote core connections require HTTPS")
        self.url, self.token = url, token

    def request(self, path, body=None, key=None, headers=None):
        return self.request_with_status(path, body, key, headers)[1]

    def request_with_status(self, path, body=None, key=None, headers=None):
        connection = (
            http.client.HTTPSConnection
            if self.url.scheme == "https"
            else http.client.HTTPConnection
        )(self.url.hostname, self.url.port, timeout=10)
        hdr = {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            **(headers or {}),
        }
        if key:
            hdr["Idempotency-Key"] = key
        try:
            connection.request(
                "GET" if body is None else "POST",
                path,
                json.dumps(body).encode() if body is not None else None,
                hdr,
            )
            res = connection.getresponse()
            raw = res.read()
            if res.status == 204:
                return res.status, None
            try:
                data = json.loads(raw)
            except ValueError:
                data = None
            if res.status >= 400:
                if not isinstance(data, dict):
                    code = "core_unavailable" if res.status >= 500 else "core_error"
                    data = {"error": {"code": code}}
                raise ApiError(res.status, data)
            if res.status >= 300 or not isinstance(data, dict):
                raise ApiError(502, {"error": {"code": "invalid_core_response"}})
            return res.status, data
        finally:
            connection.close()

    def rows(self, kind, filters):
        body = {"query_kind": kind, "filters": filters, "limit": 50}
        rows = []
        while True:
            page = self.request("/v1/context/query", body)
            rows.extend(page["rows"])
            if not page["next_cursor"]:
                return rows
            body["cursor"] = page["next_cursor"]


def deliver(core, account, inbox, key):
    """Retry a lost response with the same poll key. Never overwrite a delivered card."""
    op = core.request(
        "/v1/dispatch/claim", {"channel": "tasks", "account": account}, key
    )
    if not op:
        return None
    if op["action"] != "issue_task" or op["account"] != account:
        raise ValueError("Unexpected assignment")
    card = {
        "id": "ext-" + op["step_id"],
        "dispatch_id": op["dispatch_id"],
        "work_id": op["work_id"],
        "step_id": op["step_id"],
        "account": account,
        "recipient": op["recipient"],
        "material_version": op["material_version"],
        "title": op["title"],
    }
    inbox = Path(inbox)
    inbox.mkdir(parents=True, mode=0o700, exist_ok=True)
    addr = json.dumps([account, op["dispatch_id"]]).encode()
    dest = inbox / (hashlib.sha256(addr).hexdigest() + ".json")
    active = op["status"] == "in_flight" and datetime.fromisoformat(
        op["lease_until"]
    ) > datetime.now(timezone.utc)
    if active and not dest.exists():
        with tempfile.NamedTemporaryFile(dir=inbox, delete=False) as tmp:
            path = Path(tmp.name)
            try:
                tmp.write(json.dumps(card, ensure_ascii=False).encode())
                tmp.flush()
                os.fsync(tmp.fileno())
                try:
                    os.link(path, dest)
                except FileExistsError:
                    pass
            finally:
                path.unlink(missing_ok=True)
    if dest.exists():
        if json.loads(dest.read_text()) != card:
            raise ValueError("Delivery conflicts with the retained card")
        directory = os.open(inbox, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        outcome = "delivered"
        payload = {
            "provider_receipt": {
                k: card[k] for k in ("id", "recipient", "material_version")
            }
        }
    else:
        outcome, payload = "uncertain", {}
    attempt = op["attempt_token"]
    payload.update(attempt_token=attempt, outcome=outcome)
    return core.request(
        "/v1/dispatch/" + quote(op["dispatch_id"], safe="") + "/receipt",
        payload,
        f"receipt/{attempt}/{outcome}",
    )


def result_event(row, result_ref, revision, at):
    source = {
        "provider": "tracker",
        "channel": "tasks",
        "account": row["account"],
        "object": row["tracker_object"],
        "actor_external": row["actor_external"],
        "change": "update",
        "revision": revision,
        "occurred_at": at,
    }
    data = {
        "external_status": "submitted",
        "result_ref": result_ref,
        "work_id": row["work_id"],
        "step_id": row["step_id"],
        "material_version": row["material_version"],
        "expected_version": row["version"],
    }
    return {"source": source, "data": data}


def submit(core, employee_token, dispatch_id, event):
    key = "tracker/" + event["source"]["object"] + "/" + event["source"]["revision"]
    return core.request(
        "/v1/events",
        event,
        key,
        {"X-Dispatch-ID": dispatch_id, "X-Tracker-Session": "Bearer " + employee_token},
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Receive one Vilar assignment. Reuse the poll key on retry."
    )
    parser.add_argument("poll_key")
    args = parser.parse_args()
    print(
        json.dumps(
            deliver(
                Core(os.environ["VILAR_CORE_URL"], os.environ["VILAR_TRACKER_TOKEN"]),
                os.environ["VILAR_TRACKER_ACCOUNT"],
                os.environ["VILAR_TRACKER_INBOX"],
                args.poll_key,
            )
        )
    )
