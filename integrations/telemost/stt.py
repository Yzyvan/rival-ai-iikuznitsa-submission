"""Распознавание речи для Телемост-бота.

Три режима:
  * yandex — Yandex SpeechKit, синхронное распознавание куска PCM16 16 кГц;
  * groq   — Whisper large-v3-turbo через Groq (быстро, но данные уходят в США);
  * none   — только запись WAV-кусков, без текста.

Выбор: явно через --stt или автоматически по переменным окружения.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave


class STTError(RuntimeError):
    pass


def pcm16_to_wav(pcm: bytes, rate: int = 16000, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Transcriber:
    name = "none"

    def transcribe(self, pcm: bytes) -> str:
        return ""


class YandexTranscriber(Transcriber):
    name = "yandex"

    def __init__(self, api_key: str, folder_id: str, lang: str = "ru-RU"):
        self.api_key = api_key
        self.folder_id = folder_id
        self.lang = lang

    def transcribe(self, pcm: bytes) -> str:
        query = urllib.parse.urlencode(
            {
                "folderId": self.folder_id,
                "lang": self.lang,
                "format": "lpcm",
                "sampleRateHertz": 16000,
            }
        )
        url = f"https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?{query}"
        req = urllib.request.Request(
            url,
            data=pcm,
            method="POST",
            headers={
                "Authorization": f"Api-Key {self.api_key}",
                "Content-Type": "application/octet-stream",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:500]
            raise STTError(f"Yandex STT HTTP {e.code}: {body}") from e
        except Exception as e:
            raise STTError(f"Yandex STT: {e}") from e
        return str(payload.get("result") or "").strip()


GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def _curl_response(stdout: str) -> tuple[str, int]:
    raw = stdout or ""
    marker = "\nHTTP_STATUS:"
    if marker not in raw:
        raise STTError("Groq STT: no HTTP status")
    body, status_text = raw.rsplit(marker, 1)
    try:
        status = int(status_text.strip())
    except ValueError as error:
        raise STTError(f"Groq STT: invalid HTTP status {status_text!r}") from error
    return body, status


class GroqTranscriber(Transcriber):
    name = "groq"

    def __init__(
        self,
        api_key: str,
        model: str = "whisper-large-v3-turbo",
        lang: str = "ru",
        base_url: str = GROQ_TRANSCRIBE_URL,
    ):
        self.api_key = api_key
        self.model = model
        self.lang = lang
        self.base_url = base_url

    def transcribe(self, pcm: bytes) -> str:
        wav = pcm16_to_wav(pcm)
        cfg = tempfile.NamedTemporaryFile("w", suffix=".curlrc", delete=False)
        audio_path = ""
        proc = None
        try:
            os.chmod(cfg.name, 0o600)
            cfg.write(f'header = "Authorization: Bearer {self.api_key}"\n')
            cfg.close()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio:
                audio.write(wav)
                audio_path = audio.name
            cmd = [
                "curl", "-4", "-sS", "--max-time", "90",
                "-K", cfg.name,
                "-F", f"file=@{audio_path};type=audio/wav",
                "-F", f"model={self.model}",
                "-F", f"language={self.lang}",
                "-F", "response_format=json",
                "-w", "\nHTTP_STATUS:%{http_code}",
                self.base_url,
            ]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            except Exception as error:
                raise STTError(f"Groq curl: {error}") from error
        finally:
            try:
                os.unlink(cfg.name)
            except OSError:
                pass
            if audio_path:
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass
        if proc is None:
            raise STTError("Groq curl: no process result")
        if proc.returncode != 0:
            raise STTError(f"Groq curl {proc.returncode}: {(proc.stderr or '')[:500]}")
        raw, status = _curl_response(proc.stdout or "")
        if not 200 <= status < 300:
            raise STTError(f"Groq STT HTTP {status}: {raw.strip()[:500]}")
        try:
            payload = json.loads(raw)
        except Exception as error:
            raise STTError(f"Groq invalid response: {raw[:500]}") from error
        if not isinstance(payload, dict):
            raise STTError(f"Groq invalid response: {raw[:500]}")
        if payload.get("error"):
            raise STTError(
                f"Groq STT error: {json.dumps(payload['error'], ensure_ascii=False)[:500]}"
            )
        if "text" not in payload:
            raise STTError(f"Groq STT response without text: {raw[:500]}")
        value = payload["text"]
        return "" if value is None else str(value).strip()


def build_transcriber(kind: str) -> Transcriber:
    kind = (kind or "auto").lower()
    yandex_key = os.getenv("YANDEX_STT_API_KEY", "")
    yandex_folder = os.getenv("YANDEX_FOLDER_ID", "")
    groq_key = os.getenv("GROQ_API_KEY", "")

    if kind == "yandex" or (kind == "auto" and yandex_key and yandex_folder):
        if not (yandex_key and yandex_folder):
            raise STTError("Для Yandex STT нужны YANDEX_STT_API_KEY и YANDEX_FOLDER_ID")
        return YandexTranscriber(yandex_key, yandex_folder)
    if kind == "groq" or (kind == "auto" and groq_key):
        if not groq_key:
            raise STTError("Для Groq нужен GROQ_API_KEY")
        return GroqTranscriber(groq_key)
    if kind not in ("auto", "none"):
        raise STTError(f"Неизвестный STT-режим: {kind}")
    return Transcriber()
