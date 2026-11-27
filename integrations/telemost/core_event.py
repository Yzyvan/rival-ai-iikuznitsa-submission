"""Map a Telemost meeting result to the Vilar v1 source event."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sources.client import SourceClient

ROOM_RE = re.compile(r"/j/([A-Za-z0-9_-]+)")
MAX_TRANSCRIPT_CHARS = 100000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _room_id(link: str) -> str:
    match = ROOM_RE.search(link or "")
    return match.group(1) if match else ""


def _occurred_at(meeting: dict) -> str:
    raw = str(meeting.get("start") or "").strip()
    if not raw:
        return _now()
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw
    if moment.tzinfo is None:
        moment = moment.replace(
            tzinfo=ZoneInfo(str(meeting.get("timezone") or "Europe/Moscow"))
        )
    return moment.isoformat()


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


def build_meeting_event(
    meeting: dict, protocol: dict, transcript_text: str = "", gaps: list[dict] | None = None
) -> tuple[dict, str]:
    meeting_id = str(meeting.get("id") or "")
    revision = str(meeting.get("revision") or 1)
    start = _occurred_at(meeting)
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
            "transcript": (transcript_text or "")[:MAX_TRANSCRIPT_CHARS],
            "transcript_format": "[HH:MM:SS] [speaker] text",
            "gaps": gaps or [],
            "transcript_complete": not gaps,
        },
    }
    return event, f"meeting/{meeting_id}/{revision}"


class CoreEventConflict(RuntimeError):
    pass


def _canonical(event: dict) -> str:
    clone = json.loads(json.dumps(event, ensure_ascii=False))
    clone.get("source", {}).pop("occurred_at", None)
    clone.get("data", {}).pop("starts_at", None)
    payload = json.dumps(
        clone, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _outbox_path(state_dir: str | Path, key: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", key)[:120] or "event"
    return Path(state_dir) / "core_outbox" / f"{safe}.json"


@contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    fd = os.open(path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _read_outbox(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as error:
        raise RuntimeError(f"core outbox: {error}") from error


def _write_outbox(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _send_event(client, event: dict, key: str) -> tuple[int, str, dict | None]:
    status, payload = client.submit(event, key)
    if not 200 <= int(status) < 300:
        raise RuntimeError(f"core HTTP {status}: {str(payload)[:300]}")
    if not isinstance(payload, dict):
        raise RuntimeError(f"core HTTP {status}: unexpected payload")
    event_id = str(payload.get("event_id") or payload.get("id") or "")
    receipt = None
    if event_id:
        try:
            _, receipt = client.read(event_id)
        except Exception:
            receipt = None
    return int(status), event_id, receipt


def submit_meeting_event(
    meeting: dict,
    protocol: dict,
    state_dir: str | Path,
    *,
    base_url: str = "",
    token: str = "",
    transport=None,
    transcript_text: str = "",
    gaps: list[dict] | None = None,
) -> dict:
    event, key = build_meeting_event(meeting, protocol, transcript_text, gaps=gaps)
    if not (base_url and token):
        path = Path(state_dir) / "core_events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"sent_at": _now(), "key": key, "event": event}, ensure_ascii=False) + "\n")
        return {"mode": "dry_run", "key": key, "path": str(path)}

    fingerprint = _canonical(event)
    path = _outbox_path(state_dir, key)
    with _locked(path):
        record = _read_outbox(path)
        if record is None:
            record = {
                "key": key,
                "fingerprint": fingerprint,
                "event": event,
                "event_id": "",
                "receipt": None,
            }
            _write_outbox(path, record)
        elif record.get("fingerprint") != fingerprint:
            raise CoreEventConflict(
                f"core event conflict for {key}: source data changed under the same revision"
            )
        else:
            event = record["event"]

    client = transport or SourceClient(base_url, token)
    status, event_id, receipt = _send_event(client, event, key)

    with _locked(path):
        record = _read_outbox(path) or {
            "key": key,
            "fingerprint": fingerprint,
            "event": event,
        }
        record["event_id"] = event_id
        record["receipt"] = receipt
        _write_outbox(path, record)

    return {
        "mode": "sent",
        "key": key,
        "status": int(status),
        "event_id": event_id,
        "receipt": receipt,
    }


def pending_core_events(state_dir: str | Path) -> int:
    root = Path(state_dir) / "core_outbox"
    if not root.is_dir():
        return 0
    count = 0
    for path in root.glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not record.get("event_id"):
            count += 1
    return count


def retry_core_outbox(
    state_dir: str | Path,
    base_url: str,
    token: str,
    *,
    transport=None,
    now: float | None = None,
) -> dict:
    """Re-send stored events after a failed or lost response."""
    root = Path(state_dir) / "core_outbox"
    if not root.is_dir():
        return {"sent": 0, "failed": 0, "pending": 0}
    client = transport or SourceClient(base_url, token)
    sent = 0
    failed = 0
    for path in sorted(root.glob("*.json")):
        with _locked(path):
            record = _read_outbox(path)
            if not record or record.get("event_id"):
                continue
            moment = time.time() if now is None else float(now)
            if float(record.get("next_attempt") or 0) > moment:
                continue
            event = record.get("event")
            key = record.get("key")
            if not isinstance(event, dict) or not key:
                continue
        try:
            _status, event_id, receipt = _send_event(client, event, key)
        except Exception as error:
            with _locked(path):
                record = _read_outbox(path) or record
                attempts = int(record.get("attempts") or 0) + 1
                record["attempts"] = attempts
                record["last_error"] = str(error)[:500]
                record["next_attempt"] = moment + min(300, 30 * (2 ** min(attempts, 3)))
                _write_outbox(path, record)
            failed += 1
            continue
        with _locked(path):
            record = _read_outbox(path) or record
            record["event_id"] = event_id
            record["receipt"] = receipt
            record["sent_at"] = _now()
            record["last_error"] = ""
            record["next_attempt"] = 0
            _write_outbox(path, record)
        sent += 1
    return {"sent": sent, "failed": failed, "pending": pending_core_events(state_dir)}
