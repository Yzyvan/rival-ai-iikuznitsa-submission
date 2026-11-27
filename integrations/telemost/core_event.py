"""Map a Telemost meeting result to the Vilar v1 source event."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sources.client import SourceClient

ROOM_RE = re.compile(r"/j/([A-Za-z0-9_-]+)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _room_id(link: str) -> str:
    match = ROOM_RE.search(link or "")
    return match.group(1) if match else ""


def _line_for_source(source: str, transcript_text: str) -> str:
    match = re.search(r"\b(\d{2}:\d{2}:\d{2})\b", source)
    if not match or not transcript_text:
        return ""
    stamp = match.group(1)
    for line in transcript_text.splitlines():
        if line.startswith(f"[{stamp}]"):
            parts = line.split("]", 2)
            if len(parts) >= 3:
                return parts[2].strip()
    return ""


def _quote(protocol: dict, transcript_text: str = "") -> str:
    for group in ("tasks", "decisions", "events", "open_questions"):
        for item in protocol.get(group) or []:
            if isinstance(item, dict) and item.get("source"):
                source = str(item["source"])
                return (_line_for_source(source, transcript_text) or source)[:600]
    return str(protocol.get("summary") or "")[:600]


def build_meeting_event(meeting: dict, protocol: dict, transcript_text: str = "") -> tuple[dict, str]:
    meeting_id = str(meeting.get("id") or "")
    revision = str(meeting.get("revision") or 1)
    start = str(meeting.get("start") or "").strip() or _now()
    room = _room_id(str(meeting.get("link") or "")) or meeting_id
    event = {
        "source": {
            "provider": "meeting",
            "account": str(meeting.get("profile") or "vilar"),
            "channel": "telemost",
            "object": room,
            "revision": revision,
            "thread": meeting_id,
            "reply_to": None,
            "actor_external": str(meeting.get("organizer_email") or "") or None,
            "occurred_at": start,
            "received_at": _now(),
            "change": "create",
        },
        "data": {
            "meeting_id": meeting_id,
            "room_id": room,
            "fragment_id": f"{meeting_id}:{revision}",
            "starts_at": start,
            "quote": _quote(protocol, transcript_text),
            "recording_skipped": True,
            "calendar_ref": str(meeting.get("source_ref") or "") or None,
            "attendance": str(meeting.get("attendance") or "bot"),
            "protocol": protocol,
        },
    }
    return event, f"meeting/{meeting_id}/{revision}"


def submit_meeting_event(
    meeting: dict,
    protocol: dict,
    state_dir: str | Path,
    *,
    base_url: str = "",
    token: str = "",
    transport=None,
    transcript_text: str = "",
) -> dict:
    event, key = build_meeting_event(meeting, protocol, transcript_text)
    if base_url and token:
        client = transport or SourceClient(base_url, token)
        status, payload = client.submit(event, key)
        if not 200 <= int(status) < 300:
            raise RuntimeError(f"core HTTP {status}: {str(payload)[:300]}")
        event_id = str(payload.get("event_id") or payload.get("id") or "")
        receipt = None
        if event_id:
            try:
                _, receipt = client.read(event_id)
            except Exception:
                receipt = None
        return {
            "mode": "sent",
            "key": key,
            "status": int(status),
            "event_id": event_id,
            "receipt": receipt,
        }
    path = Path(state_dir) / "core_events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"sent_at": _now(), "key": key, "event": event}, ensure_ascii=False) + "\n")
    return {"mode": "dry_run", "key": key, "path": str(path)}
