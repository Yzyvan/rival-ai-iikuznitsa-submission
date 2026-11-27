#!/usr/bin/env python3
"""Telemost-бот: входит гостем, показывает видео-аватар и транскрибирует звук встречи.

Как это работает:
  * Chromium (Playwright) открывает ссылку Телемоста и проходит экран гостя;
  * init-скрипт подменяет камеру на canvas с зацикленным видео и микрофон на тишину;
  * тот же init-скрипт перехватывает RTCPeerConnection, микширует удалённый звук
    и отдаёт PCM16 16 кГц в Python;
  * Python режет поток на куски и отправляет в SpeechKit / Whisper.

Никакого Xvfb и PulseAudio не нужно: звук снимается до вывода в колонки.
"""

from __future__ import annotations

import argparse
import array
import asyncio
import base64
import json
import math
import os
import re
import signal
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Frame, Page, async_playwright

from mock_pages import FRAME_HTML, MAIN_HTML
from stt import Transcriber, build_transcriber, pcm16_to_wav

ROOT = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))

DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
)

CONTINUE_SELECTORS = [
    '[data-testid="meeting-continue-in-browser-continue"]',
    'button:has-text("Продолжить в браузере")',
    'button:has-text("Continue in browser")',
    'a:has-text("Продолжить в браузере")',
]

ONBOARDING_SELECTORS = [
    '[data-testid="telemost-3-onboarding-confirm"]',
    '[data-testid="telemost-3-onboarding-close"]',
    'button:has-text("Понятно")',
]

JOIN_SELECTORS = [
    '[data-testid="enter-conference-button"]',
    'button:has-text("Подключиться")',
    'button:has-text("Присоединиться")',
    'button:has-text("Join")',
]

NAME_SELECTORS = [
    '[data-testid="orb-textinput-input"]',
    'input[autocomplete="name"]',
    'input[placeholder*="имя" i]',
    'input[placeholder*="name" i]',
    'input[name="name"]',
    'input[name="displayName"]',
    'input[type="text"]',
]

IN_CALL_SELECTORS = [
    '[data-testid="participants-button"]',
    '[data-testid="end-call-alt-button"]',
]

WAITING_MARKERS = [
    "зал ожидания",
    "организатор скоро впустит",
    "ожидайте, пока организатор",
    "организатор видит ваш запрос",
    "waiting for the host",
]

PREJOIN_MARKERS = [
    "ваше имя на встрече",
]

END_MARKERS = [
    "встреча завершена",
    "конференция завершена",
    "звонок завершён",
    "звонок завершен",
    "вы покинули",
    "вы были удалены",
    "meeting ended",
    "call ended",
    "you were removed",
]

INVALID_MARKERS = [
    "такого звонка нет",
    "ссылка недействительна",
    "встреча не найдена",
    "call not found",
    "meeting not found",
    "invalid link",
]


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def pcm_level(pcm: bytes) -> tuple[int, float]:
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if not a:
        return 0, 0.0
    peak = max(abs(x) for x in a)
    rms = math.sqrt(sum(x * x for x in a) / len(a))
    return peak, rms


