#!/usr/bin/env python3
"""Сквозная проверка входа на фейковой комнате Телемоста."""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def find_chrome() -> str:
    env = os.getenv("CHROME_PATH", "")
    if env:
        return env
    for p in (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ):
        if Path(p).exists():
            return p
    return ""


def main() -> int:
    out = tempfile.mkdtemp(prefix="tm-mock-")
    cmd = [
        sys.executable, str(ROOT / "bot.py"),
        "--url", "https://telemost.yandex.ru/j/MOCK",
        "--mock", "--stt", "none",
        "--duration", "16", "--chunk-seconds", "2",
        "--out", out, "--debug",
    ]
    chrome = find_chrome()
    if chrome:
        cmd += ["--chrome", chrome]

    print("RUN:", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    print("--- stdout ---")
    print(proc.stdout[-4000:])
    if proc.stderr.strip():
        print("--- stderr ---")
        print(proc.stderr[-2000:])
    print("EXIT:", proc.returncode)

    sessions = sorted(glob.glob(out + "/session-*"))
    events = []
    if sessions:
        ev = Path(sessions[-1]) / "events.jsonl"
        if ev.exists():
            events = [json.loads(x) for x in ev.read_text().splitlines() if x.strip()]
    kinds = [e.get("event") for e in events]
    chunks = glob.glob(out + "/session-*/audio/chunk-*.wav")

    print("events:", kinds)
    print("chunks:", len(chunks))

    ok = True

    def check(name: str, cond: bool):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name)
        ok = ok and cond

    check("бот вышел с кодом 0", proc.returncode == 0)
    check("событие connected", "connected" in kinds)
    check("звук нарезан на куски", len(chunks) >= 2)
    check("есть событие audio_chunk", "audio_chunk" in kinds)
    check("нет ошибок", "error" not in kinds and "join_failed" not in kinds)

    print("MOCK_JOIN_PASS" if ok else "MOCK_JOIN_FAIL")
    print("out:", out)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
