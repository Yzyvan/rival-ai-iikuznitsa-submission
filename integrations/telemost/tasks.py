#!/usr/bin/env python3
"""Поручения из утверждённого протокола: tasks.json и calendar.ics."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path


def _ics_escape(value: str) -> str:
    text = value or ""
    bs = chr(92)
    return (
        text.replace(bs, bs + bs)
        .replace("\n", bs + "n")
        .replace(",", bs + ",")
        .replace(";", bs + ";")
    )


def _deadline_date(task: dict) -> str | None:
    value = str(task.get("deadline_iso") or task.get("deadline") or "")
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", value)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).strftime("%Y%m%d")
    except ValueError:
        return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--protocol", required=True, help="protocol.approved.json")
    p.add_argument("--out", help="каталог для tasks.json и calendar.ics")
    args = p.parse_args()

    source = Path(args.protocol)
    data = json.loads(source.read_text(encoding="utf-8"))
    out = Path(args.out) if args.out else source.parent
    out.mkdir(parents=True, exist_ok=True)
    tasks = data.get("tasks") or []
    (out / "tasks.json").write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//rival-ai//telemost-bot//RU",
        "CALSCALE:GREGORIAN",
    ]
    events = 0
    for t in tasks:
        day = _deadline_date(t)
        if not day:
            continue
        uid = hashlib.sha1((t.get("task", "") + str(t.get("owner")) + day).encode("utf-8")).hexdigest()[:16]
        description = f"Владелец: {t.get('owner') or 'не указан'}. Источник: {t.get('source') or 'не указан'}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}@telemost-bot",
            f"DTSTART;VALUE=DATE:{day}",
            f"SUMMARY:{_ics_escape('Поручение: ' + str(t.get('task', '')))}",
            f"DESCRIPTION:{_ics_escape(description)}",
            "END:VEVENT",
        ]
        events += 1
    lines.append("END:VCALENDAR")
    (out / "calendar.ics").write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")

    print("tasks.json:", out / "tasks.json")
    print("calendar.ics:", out / "calendar.ics")
    print("tasks:", len(tasks), "events:", events)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