class TelemostBot:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.url = args.url
        self.name = args.name
        self.headless = not args.headed
        self.debug = args.debug
        self.duration = args.duration
        self.wait_timeout = args.wait_timeout
        self.chunk_seconds = args.chunk_seconds
        self.session_dir = Path(args.out) / f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        self.audio_dir = self.session_dir / "audio"
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(exist_ok=True)

        self.events_path = self.session_dir / "events.jsonl"
        self.transcript_path = self.session_dir / "transcript.txt"
        self.raw_path = self.session_dir / "audio.pcm"

        self.events = open(self.events_path, "a", encoding="utf-8")
        self.raw_files: dict[str, object] = {}
        self.transcript = open(self.transcript_path, "a", encoding="utf-8")

        self.pcm_buffers: dict[str, bytearray] = {}
        self.pcm_total = 0
        self.chunk_idx: dict[str, int] = {}
        self.speaker_labels: dict[str, str] = {}
        self.track_names: dict[str, str] = {}
        self.transcriber: Transcriber = build_transcriber(args.stt)
        self.running = True
        self.connected = False
        self.intro_started = False
        self.had_remote = False
        self.had_others = False
        self.stop_reason = ""
        self.capture_path = ""
        self.frames_seen: set[str] = set()
        self.start_time = time.monotonic()
        self.avatar_urls: list[str] = []
        self.summary_path = self.session_dir / "summary.json"
        self.stats = {
            "audio_chunks": 0,
            "silence_chunks": 0,
            "stt_calls": 0,
            "stt_errors": 0,
            "stt_latency_total": 0.0,
            "stt_audio_seconds": 0.0,
            "max_video_bytes": 0,
            "max_video_width": 0,
            "max_video_height": 0,
        }

        self.playwright = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

    # ---------- журнал ----------
    def event(self, kind: str, **fields) -> None:
        row = {"ts": utcnow(), "event": kind, **fields}
        self.events.write(json.dumps(row, ensure_ascii=False) + "\n")
        self.events.flush()

    def say(self, text: str) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {text}", flush=True)

    # ---------- запуск ----------
    def _chromium_args(self) -> list[str]:
        args = [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--lang=ru-RU",
            "--window-size=1280,720",
            "--no-first-run",
        ]
        if sys.platform.startswith("linux"):
            args.append("--no-sandbox")
        if self.args.avatar_y4m:
            y4m = Path(self.args.avatar_y4m).expanduser().resolve()
            if not y4m.exists():
                raise SystemExit(f"Нет файла Y4M: {y4m}")
            args.append(f"--use-file-for-fake-video-capture={y4m}")
        return args

    async def _launch(self) -> None:
        self.playwright = await async_playwright().start()
        launch_kwargs: dict = {
            "headless": self.headless,
            "args": self._chromium_args(),
            "ignore_default_args": ["--mute-audio"],
        }
        if self.args.chrome:
            launch_kwargs["executable_path"] = self.args.chrome
        self.browser = await self.playwright.chromium.launch(**launch_kwargs)
        self.context = await self.browser.new_context(
            locale="ru-RU",
            user_agent=DEFAULT_UA,
            viewport={"width": 1280, "height": 720},
            permissions=["camera", "microphone"],
            ignore_https_errors=True,
        )

        if self.args.mock:
            async def serve_main(route):
                await route.fulfill(status=200, body=MAIN_HTML,
                                    headers={"Content-Type": "text/html; charset=utf-8"})

            async def serve_frame(route):
                await route.fulfill(status=200, body=FRAME_HTML,
                                    headers={"Content-Type": "text/html; charset=utf-8"})

            await self.context.route(re.compile(r"https://telemost\.yandex\.ru/j/MOCK.*"), serve_main)
            await self.context.route(re.compile(r"https://telemost\.yandex\.ru/private-join/MOCK.*"), serve_frame)

        if self.args.black_screen:
            self.say("Чёрный экран: камера без аватара, микрофон — тишина")

        if self.args.mic_file:
            voice = Path(self.args.mic_file).expanduser().resolve()
            if not voice.exists():
                raise SystemExit(f"Нет файла микрофона: {voice}")
            voice_bytes = voice.read_bytes()
            self.say(f"Микрофон из файла: {voice.name}, {len(voice_bytes) / 1024:.0f} КБ")

            async def serve_voice(route):
                await route.fulfill(
                    status=200,
                    body=voice_bytes,
                    headers={"Content-Type": "audio/wav", "Cache-Control": "no-store"},
                )

            await self.context.route("**/__tm_voice.wav", serve_voice)

        files: list[Path] = []
        if self.args.avatar_playlist:
            files.extend(Path(p).expanduser().resolve() for p in self.args.avatar_playlist)
        if self.args.avatar_mp4:
            files.insert(0, Path(self.args.avatar_mp4).expanduser().resolve())
        for i, mp4 in enumerate(files):
            if not mp4.exists():
                raise SystemExit(f"Нет файла MP4: {mp4}")
            body = mp4.read_bytes()
            self.say(f"Аватар {i + 1}/{len(files)}: {mp4.name}, {len(body) / 1024 / 1024:.1f} МБ")
            url = f"/__tm_avatar_{i}{mp4.suffix.lower()}"
            self.avatar_urls.append(url)
            content_type = "video/webm" if mp4.suffix.lower() == ".webm" else "video/mp4"

            def make_avatar_handler(body_bytes, media_type):
                async def serve_avatar(route):
                    await route.fulfill(
                        status=200,
                        body=body_bytes,
                        headers={"Content-Type": media_type, "Cache-Control": "no-store"},
                    )
                return serve_avatar

            await self.context.route(f"**{url}", make_avatar_handler(body, content_type))

        inject = (ROOT / "telemost_inject.js").read_text(encoding="utf-8")
        if self.args.black_screen:
            mic_mode = "silence"
        elif self.args.mic_tone:
            mic_mode = "tone"
        elif self.args.mic_file:
            mic_mode = "file"
        else:
            mic_mode = "silence"
        config = {
            "videoUrl": self.avatar_urls[0] if self.avatar_urls else "",
            "videoUrls": self.avatar_urls,
            "blackScreen": bool(self.args.black_screen),
            "micMode": mic_mode,
            "micFileUrl": "/__tm_voice.wav" if self.args.mic_file else "",
            "micLoop": not bool(self.args.mic_once),
            "introCount": max(0, int(self.args.avatar_intro_count)),
            "startOnJoin": bool(self.args.start_on_join),
            "toneHz": self.args.tone_hz,
            "toneGain": self.args.tone_gain,
            "fps": 24,
            "cameraLabel": "HD Camera",
            "selfName": self.args.name,
            "debug": self.debug,
        }
        prefix = f"window.__TELEMOST_BOT_CONFIG__ = {json.dumps(config)};\n"
        await self.context.add_init_script(script=prefix + inject)

        self.page = await self.context.new_page()
        await self.page.expose_function("__tmBotPcm", self._on_pcm)

        def on_console(msg):
            if not self.debug:
                return
            text = msg.text or ""
            if "preload" in text.lower():
                return
            self.say(f"[browser:{msg.type}] {text}")

        self.page.on("console", on_console)
        self.page.on("pageerror", lambda e: self.say(f"[pageerror] {e}"))

    def _on_pcm(self, b64: str, frame_path: str = "", track_key: str = "") -> None:
        # Телемост 3.0 держит звонок в iframe /private-join/. Если он найден,
        # берём звук только оттуда, иначе один и тот же поток приходит дважды.
        if self.capture_path and self.capture_path not in (frame_path or ""):
            return
        try:
            data = base64.b64decode(b64)
        except Exception:
            return
        key = track_key or "mix"
        if key not in self.pcm_buffers:
            self.pcm_buffers[key] = bytearray()
            safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)
            self.raw_files[key] = open(self.session_dir / f"audio-{safe}.pcm", "wb")
        self.pcm_buffers[key].extend(data)
        self.pcm_total += len(data)
        self.raw_files[key].write(data)

    # ---------- помощники DOM ----------
    @staticmethod
    async def _first_visible(frame: Frame, selectors: list[str]):
        for sel in selectors:
            try:
                for el in await frame.query_selector_all(sel):
                    try:
                        if await el.is_visible():
                            return el
                    except Exception:
                        continue
            except Exception:
                continue
        return None

    async def _click_anywhere(self, selectors: list[str], timeout: float = 5.0) -> str | None:
        assert self.page
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for frame in self.page.frames:
                el = await self._first_visible(frame, selectors)
                if el:
                    try:
                        await el.click(timeout=3000)
                        return "clicked"
                    except Exception:
                        try:
                            await el.evaluate("e => e.click()")
                            return "js-clicked"
                        except Exception:
                            pass
            await asyncio.sleep(0.5)
        return None

    def _call_frame(self) -> Frame:
        assert self.page
        for frame in self.page.frames:
            if "/private-join/" in frame.url:
                return frame
        return self.page.main_frame

    async def _prejoin_frame(self, timeout: float) -> Frame | None:
        assert self.page
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if await self._has_marker(INVALID_MARKERS):
                raise InvalidRoom("Телемост говорит, что такого звонка нет")
            for frame in self.page.frames:
                if await self._first_visible(frame, JOIN_SELECTORS):
                    return frame
            await asyncio.sleep(0.5)
        return None

    async def _frame_texts(self) -> list[str]:
        assert self.page
        texts = []
        for frame in self.page.frames:
            try:
                text = await asyncio.wait_for(
                    frame.evaluate("() => (document.body && document.body.innerText) || ''"), 5
                )
                texts.append((text or "").lower())
            except Exception:
                continue
        return texts

    async def _has_marker(self, markers: list[str]) -> bool:
        for text in await self._frame_texts():
            if any(m in text for m in markers):
                return True
        return False

    async def _status(self) -> dict:
        assert self.page
        total = {
            "pcs": 0, "connected": 0, "tracks": 0, "pcmBytes": 0,
            "pcmRunning": False, "audioCtx": set(), "errors": [],
            "video": {"bytes": 0, "frames": 0, "width": 0, "height": 0},
            "audioSent": 0,
        }
        for frame in self.page.frames:
            try:
                st = await asyncio.wait_for(
                    frame.evaluate("window.__tmBotStatus ? window.__tmBotStatus() : null"), 8
                )
            except Exception:
                continue
            if not st:
                continue
            total["pcs"] += st.get("pcs", 0)
            total["connected"] += st.get("connected", 0)
            total["tracks"] += st.get("tracks", 0)
            total["pcmBytes"] += st.get("pcmBytes", 0)
            total["pcmRunning"] = total["pcmRunning"] or bool(st.get("pcmRunning"))
            total["audioCtx"].add(st.get("audioCtx", "none"))
            total["audioSent"] += st.get("audioSent", 0)
            v = st.get("video") or {}
            total["video"]["bytes"] += v.get("bytes", 0)
            total["video"]["frames"] += v.get("frames", 0)
            total["video"]["width"] = v.get("width") or total["video"]["width"]
            total["video"]["height"] = v.get("height") or total["video"]["height"]
            total["errors"].extend(st.get("errors") or [])
        total["audioCtx"] = ",".join(sorted(total["audioCtx"])) or "none"
        return total

    async def _active_speaker(self) -> str:
        if not self.page:
            return ""
        for frame in self.page.frames:
            try:
                name = await asyncio.wait_for(
                    frame.evaluate("window.__tmBotActiveSpeaker ? window.__tmBotActiveSpeaker() : ''"),
                    5,
                )
                if name:
                    return str(name)
            except Exception:
                continue
        return ""

    async def _track_names(self) -> dict[str, str]:
        if not self.page:
            return self.track_names
        for frame in self.page.frames:
            try:
                data = await asyncio.wait_for(
                    frame.evaluate("window.__tmBotTrackMap ? window.__tmBotTrackMap() : {}"),
                    2,
                )
                if isinstance(data, dict):
                    self.track_names.update(
                        {str(k): str(v) for k, v in data.items() if v}
                    )
            except Exception:
                continue
        return self.track_names

    async def _dump_participants(self) -> None:
        if not self.page:
            return
        for frame in self.page.frames:
            try:
                items = await asyncio.wait_for(
                    frame.evaluate("window.__tmBotParticipants ? window.__tmBotParticipants() : []"),
                    5,
                )
                if items:
                    self.event("participants_dom", url=frame.url, items=items)
            except Exception:
                continue

    async def _participants(self) -> int:
        assert self.page
        for frame in self.page.frames:
            el = await self._first_visible(frame, ['[data-testid="participants-button"]'])
            if el:
                try:
                    text = (await el.text_content()) or ""
                    digits = re.findall(r"\d+", text)
                    if digits:
                        return int(digits[-1])
                except Exception:
                    pass
        return -1

    async def _start_pcm(self) -> None:
        assert self.page
        for frame in self.page.frames:
            try:
                await frame.evaluate("window.__tmBotStartPcm && window.__tmBotStartPcm()")
            except Exception:
                continue

    async def _screenshot(self, tag: str) -> None:
        if not self.page or not self.debug:
            return
        try:
            path = self.session_dir / f"{tag}.png"
            await self.page.screenshot(path=str(path), full_page=False)
            self.say(f"Скриншот: {path}")
        except Exception:
            pass

    # ---------- вход ----------
    async def _join(self) -> None:
        assert self.page
        self.say(f"Открываю {self.url}")
        self.event("navigate", url=self.url)
        await self.page.goto(self.url, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(3)
        await self._screenshot("01-loaded")

        if await self._has_marker(INVALID_MARKERS):
            raise InvalidRoom("Телемост говорит, что такого звонка нет")

        # «Продолжить в браузере»
        clicked = await self._click_anywhere(CONTINUE_SELECTORS, timeout=6)
        if clicked:
            self.say("Нажал «Продолжить в браузере»")
            await asyncio.sleep(2)

        # Онбординг Телемоста 3.0
        await self._click_anywhere(ONBOARDING_SELECTORS, timeout=2)

        self.say("Жду экран гостя…")
        frame = await self._prejoin_frame(timeout=60)
        if not frame:
            await self._screenshot("02-no-prejoin")
            if await self._has_marker(INVALID_MARKERS):
                raise InvalidRoom("Телемост говорит, что такого звонка нет")
            raise JoinFailed("Не нашёл экран гостя с кнопкой «Подключиться»")
        if frame is not self.page.main_frame and "/private-join/" in frame.url:
            self.capture_path = "/private-join/"
        self.say(f"Экран гостя: {'фрейм private-join' if frame is not self.page.main_frame else 'основная страница'}")

        # Имя
        name_el = await self._first_visible(frame, NAME_SELECTORS)
        if name_el:
            try:
                await name_el.fill(self.name)
            except Exception:
                try:
                    await name_el.evaluate(
                        """(e, n) => {
                            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                            setter.call(e, n);
                            e.dispatchEvent(new Event('input', { bubbles: true }));
                            e.dispatchEvent(new Event('change', { bubbles: true }));
                        }""",
                        self.name,
                    )
                except Exception:
                    pass
            self.say(f"Имя: {self.name}")
        else:
            self.say("Поле имени не найдено — возможно, Телемост его не спрашивает")

        # Камеру НЕ выключаем: она должна транслировать аватар.
        # Микрофон НЕ жмём: init-скрипт уже отдаёт тишину, а UI-мьют может
        # сломать приём звука (известная грабля Телемоста).
        await self._start_pcm()
        await self._screenshot("03-prejoin")

        self.say("Нажимаю «Подключиться»…")
        el = await self._first_visible(frame, JOIN_SELECTORS)
        if not el:
            raise JoinFailed("Кнопка «Подключиться» исчезла")
        try:
            await el.click(timeout=5000)
        except Exception:
            await el.evaluate("e => e.click()")
        self.event("join_clicked")
        await asyncio.sleep(2)
        await self._screenshot("04-after-join")

    async def _start_intro(self) -> None:
        assert self.page
        started = False
        for frame in self.page.frames:
            try:
                ok = await frame.evaluate(
                    "() => { if (window.__tmBotStartIntro) { window.__tmBotStartIntro(); return true; } return false; }"
                )
            except Exception as error:
                self.say(f"Интро во фрейме не запустилось: {error}")
                continue
            started = started or bool(ok)
        self.intro_started = True
        if started:
            self.event("intro_started")
            self.say("Интро и голос запущены")
        else:
            self.event("intro_not_found")
            self.say("Не нашёл __tmBotStartIntro — интро не запущено")

    async def _wait_connected(self) -> None:
        assert self.page
        deadline = time.monotonic() + self.wait_timeout
        last_report = 0.0
        join_clicks = 0
        while time.monotonic() < deadline:
            if self.page.is_closed():
                raise JoinFailed("Страница закрылась до входа в комнату")
            if await self._has_marker(INVALID_MARKERS):
                raise InvalidRoom("Телемост говорит, что такого звонка нет")
            if await self._has_marker(END_MARKERS):
                raise JoinFailed("Встреча завершилась до подключения")

            st = await self._status()
            in_call = False
            for frame in self.page.frames:
                if await self._first_visible(frame, IN_CALL_SELECTORS):
                    in_call = True
                    break

            if st["tracks"] > 0 or in_call:
                self.connected = True
                if self.args.start_on_join and not self.intro_started:
                    await self._start_intro()
                self.event("connected", status=st)
                self.say(
                    f"В комнате: peer-соединений {st['connected']}, "
                    f"аудиодорожек {st['tracks']}, видео {st['video']['bytes']} байт"
                )
                return

            now = time.monotonic()
            if now - last_report > 10:
                waiting = await self._has_marker(WAITING_MARKERS)
                left = int(deadline - now)
                self.say(f"Ещё не в комнате ({'зал ожидания' if waiting else 'подключаюсь'}), осталось {left} с")
                last_report = now

            # Если кнопка входа всё ещё видна — пробуем нажать ещё раз (до 3 раз).
            if join_clicks < 3:
                frame = await self._prejoin_frame(timeout=0.2)
                if frame:
                    el = await self._first_visible(frame, JOIN_SELECTORS)
                    if el:
                        join_clicks += 1
                        try:
                            await el.click(timeout=3000)
                        except Exception:
                            pass
                        self.event("join_retry", attempt=join_clicks)
            await asyncio.sleep(2)

        if await self._has_marker(WAITING_MARKERS):
            raise WaitingRoomTimeout("Организатор так и не впустил из зала ожидания")
        raise JoinFailed("Не дождался входа в комнату")

    # ---------- транскрипция ----------
    async def _stt_loop(self) -> None:
        chunk_bytes = 16000 * 2 * self.chunk_seconds
        while self.running:
            await asyncio.sleep(1)
            for key in list(self.pcm_buffers):
                buf = self.pcm_buffers.get(key)
                while buf is not None and len(buf) >= chunk_bytes:
                    pcm = bytes(buf[:chunk_bytes])
                    del buf[:chunk_bytes]
                    await self._transcribe_chunk(pcm, key)

    async def _transcribe_chunk(self, pcm: bytes, track_key: str = "mix") -> None:
        if len(pcm) < 16000:  # меньше половины секунды — пропускаем
            return
        idx = self.chunk_idx.get(track_key, 0) + 1
        self.chunk_idx[track_key] = idx
        speaker = ""
        if track_key.startswith("track:"):
            names = await self._track_names()
            speaker = names.get(track_key.split(":", 1)[1], "")
        if speaker.strip().lower() == str(self.args.name).strip().lower():
            speaker = ""
        if not speaker:
            speaker = await self._active_speaker() or "Общий поток"
        if track_key.startswith("track:") and speaker == "Общий поток":
            speaker = "Участник " + track_key.rsplit(":", 1)[-1][-4:]
        seconds = len(pcm) / 32000
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", track_key)
        wav_path = self.audio_dir / f"chunk-{safe}-{idx:04d}.wav"
        wav_path.write_bytes(pcm16_to_wav(pcm))
        peak, rms = pcm_level(pcm)
        self.stats["audio_chunks"] += 1
        self.event("audio_chunk", track=track_key, speaker=speaker, index=idx,
                   seconds=round(seconds, 1), peak=peak, rms=round(rms, 1), path=str(wav_path))
        if peak < self.args.vad_peak or rms < self.args.vad_rms:
            self.stats["silence_chunks"] += 1
            self.event("silence_chunk", track=track_key, speaker=speaker, index=idx,
                       peak=peak, rms=round(rms, 1))
            return
        if self.transcriber.name == "none":
            return
        started = time.monotonic()
        try:
            text = await asyncio.to_thread(self.transcriber.transcribe, pcm)
        except Exception as e:
            self.stats["stt_errors"] += 1
            self.event("stt_error", track=track_key, speaker=speaker, index=idx, error=str(e))
            self.say(f"STT ошибка на куске {idx} ({speaker}): {e}")
            return
        self.stats["stt_calls"] += 1
        self.stats["stt_latency_total"] += time.monotonic() - started
        self.stats["stt_audio_seconds"] += seconds
        text = (text or "").strip()
        if not text:
            return
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] [{speaker}] {text}"
        self.transcript.write(line + "\n")
        self.transcript.flush()
        self.event("transcript", track=track_key, speaker=speaker, index=idx, text=text)
        self.say(f"[{speaker}] «{text}»")

    # ---------- основной цикл ----------
    async def _run_loop(self) -> None:
        assert self.page
        last_status = 0.0
        last_parts = 0.0
        zero_since: float | None = None
        alone_since: float | None = None
        while self.running:
            now = time.monotonic()
            if now - self.start_time > self.duration:
                self.say("Дошли до лимита длительности")
                self.stop_reason = "duration_limit"
                break
            if self.page.is_closed():
                self.say("Страница закрыта")
                self.stop_reason = "page_closed"
                break
            if await self._has_marker(END_MARKERS):
                self.say("Конференция завершена")
                self.stop_reason = "meeting_ended"
                break

            st = await self._status()
            if st["tracks"] > 0:
                self.had_remote = True
                zero_since = None
            elif self.had_remote:
                if zero_since is None:
                    zero_since = now
                elif now - zero_since >= 15:
                    self.say("Связь с конференцией пропала — останавливаюсь")
                    self.stop_reason = "connection_lost"
                    break

            if st["tracks"] == 0 and (self.had_remote or now - self.start_time > 20):
                if await self._has_marker(PREJOIN_MARKERS):
                    self.say("Телемост вернул на экран гостя — конференция закончилась")
                    self.stop_reason = "returned_to_prejoin"
                    break
                if await self._has_marker(WAITING_MARKERS):
                    self.say("Бот оказался в зале ожидания — останавливаюсь")
                    self.stop_reason = "waiting_room"
                    break

            if now - last_parts >= 5:
                parts = await self._participants()
                last_parts = now
                if parts > 1:
                    self.had_others = True
                    alone_since = None
                elif self.had_others and parts == 1:
                    if alone_since is None:
                        alone_since = now
                    elif now - alone_since >= 15:
                        self.say("В комнате не осталось участников — останавливаюсь")
                        self.stop_reason = "alone_in_room"
                        break

            if now - last_status >= 10:
                parts = await self._participants()
                self.say(
                    f"статус: участников={parts if parts >= 0 else '?'} "
                    f"дорожек={st['tracks']} pcm={self.pcm_total // 1024}КБ "
                    f"видео={st['video']['bytes'] // 1024}КБ "
                    f"{st['video']['width']}x{st['video']['height']} "
                    f"ctx={st['audioCtx']}"
                )
                v = st.get("video") or {}
                self.stats["max_video_bytes"] = max(self.stats["max_video_bytes"], v.get("bytes", 0))
                if v.get("width"):
                    self.stats["max_video_width"] = v["width"]
                if v.get("height"):
                    self.stats["max_video_height"] = v["height"]
                self.event("status", participants=parts, **st)
                last_status = now
            await asyncio.sleep(2)
        if self.stop_reason:
            self.event("conference_ended", reason=self.stop_reason)

    async def run(self) -> int:
        try:
            await self._launch()
            await self._join()
            await self._wait_connected()
            await self._dump_participants()
            stt_task = asyncio.create_task(self._stt_loop())
            try:
                await self._run_loop()
            finally:
                self.running = False
                await stt_task
                # дообработать хвост
                for key, buf in list(self.pcm_buffers.items()):
                    if len(buf) >= 16000:
                        await self._transcribe_chunk(bytes(buf), key)
                        buf.clear()
            st = self.stats
            calls = st["stt_calls"]
            summary = {
                "duration_sec": round(time.monotonic() - self.start_time, 1),
                "pcm_bytes": self.pcm_total,
                "audio_chunks": st["audio_chunks"],
                "silence_chunks": st["silence_chunks"],
                "stt_calls": calls,
                "stt_errors": st["stt_errors"],
                "avg_stt_latency_sec": round(st["stt_latency_total"] / calls, 2) if calls else None,
                "stt_audio_seconds": round(st["stt_audio_seconds"], 1),
                "video_bytes": st["max_video_bytes"],
                "video_width": st["max_video_width"],
                "video_height": st["max_video_height"],
                "stt_provider": self.transcriber.name,
                "stop_reason": self.stop_reason,
                "estimated_stt_cost_rub": round(
                    math.ceil(st["stt_audio_seconds"] / 15) * 0.1626, 2
                ) if self.transcriber.name == "yandex" else 0.0,
            }
            self.summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            self.event("summary", **summary)
            self.event("finished", pcm_bytes=self.pcm_total, stop_reason=self.stop_reason)
            return 0
        except InvalidRoom as e:
            self.event("invalid_room", error=str(e))
            self.say(f"Ошибка: {e}")
            return 2
        except WaitingRoomTimeout as e:
            self.event("waiting_room_timeout", error=str(e))
            self.say(f"Ошибка: {e}")
            return 3
        except JoinFailed as e:
            self.event("join_failed", error=str(e))
            self.say(f"Ошибка: {e}")
            return 4
        except Exception as e:
            self.event("error", error=str(e), traceback=traceback.format_exc())
            self.say(f"Неожиданная ошибка: {e}")
            return 1
        finally:
            await self._close()

    async def _close(self) -> None:
        self.running = False
        try:
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
        except Exception:
            pass
        try:
            for f in self.raw_files.values():
                f.close()
            self.events.close()
            self.transcript.close()
        except Exception:
            pass
        self.say(f"Итог: PCM {self.pcm_total // 1024} КБ, файлы в {self.session_dir}")


