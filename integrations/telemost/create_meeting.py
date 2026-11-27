#!/usr/bin/env python3
"""Создание встречи в Яндекс Телемосте через официальный API.

Нужен OAuth-токен с правом telemost-api:conferences.create.
Токен: https://oauth.yandex.ru/ (приложение с доступом к API Телемоста).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile

API = "https://cloud-api.yandex.net/v1/telemost-api/conferences"


def create_meeting(token: str, waiting_room_level: str = "PUBLIC",
                   auto_summarization: bool = False) -> dict:
    if waiting_room_level not in ("PUBLIC", "ORGANIZATION", "ADMINS"):
        raise ValueError("waiting_room_level: PUBLIC, ORGANIZATION или ADMINS")
    body = {"waiting_room_level": waiting_room_level}
    if auto_summarization:
        body["is_auto_summarization_enabled"] = True

    cfg = tempfile.NamedTemporaryFile("w", suffix=".curlrc", delete=False)
    data = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    try:
        os.chmod(cfg.name, 0o600)
        cfg.write(f'header = "Authorization: OAuth {token}"\n')
        cfg.close()
        json.dump(body, data, ensure_ascii=False)
        data.close()
        cmd = [
            "curl", "-4", "-sS", "--max-time", "60",
            "-K", cfg.name,
            "-H", "Content-Type: application/json",
            "-d", f"@{data.name}",
            API,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    finally:
        for p in (cfg.name, data.name):
            try:
                os.unlink(p)
            except OSError:
                pass
    if proc.returncode != 0:
        raise RuntimeError(f"curl {proc.returncode}: {(proc.stderr or '')[:500]}")
    try:
        payload = json.loads(proc.stdout)
    except Exception as e:
        raise RuntimeError(f"не JSON от API: {(proc.stdout or '')[:500]}") from e
    if "join_url" not in payload:
        raise RuntimeError(json.dumps(payload, ensure_ascii=False)[:1000])
    return payload


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--token", default=os.getenv("TELEMOST_OAUTH_TOKEN", ""))
    p.add_argument("--waiting-room-level", default="PUBLIC", choices=["PUBLIC", "ORGANIZATION", "ADMINS"])
    p.add_argument("--auto-summarization", action="store_true")
    args = p.parse_args()
    if not args.token:
        print("Нужен OAuth-токен: --token или TELEMOST_OAUTH_TOKEN")
        return 2
    try:
        result = create_meeting(args.token, args.waiting_room_level, args.auto_summarization)
    except Exception as e:
        print("Не удалось создать встречу:", e)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
