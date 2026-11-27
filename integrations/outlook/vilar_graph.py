"""Транспорт Graph v1.0. Один экземпляр обслуживает один запрос владельца."""
from datetime import datetime, time, timedelta, timezone
from urllib.parse import quote, urlsplit

import httpx

ROOT = "https://graph.microsoft.com/v1.0"
MAIL = "id,subject,from,receivedDateTime,conversationId,bodyPreview,webLink"
EVENT = "id,subject,start,end,attendees,isCancelled,showAs,webLink,changeKey"


class GraphError(Exception):
    def __init__(self, status, retry_after=None):
        self.status = status
        self.retry_after = retry_after


def object_id(value):
    return quote(value, safe="")


class Outlook:
    def __init__(self, http, token):
        self.http = http
        self.headers = {"Authorization": f"Bearer {token}", "Prefer": 'outlook.timezone="UTC"'}

    def request(self, method, path, *, params=None, body=None, headers=None):
        url = ROOT + path if path.startswith("/") else path
        parts = urlsplit(url)
        if (parts.scheme, parts.netloc) != ("https", "graph.microsoft.com") or not parts.path.startswith("/v1.0/"):
            raise GraphError(502)
        try:
            response = self.http.request(method, url, params=params, json=body,
                                         headers=self.headers | (headers or {}), follow_redirects=False)
        except httpx.RequestError:
            raise GraphError(503) from None
        if not response.is_success:
            raise GraphError(response.status_code, response.headers.get("Retry-After"))
        return response.json()

    def latest(self):
        return self.request("GET", "/me/mailFolders/inbox/messages", params={
            "$top": 10, "$select": MAIL, "$orderby": "receivedDateTime desc"})["value"]

    def thread(self, conversation):
        escaped = conversation.replace("'", "''")
        return self.pages("/me/messages", {"$filter": f"conversationId eq '{escaped}'",
                                           "$select": MAIL + ",body", "$top": 50})

    def pages(self, path, params):
        values = []
        for _ in range(100):
            page = self.request("GET", path, params=params)
            values.extend(page["value"])
            path = page.get("@odata.nextLink")
            if not path:
                return values
            params = None
        raise GraphError(507)

    def tomorrow(self, zone, now=None):
        day = (now or datetime.now(timezone.utc)).astimezone(zone).date() + timedelta(days=1)
        start = datetime.combine(day, time.min, zone)
        end = datetime.combine(day + timedelta(days=1), time.min, zone)
        events = self.pages("/me/calendarView", {"startDateTime": start.isoformat(),
            "endDateTime": end.isoformat(), "$select": EVENT, "$top": 100})
        def utc(field):
            # Prefer UTC выше. Graph возвращает dateTime без суффикса и отдельное timeZone.
            return datetime.fromisoformat(field["dateTime"]).replace(tzinfo=timezone.utc)
        cursor, limit = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
        windows = []
        for event in sorted(events, key=lambda e: utc(e["start"])):
            if event["isCancelled"] or event["showAs"] in {"free", "workingElsewhere"}:
                continue
            a, b = max(cursor, utc(event["start"])), min(limit, utc(event["end"]))
            if b <= a:
                continue
            if a > cursor:
                windows.append([cursor.isoformat(), a.isoformat()])
            cursor = b
        if cursor < limit:
            windows.append([cursor.isoformat(), limit.isoformat()])
        return {"date": day.isoformat(), "timezone": str(zone), "events": events, "free_windows_utc": windows}

    def reply_draft(self, message_id, text):
        return self.request("POST", f"/me/messages/{object_id(message_id)}/createReply",
                            body={"comment": text})

    def create_event(self, payload):
        return self.request("POST", "/me/events", body=payload)

    def move_event(self, event_id, etag, interval):
        return self.request("PATCH", f"/me/events/{object_id(event_id)}", body=interval,
                            headers={"If-Match": etag})