class InvalidRoom(RuntimeError):
    pass


class JoinFailed(RuntimeError):
    pass


class WaitingRoomTimeout(RuntimeError):
    pass



def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Телемост-бот: аватар + транскрипция")
    p.add_argument("--url", help="ссылка на встречу Телемоста")
    p.add_argument("--create", action="store_true", help="создать встречу через API и зайти")
    p.add_argument("--token", default=os.getenv("TELEMOST_OAUTH_TOKEN", ""), help="OAuth-токен Телемоста")
    p.add_argument("--waiting-room-level", default="PUBLIC", choices=["PUBLIC", "ORGANIZATION", "ADMINS"])
    p.add_argument("--auto-summarization", action="store_true")
    p.add_argument("--from-outlook", action="store_true", help="найти ссылку в Outlook")
    p.add_argument("--lookback-hours", type=int, default=24)
    p.add_argument("--from-ics", help="найти ссылку в ICS-файле")
    p.add_argument("--retry", type=int, default=1, help="сколько раз повторить вход при сбое")
    p.add_argument("--name", default="Vilar AI", help="имя бота в комнате")
    p.add_argument("--avatar-y4m", help="Y4M-файл для камеры (Chromium fake capture)")
    p.add_argument("--avatar-mp4", help="MP4-файл для камеры через canvas (динамичнее)")
    p.add_argument("--avatar-playlist", nargs="+", help="несколько MP4 для камеры, по очереди")
    p.add_argument("--black-screen", action="store_true", help="чёрный экран вместо аватара, микрофон молчит")
    p.add_argument("--headed", action="store_true", help="показать окно браузера")
    p.add_argument("--chrome", help="путь к Chrome/Chromium")
    p.add_argument("--out", default=str(ROOT / "out"), help="каталог сессии")
    p.add_argument("--duration", type=int, default=3600, help="макс. длительность, сек")
    p.add_argument("--wait-timeout", type=int, default=300, help="сколько ждать входа, сек")
    p.add_argument("--chunk-seconds", type=int, default=12, help="длина куска для STT, сек")
    p.add_argument("--stt", default="auto", choices=["auto", "none", "yandex", "groq"])
    p.add_argument("--vad-peak", type=int, default=100, help="порог пика для отправки в STT")
    p.add_argument("--vad-rms", type=float, default=10.0, help="порог RMS для отправки в STT")
    p.add_argument("--mock", action="store_true", help="фейковая комната для проверки входа")
    p.add_argument("--mic-tone", action="store_true", help="тестовый тон в микрофон вместо тишины")
    p.add_argument("--mic-file", help="WAV-файл в микрофон вместо тишины")
    p.add_argument("--mic-once", action="store_true", help="не зацикливать WAV микрофона")
    p.add_argument("--avatar-intro-count", type=int, default=0, help="сколько первых клипов проиграть один раз, затем цикл")
    p.add_argument("--start-on-join", action="store_true", help="запускать интро и голос после входа в комнату")
    p.add_argument("--tone-hz", type=int, default=440, help="частота тестового тона")
    p.add_argument("--tone-gain", type=float, default=0.05, help="громкость тестового тона")
    p.add_argument("--debug", action="store_true", help="скриншоты и логи браузера")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_env(ROOT / ".env")
    args = parse_args(argv)

    if not args.url:
        if args.create:
            token = args.token or os.getenv("TELEMOST_OAUTH_TOKEN", "")
            if not token:
                print("Нужен OAuth-токен: --token или TELEMOST_OAUTH_TOKEN", file=sys.stderr)
                return 2
            try:
                from create_meeting import create_meeting
                data = create_meeting(token, args.waiting_room_level, args.auto_summarization)
            except Exception as e:
                print("Не удалось создать встречу:", e, file=sys.stderr)
                return 1
            args.url = data["join_url"]
            print("Создана встреча:", args.url, flush=True)
        elif args.from_outlook:
            try:
                from find_link import find_in_outlook
                links = find_in_outlook(args.lookback_hours)
            except Exception as e:
                print("Не удалось прочитать Outlook:", e, file=sys.stderr)
                return 1
            if not links:
                print("Ссылка Телемоста не найдена", file=sys.stderr)
                return 2
            args.url = links[0]
            print("Нашёл ссылку:", args.url, flush=True)
        elif args.from_ics:
            try:
                from find_link import find_in_ics
                links = find_in_ics(args.from_ics)
            except Exception as e:
                print("Не удалось прочитать ICS:", e, file=sys.stderr)
                return 1
            if not links:
                print("Ссылка Телемоста не найдена", file=sys.stderr)
                return 2
            args.url = links[0]
            print("Нашёл ссылку:", args.url, flush=True)
        else:
            print("Нужен --url, --create, --from-outlook или --from-ics", file=sys.stderr)
            return 2

    if not re.match(r"^https://telemost\.(yandex\.(ru|com)|360\.yandex\.ru)/", args.url):
        print("Нужна ссылка вида https://telemost.yandex.ru/j/...", file=sys.stderr)
        return 2

    async def runner() -> int:
        bot = TelemostBot(args)
        return await bot.run()

    try:
        code = 0
        for attempt in range(args.retry + 1):
            code = asyncio.run(runner())
            if code in (0, 2, 3):
                break
            if attempt < args.retry:
                print(f"Повтор входа {attempt + 1}/{args.retry}...", flush=True)
                time.sleep(5)
        return code
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

