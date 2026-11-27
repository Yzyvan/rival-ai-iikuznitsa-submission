"""After npm run build, run this file with Python Playwright and Chromium installed."""

import os
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


class OutlookProfile(unittest.TestCase):
    def test_independent_statuses_retry_and_disconnect(self):
        dist = Path(__file__).resolve().parents[1] / "dist"
        self.assertTrue((dist / "index.html").is_file(), "Build the Mini App first")
        server = self.enterContext(
            ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=dist))
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        origin = f"http://127.0.0.1:{server.server_port}"

        pw = self.enterContext(sync_playwright())
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM_EXECUTABLE_PATH"))
        self.addCleanup(browser.close)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.add_init_script("window.Telegram = {WebApp: {initData: 'fixture=profile'}};")
        state = {"mail": "connected", "calendar": "error", "can_manage": False}
        calls = []

        def respond(route):
            req = route.request
            path = urlsplit(req.url).path
            if not req.url.startswith(origin + "/"):
                return route.abort()
            if not path.startswith("/me/connections"):
                return route.continue_()
            calls.append((req.method, path, req.headers.get("authorization")))
            if (req.method, path) == ("POST", "/me/connections/check"):
                if state["calendar"] == "error" and len([c for c in calls if c[0] == "POST"]) == 1:
                    return route.fulfill(status=429, json={"detail": "graph_request_failed"})
                state["calendar"] = "connected"
            elif (req.method, path) == ("DELETE", "/me/connections/microsoft"):
                state.update(mail="needs_login", calendar="needs_login")
            elif (req.method, path) != ("GET", "/me/connections"):
                return route.fulfill(status=404)
            return route.fulfill(json=state)

        page.route("**/*", respond)
        page.goto(origin + "/?screen=profile")
        mail = page.locator(".onb-card").filter(has_text="Почта Outlook")
        calendar = page.locator(".onb-card").filter(has_text="Календарь Outlook")
        expect(mail).to_contain_text("Подключено")
        expect(calendar).to_contain_text("Ошибка доступа")
        check = page.get_by_role("button", name="Проверить доступ")
        check.click()
        expect(page.get_by_role("alert")).to_contain_text("Microsoft ограничил запросы")
        check.click()
        expect(calendar).to_contain_text("Подключено")
        expect(mail).to_contain_text("Подключено")
        expect(page.get_by_role("alert")).to_have_count(0)
        page.get_by_role("button", name="Отключить Microsoft").click()
        expect(mail).to_contain_text("Требуется вход")
        expect(calendar).to_contain_text("Требуется вход")
        page.reload()
        expect(mail).to_contain_text("Требуется вход")
        expect(page.get_by_role("button", name="Войти в Microsoft")).to_be_visible()
        writes = [(method, path) for method, path, _ in calls if method != "GET"]
        self.assertEqual(
            writes,
            [("POST", "/me/connections/check")] * 2 + [("DELETE", "/me/connections/microsoft")],
        )
        self.assertTrue(all(auth == "tma fixture=profile" for _, _, auth in calls))


if __name__ == "__main__":
    unittest.main(verbosity=2)
