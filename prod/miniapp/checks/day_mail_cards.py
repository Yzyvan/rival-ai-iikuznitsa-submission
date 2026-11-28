"""Chromium regressions for task reply attribution and mail delivery labels."""
import os
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


class CardChecks(unittest.TestCase):
    def setUp(self):
        dist = Path(__file__).resolve().parents[1] / "dist"
        self.assertTrue((dist / "index.html").is_file(), "Run npm run build first")
        http = self.enterContext(ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=dist)))
        thread = Thread(target=http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(http.shutdown)
        self.origin = f"http://127.0.0.1:{http.server_port}"
        pw = self.enterContext(sync_playwright())
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM_EXECUTABLE_PATH"))
        self.addCleanup(browser.close)
        self.page = browser.new_page()
        self.page.add_init_script("window.Telegram={WebApp:{initData:'fixture'}}")
        self.responses = {}
        self.page.route("**/*", self.respond)
        self.dialog = self.page.get_by_role("dialog")

    def respond(self, route):
        url = urlsplit(route.request.url)
        if not route.request.url.startswith(self.origin + "/"):
            return route.abort()
        if url.path in self.responses:
            return route.fulfill(json=self.responses[url.path])
        if url.path.startswith(("/api/", "/vilar-contest/", "/tracker/", "/me/")):
            return route.fulfill(status=404, json={})
        return route.continue_()

    def test_reply_belongs_to_one_task(self):
        tasks = [{"id": key, "title": key, "status": "done"} for key in ("First", "Second")]
        reply = {"task_id": "Second", "body": "Ответ исполнителя"}
        self.responses["/vilar-contest/api/day"] = {"queue": tasks, "reply": reply}

        def check(task, visible):
            self.page.goto(self.origin + "/?open=board:approvals")
            self.page.get_by_text(task, exact=True).click()
            expect(self.dialog.get_by_role("heading", name=task)).to_be_visible()
            answer = self.dialog.get_by_text(reply["body"], exact=True)
            if visible:
                expect(answer).to_be_visible()
            else:
                expect(answer).to_have_count(0)

        check("First", False)
        check("Second", True)
        del reply["task_id"]
        check("First", False)
        check("Second", False)
        tasks.pop(0)
        check("Second", True)

    def test_saved_draft_and_sent_reply(self):
        ticket = {"id": "d-test", "type": "mail", "title": "Письмо", "summary": "Сводка",
                  "from": None, "source": {"kind": "mail"}, "outcome": "delegated", "state": "done",
                  "done": "Передано исполнителю", "draft": "Текст в тикете", "actions": [], "version": 1}
        self.responses["/api/front/v1/mail"] = {"items": [ticket], "next_cursor": None}
        self.responses["/api/front/v1/mail/d-test"] = ticket
        self.responses["/api/owner/document"] = {"text": "Сохранённый черновик", "version": "1", "body": "Оригинал"}
        url = self.origin + "/?open=mail:d-test"
        self.page.goto(url)
        expect(self.dialog.get_by_text("Сводка", exact=True)).to_be_visible()
        expect(self.dialog.get_by_text("Оригинал", exact=True)).to_be_hidden()
        self.dialog.get_by_text("Полный текст письма").click()
        expect(self.dialog.get_by_text("Оригинал", exact=True)).to_be_visible()
        expect(self.dialog.get_by_text("Передано исполнителю")).to_be_visible()
        expect(self.dialog.get_by_text("Сохранённый черновик")).to_be_visible()
        expect(self.dialog.get_by_text("Vilar ответил")).to_have_count(0)
        ticket.update(outcome="auto", state="sent", receipt={"state": "sent"}, done=None)
        self.page.reload()
        expect(self.dialog.get_by_text("Vilar ответил")).to_be_visible()
        expect(self.dialog.get_by_text("Текст в тикете")).to_be_visible()
        expect(self.dialog.get_by_text("Сохранённый черновик")).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
