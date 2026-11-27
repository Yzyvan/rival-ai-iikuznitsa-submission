"""Vilar v1 transport for provider events. Callers retain their retry key."""
import json
import re
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SourceClient:
    def __init__(self, base, token):
        url = urlsplit(base)
        if url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1"}):
            raise ValueError("Remote API requires HTTPS")
        self.base = base.rstrip("/")
        self.token = token
        self.http = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, event=None, key=None):
        # Header validation errors in http.client can echo the complete credential.
        if not isinstance(self.token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", self.token):
            raise ValueError("Invalid Core bearer token")
        headers = {"Authorization": "Bearer " + self.token}
        data = None
        if event is not None:
            if not key:
                raise ValueError("A stable event key is required")
            headers.update({"Content-Type": "application/json", "Idempotency-Key": key})
            data = json.dumps(event, ensure_ascii=False).encode()
        with self.http.open(Request(self.base + path, data=data, headers=headers), timeout=10) as response:
            return response.status, json.load(response)

    def submit(self, event, key):
        return self.request("/v1/events", event, key)

    def read(self, event_id):
        return self.request("/v1/events/" + quote(event_id, safe=""))
