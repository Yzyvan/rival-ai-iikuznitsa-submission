"""Manage one marked Inbox rule for the authenticated mailbox."""
from datetime import datetime, timedelta, timezone
import json
import os
from urllib.parse import urlsplit, urlunsplit


def durable_write(path, text):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as out:
        out.write(text)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def prepare(provider, callback, resource, route, configured_app, account, calendar_ref=None):
    url = urlsplit(callback)
    if (url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment
            or url.path != route or url.query != "vilar_mail_pilot=1"):
        raise ValueError("exact marked pilot HTTPS callback required")
    page = provider("list")
    if page.get("@odata.nextLink") or not isinstance(page.get("value"), list):
        raise ValueError("incomplete subscription inventory")
    rows = page["value"]
    bare = urlunsplit(url._replace(query=""))
    if calendar_ref:
        # The current mailbox's calendar service persists this exact Graph ID.
        anchor_id = json.loads(calendar_ref.read_text())["id"]
        anchors = [r for r in rows if r.get("id") == anchor_id and r.get("notificationUrl") == bare
                   and r.get("resource", "").strip("/").lower() == "me/events"]
        if len(anchors) != 1:
            raise ValueError("current mailbox calendar reference does not match the Graph inventory")
        anchor = anchors[0]
        expiry = datetime.fromisoformat(anchor["expirationDateTime"].replace("Z", "+00:00"))
        creator = anchor.get("creatorId")
        app_id = anchor.get("applicationId")
        if (expiry <= datetime.now(timezone.utc) or not creator or not app_id
                or (configured_app and app_id != configured_app)):
            raise ValueError("calendar anchor expired or failed ownership verification")
        configured_app = app_id
    else:
        creator = provider("me", select="id").get("id")
        if not creator:
            raise ValueError("provider could not identify the authenticated mailbox")
        if not configured_app:
            calendar_apps = {r.get("applicationId") for r in rows
                             if r.get("notificationUrl") == bare and r.get("creatorId") == creator
                             and r.get("resource","").strip("/").lower() == "me/events"}
            if len(calendar_apps) != 1 or not all(calendar_apps):
                raise ValueError("could not verify application from current calendar connection")
            configured_app = calendar_apps.pop()
    identity = dict(applicationId=configured_app, creatorId=creator, notificationUrl=callback,
                    resource=resource, changeType="created", account=account)
    matches = [r for r in rows if r.get("notificationUrl") == callback]
    if len(matches) > 1 or (matches and not belongs(matches[0], identity)):
        raise ValueError("ambiguous or foreign subscription on this callback")
    return identity, matches[0] if matches else None


def belongs(rule, identity):
    return (bool(rule.get("id"))
            and rule.get("resource", "").strip("/").lower() == identity["resource"].strip("/").lower()
            and all(rule.get(key) == identity[key] for key in
                    ("changeType", "applicationId", "creatorId", "notificationUrl")))


def manage(provider, record, command, expected, callback, state, account, app, minutes, resource, route, calendar_ref=None):
    if not 45 <= minutes <= 720 or len(state) < 32:
        raise ValueError("invalid lifetime or client state")
    intent = record.with_name("subscription-intent.json")
    saved = json.loads(intent.read_text()) if intent.exists() else None
    if command == "unsubscribe" and not saved and not record.exists():
        return {"status": "no_owned_subscription"}
    if command in ("recover", "renew", "unsubscribe") and not saved:
        raise ValueError("no recorded creation intent; subscription ownership is unproven")
    identity, match = prepare(provider, callback, resource, route, app, account, calendar_ref)
    if saved and saved["identity"] != identity:
        raise ValueError("mailbox or callback changed since the original request")
    local_id = record.read_text().strip() if record.exists() else None
    if match and local_id and match["id"] != local_id:
        raise ValueError("local and remote identifiers disagree")
    if match and match.get("clientState") and match["clientState"] != state:
        raise ValueError("marked rule belongs to a different pilot secret")
    if match and expected and match["id"] != expected:
        raise ValueError("unexpected remote subscription")
    if local_id and expected and local_id != expected:
        raise ValueError("unexpected recorded subscription")
    if command == "subscribe":
        if match:
            if not saved:
                raise ValueError("marked subscription already exists, inspect with recover")
            durable_write(record, match["id"])
            return match
        if local_id or saved:
            raise ValueError("previous create unresolved or expired; recover before a new run")
        body = dict(expirationDateTime=(datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(),
                    notificationUrl=callback, resource=resource, changeType="created", clientState=state)
        durable_write(intent, json.dumps(dict(identity=identity, requested_until=body["expirationDateTime"])))
        result = provider("create", body=body)
        if not result.get("id"):
            raise ValueError("no subscription ID; recover this request")
        durable_write(record, result["id"])
        return result
    if command == "recover":
        if not match:
            raise ValueError("no confirmed match; no second create issued")
        durable_write(record, match["id"])
        return match
    sid = local_id or (match and match["id"])
    if not sid:
        raise ValueError("cannot identify the exact mail subscription")
    # Re-read the exact rule immediately before a mutation, also after a lost DELETE.
    current = provider("inspect", subscriptionId=sid)
    if current is not None and (current.get("id") != sid or not belongs(current, identity)):
        raise ValueError("rule no longer matches the pilot")
    if command == "renew":
        if not current:
            raise ValueError("missing subscription")
        return provider("renew", subscriptionId=sid, body={
            "expirationDateTime": (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()})
    if command != "unsubscribe":
        raise ValueError("unsupported operation")
    if current is not None:
        durable_write(record, sid)
        provider("remove", subscriptionId=sid, confirm=True)
        if provider("inspect", subscriptionId=sid) is not None:
            raise RuntimeError("deletion not yet confirmed")
    record.unlink(missing_ok=True)
    intent.unlink(missing_ok=True)
    return {"id": sid, "status": "removed"}
