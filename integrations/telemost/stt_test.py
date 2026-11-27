#!/usr/bin/env python3
"""Проверка облачного STT на одном WAV-файле.

Примеры:
  GROQ_API_KEY=... python stt_test.py --provider groq --audio test.wav
  DEEPGRAM_API_KEY=... python stt_test.py --provider deepgram --audio test.wav
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
      python stt_test.py --provider cloudflare --audio test.wav
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
import wave

from stt import GroqTranscriber, YandexTranscriber


def wav_to_pcm(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit("Нужен моно WAV PCM16")
        return w.readframes(w.getnframes())


def wav_bytes(path: str) -> bytes:
    return open(path, "rb").read()


def http_json(url: str, data: bytes, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_groq(path: str) -> str:
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        raise SystemExit("Нет GROQ_API_KEY")
    return GroqTranscriber(key).transcribe(wav_to_pcm(path))


def run_yandex(path: str) -> str:
    key = os.getenv("YANDEX_STT_API_KEY", "")
    folder = os.getenv("YANDEX_FOLDER_ID", "")
    if not (key and folder):
        raise SystemExit("Нет YANDEX_STT_API_KEY или YANDEX_FOLDER_ID")
    return YandexTranscriber(key, folder).transcribe(wav_to_pcm(path))


def run_deepgram(path: str) -> str:
    key = os.getenv("DEEPGRAM_API_KEY", "")
    if not key:
        raise SystemExit("Нет DEEPGRAM_API_KEY")
    url = (
        "https://api.deepgram.com/v1/listen"
        "?model=nova-3&language=ru&smart_format=true&punctuate=true"
    )
    payload = http_json(
        url,
        wav_bytes(path),
        {"Authorization": f"Token {key}", "Content-Type": "audio/wav"},
    )
    return payload["results"]["channels"][0]["alternatives"][0]["transcript"]


def run_cloudflare(path: str) -> str:
    token = os.getenv("CLOUDFLARE_API_TOKEN", "")
    account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
    if not (token and account):
        raise SystemExit("Нет CLOUDFLARE_API_TOKEN или CLOUDFLARE_ACCOUNT_ID")
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/"
        "@cf/openai/whisper-large-v3-turbo"
    )
    payload = http_json(
        url,
        wav_bytes(path),
        {"Authorization": f"Bearer {token}", "Content-Type": "audio/wav"},
    )
    if not payload.get("success"):
        raise SystemExit(f"Cloudflare error: {payload}")
    return payload["result"]["text"]


PROVIDERS = {
    "groq": run_groq,
    "yandex": run_yandex,
    "deepgram": run_deepgram,
    "cloudflare": run_cloudflare,
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--provider", required=True, choices=sorted(PROVIDERS))
    p.add_argument("--audio", required=True)
    args = p.parse_args()

    started = time.monotonic()
    try:
        text = PROVIDERS[args.provider](args.audio)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        print(f"HTTP {e.code}: {body}")
        return 1
    elapsed = time.monotonic() - started
    print(f"provider={args.provider} latency={elapsed:.2f}s")
    print("TEXT:", text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
