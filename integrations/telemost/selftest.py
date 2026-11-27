#!/usr/bin/env python3
"""Самопроверка без Телемоста: камера, микрофон-тишина и перехват WebRTC-звука.

Поднимает локальную страницу, которая:
  * берёт getUserMedia (fake-устройства Chromium);
  * делает loopback между двумя RTCPeerConnection с осциллятором 440 Гц.

Проверяем, что init-скрипт:
  * отдал живую видеодорожку;
  * подменил микрофон на тишину;
  * перехватил удалённую аудиодорожку и начал отдавать PCM.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent

HTML = """<!doctype html>
<meta charset="utf-8">
<title>tm selftest</title>
<video id="v" autoplay muted playsinline style="width:320px;height:180px;background:#000"></video>
<script>
(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    window.__gum = {
      video: s.getVideoTracks().map(t => ({state: t.readyState, label: t.label})),
      audio: s.getAudioTracks().map(t => ({state: t.readyState, label: t.label}))
    };
    const v = document.getElementById('v');
    v.srcObject = s;
    await v.play().catch(() => {});
    window.__tmBotStartPcm();

    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();

    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {});
    pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate).catch(() => {});
    pc2.ontrack = e => { window.__remoteTrack = e.track.kind; };
    pc1.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
    await pc1.setLocalDescription(await pc1.createOffer());
    await pc2.setRemoteDescription(pc1.localDescription);
    await pc2.setLocalDescription(await pc2.createAnswer());
    await pc1.setRemoteDescription(pc2.localDescription);
    window.__loopbackReady = true;
  } catch (e) {
    window.__error = String(e);
  }
})();
</script>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def start_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


async def main() -> int:
    srv, port = start_server()
    inject = (ROOT / "telemost_inject.js").read_text(encoding="utf-8")
    cfg = {"videoUrl": "", "micMode": "silence", "debug": True}
    script = f"window.__TELEMOST_BOT_CONFIG__ = {json.dumps(cfg)};\n" + inject

    pcm = {"bytes": 0, "calls": 0}

    def on_pcm(b64: str):
        data = base64.b64decode(b64)
        pcm["bytes"] += len(data)
        pcm["calls"] += 1

    ok = True
    chrome = os.getenv("CHROME_PATH", "")
    if not chrome:
        for candidate in (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
        ):
            if Path(candidate).exists():
                chrome = candidate
                break

    async with async_playwright() as pw:
        launch_kwargs = dict(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--mute-audio"],
        )
        if chrome:
            launch_kwargs["executable_path"] = chrome
        browser = await pw.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(
            permissions=["camera", "microphone"],
            locale="ru-RU",
            viewport={"width": 640, "height": 360},
        )
        await ctx.add_init_script(script=script)
        page = await ctx.new_page()
        await page.expose_function("__tmBotPcm", on_pcm)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(f"http://127.0.0.1:{port}/")
        await asyncio.sleep(5)

        result = await page.evaluate(
            """async () => {
                const v = document.getElementById('v');
                const st = await (window.__tmBotStatus ? window.__tmBotStatus() : Promise.resolve(null));
                return {
                  gum: window.__gum || null,
                  error: window.__error || null,
                  loopback: !!window.__loopbackReady,
                  remote: window.__remoteTrack || null,
                  videoWidth: v.videoWidth,
                  videoHeight: v.videoHeight,
                  readyState: v.readyState,
                  status: st,
                };
            }"""
        )
        await page.screenshot(path=str(ROOT / "out-selftest.png"))
        await browser.close()

    srv.shutdown()

    print("=== SELFTEST ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("pcm:", pcm)
    if errors:
        print("pageerrors:", errors)

    def check(name: str, cond: bool):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name)
        ok = ok and cond

    check("getUserMedia вернул видеодорожку", bool(result.get("gum") and result["gum"].get("video")))
    check("getUserMedia вернул аудиодорожку", bool(result.get("gum") and result["gum"].get("audio")))
    check("видео живое (readyState>=2, ширина>0)", result.get("readyState", 0) >= 2 and result.get("videoWidth", 0) > 0)
    check("loopback-звонок создан", bool(result.get("loopback")))
    check("удалённая аудиодорожка получена", result.get("remote") == "audio")
    st = result.get("status") or {}
    check("перехватчик видит аудиодорожку", st.get("tracks", 0) >= 1)
    check("PCM пошёл в Python", pcm["bytes"] > 0 and pcm["calls"] > 0)
    check("нет ошибок страницы", not result.get("error") and not errors)

    print("SELFTEST_PASS" if ok else "SELFTEST_FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
