#!/usr/bin/env python3
"""Поиск ссылки Телемоста в Outlook, ICS или EML."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

LINK_RE = re.compile(r"https?://telemost\.yandex\.ru/j/[0-9A-Za-z_-]+")


def _load_env() -> None:
    path = Path(__file__).with_name(".env")
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_env()


def find_telemost_links(text: str) -> list[str]:
    return list(dict.fromkeys(LINK_RE.findall(text or "")))


def find_in_ics(path: str) -> list[str]:
    raw = Path(path).read_text(encoding="utf-8", errors="ignore")
    raw = re.sub(r"\r?\n[ \t]", "", raw)  # свернуть перенесённые строки
    return find_telemost_links(raw)


def find_in_eml(path: str) -> list[str]:
    return find_telemost_links(Path(path).read_text(encoding="utf-8", errors="ignore"))


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def find_in_outlook(lookback_hours: int = 24, account: str | None = None) -> list[str]:
    account = account or os.getenv("VILAR_OUTLOOK_ACCOUNT", "")
    wrapper = os.getenv("C01_OUTLOOK_WRAPPER", "")
    home = os.getenv("C01_OUTLOOK_HOME", "")
    user = os.getenv("C01_OUTLOOK_USER", "")
    if not (wrapper and home and user and account):
        raise RuntimeError(
            "Set C01_OUTLOOK_WRAPPER, C01_OUTLOOK_HOME, C01_OUTLOOK_USER and VILAR_OUTLOOK_ACCOUNT"
        )
    now = datetime.now(timezone.utc)
    since = _iso(now - timedelta(hours=lookback_hours))
    cutoff = _iso(now + timedelta(hours=lookback_hours))
    start = _iso(now - timedelta(hours=1))
    end = _iso(now + timedelta(days=2))
    cmd = [
        "sudo", "-n", "-u", user,
        "env", f"HOME={home}", f"VILAR_OUTLOOK_ACCOUNT={account}",
        wrapper, "read", since, cutoff, start, end,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "outlook read failed")[:500])
    return find_telemost_links(proc.stdout)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--outlook", action="store_true")
    p.add_argument("--ics")
    p.add_argument("--eml")
    p.add_argument("--lookback-hours", type=int, default=24)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    links: list[str] = []
    try:
        if args.outlook:
            links = find_in_outlook(args.lookback_hours)
        elif args.ics:
            links = find_in_ics(args.ics)
        elif args.eml:
            links = find_in_eml(args.eml)
        else:
            print("Нужен --outlook, --ics или --eml")
            return 2
    except Exception as e:
        print("Ошибка поиска ссылки:", e)
        return 1

    if args.json:
        print(json.dumps(links, ensure_ascii=False))
    elif links:
        print(links[0])
    else:
        print("Ссылка Телемоста не найдена")
    return 0 if links else 1


if __name__ == "__main__":
    raise SystemExit(main())
