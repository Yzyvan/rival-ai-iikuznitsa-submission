// Drive the real HTTP bindings against deterministic responses. No running service is needed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const origin = "http://tracker.example.test";
const dist = path.resolve(__dirname, "../dist");
const examples = require("../../../contracts/v1/priorities.examples.json");
const files = new Map([["/", ["index.html", "text/html"]]]);
for (const file of fs.readdirSync(path.join(dist, "assets"))) {
  if (/\.(js|css)$/.test(file)) {
    files.set("/assets/" + file, ["assets/" + file, file.endsWith(".css") ? "text/css" : "text/javascript"]);
  }
}
const draft = {
  id: "demo-card",
  work_id: "demo-work",
  title: "Согласовать время встречи",
  assignee_person_id: "demo-person",
  assignee_name: "Участник примера",
  reviewer_name: "Автор примера",
  column: "new",
  kind: "assign",
  native: true,
  version: 1,
  result_version: 0,
  status: "open",
  due_date: null,
  due_time: null,
  project: null,
  participant_ids: [],
  duration_minutes: null,
  reminder: false,
  video_call: false,
  allowed_columns: ["new", "in_progress", "done"],
  can_edit: true,
  can_reschedule: true,
  can_remind: true,
  reminder_count: 0,
  last_reminded_at: null,
};

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
    page.setDefaultTimeout(8000);
    let stored,
      attempt,
      reads = 0,
      moveAttempts = 0;
    const action = {
      action_id: "demo-card~review", step_id: draft.id, title: "Принять реестр",
      kind: "review", reason_text: "Редактор ждёт согласования", version: 1, due_at: "2027-06-06",
    };
    let example = null, detailExample = null;
    let queueState = "ready", cardAllowed = true, listing = "list-1", choices = 0;
    let settings = { version: 0, enabled: false, settings: null, proposal: null };
    const controls = [];
    const keys = [],
      problems = [];
    await page.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname;
      if (url.origin === origin && files.has(p)) {
        const [name, contentType] = files.get(p);
        return route.fulfill({ contentType, body: fs.readFileSync(path.join(dist, name)) });
      }
      const reply = (json, status = 200) => route.fulfill({ json, status });
      if (url.origin === origin && req.method() === "GET") {
        if (p === "/tracker/api/priority-settings") return reply(settings);
        if (detailExample && p === detailExample.request.replace("GET /v1/", "/tracker/api/"))
          return reply(detailExample.body, detailExample.http_status);
        if (p === "/tracker/api/priorities") {
          if (example) return reply(example.body, example.http_status);
          if (queueState === "pending") return reply({ status: "pending", actions: [] }, 202);
          return reply({ status: "ready", list_id: listing, feedback_enabled: settings.enabled,
            actions: cardAllowed ? [action] : [] });
        }
        if (p === "/tracker/api/priorities/" + action.action_id)
          return cardAllowed ? reply(action) : reply({ error: { code: "unknown_action" } }, 404);
        if (p === "/tracker/api/tasks") return reply({ rows: stored ? [stored] : [], can_create: true });
        if (p === "/tracker/api/people")
          return reply({
            rows: [{ id: draft.assignee_person_id, name: draft.assignee_name }],
            self_id: "demo-author",
          });
        if (p === "/tracker/api/tasks/" + draft.id) {
          reads++;
          return reply(stored);
        }
      }
      if (url.origin === origin && req.method() === "POST") {
        if (p === "/tracker/api/priority-settings") {
          const input = req.postDataJSON();
          const key = await req.headerValue("Idempotency-Key");
          controls.push({ key, input });
          if (input.expected_version !== settings.version) return reply({}, 409);
          if (input.operation === "propose") settings.proposal = input.settings;
          if (input.operation === "confirm") {
            settings.settings = settings.proposal;
            settings.proposal = null;
            settings.enabled = true;
          }
          if (input.operation === "revoke") settings = { ...settings, settings: null, proposal: null, enabled: false };
          settings.version++;
          return reply({ version: settings.version, enabled: settings.enabled });
        }
        if (p === "/tracker/api/priority-feedback") {
          choices++;
          const input = req.postDataJSON();
          if (!await req.headerValue("Idempotency-Key") || input.choice !== "choose" ||
              input.action_id !== action.action_id || input.expected_version !== action.version ||
              input.list_id !== listing) problems.push("invalid feedback");
          listing = "list-2";
          action.version++;
          action.title = "Проверить новую редакцию";
          return reply({}, 409);
        }
        if (p === "/tracker/api/tasks") {
          keys.push(await req.headerValue("Idempotency-Key"));
          if (!stored) {
            stored = { ...draft };
            attempt = req.postDataJSON();
            return reply({ error: { code: "unavailable" } }, 503);
          }
          if (JSON.stringify(req.postDataJSON()) !== JSON.stringify(attempt)) problems.push("changed retry body");
          return reply(stored, 201);
        }
        if (p === "/tracker/api/tasks/" + draft.id + "/move") {
          moveAttempts++;
          const body = req.postDataJSON();
          if (body.expected_version !== 1 || body.column !== "in_progress") problems.push("unexpected move");
          stored = { ...stored, version: 2, column: "done", status: "completed" };
          return reply({ error: { code: "version_conflict" } }, 409);
        }
      }
      problems.push(req.method() + " " + p);
      return route.abort();
    });
    await page.goto(origin + "/?mode=connected");
    await page.locator('section[data-column="new"]').getByRole("button", { name: "Добавить" }).click();
    const form = page.getByRole("dialog", { name: "Новая задача" });
    await form.getByLabel("Название", { exact: true }).fill(draft.title);
    await form.getByLabel(/^Ответственный/).selectOption(draft.assignee_person_id);
    await form.getByRole("button", { name: "Создать задачу" }).click();
    await form.getByRole("alert").waitFor();
    await form.getByRole("button", { name: "Создать задачу" }).click();
    await form.waitFor({ state: "hidden" });
    assert.equal(keys.length, 2);
    assert.ok(keys[0]);
    assert.equal(keys[0], keys[1]);
    const card = page.locator('[data-task-id="' + draft.id + '"] button');
    await card.click();
    const detail = page.getByRole("dialog", { name: draft.title });
    await detail.getByText(draft.assignee_name, { exact: true }).waitFor();
    assert.ok(reads >= 1);
    const before = reads;
    await detail.getByLabel("Переместить в колонку").selectOption("in_progress");
    await detail.getByRole("button", { name: "Переместить", exact: true }).click();
    await detail.getByText("Выполнено", { exact: true }).waitFor();
    assert.ok(reads > before);
    assert.equal(moveAttempts, 1);
    await detail.getByRole("button", { name: "Закрыть" }).click();
    await page.getByRole("button", { name: "Мои решения" }).click();
    const queue = page.getByRole("dialog", { name: "Мои решения" });
    const current = () => queue.getByRole("button", { name: new RegExp(action.title) });
    const button = name => queue.getByRole("button", { name, exact: true });
    await current().waitFor();
    queueState = "pending";
    await button("Обновить решения").click();
    await queue.getByText("Обновляем решения…").waitFor();
    assert.equal(await queue.getByText(action.title).count(), 0);
    queueState = "ready";
    await current().click();
    await queue.getByText(action.reason_text).waitFor();
    assert.equal(await button("Выбрать сейчас").count(), 0);
    await button("Открыть поручение").click();
    await detail.waitFor();
    await detail.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: "Мои решения" }).click();
    await button("Настройки персонализации").click();
    await button("Настроить журнал").click();
    await queue.getByLabel("Хранить журнал, дней").fill("14");
    await button("Подготовить настройки").click();
    await queue.getByText("14 дн.").waitFor();
    assert.equal(settings.enabled, false);
    await button("Подтвердить и включить журнал").click();
    await queue.getByText("Теневой журнал включён.").waitFor();
    await button("К списку решений").click();
    await current().click();
    await button("Выбрать сейчас").click();
    await queue.getByRole("button", { name: /Проверить новую редакцию/ }).waitFor();
    assert.equal(choices, 1);
    cardAllowed = false;
    await current().click();
    await queue.getByRole("alert").waitFor();
    assert.equal(await queue.getByText(action.title).count(), 0);
    assert.equal(await button("Открыть поручение").count(), 0);
    await button("К списку решений").click();
    await queue.getByText("Сейчас от вас не требуется решений.").waitFor();
    await button("Настройки персонализации").click();
    await button("Отозвать согласие").click();
    await button("Подтвердить отзыв").click();
    await queue.getByText("Теневой журнал выключен.").waitFor();
    assert.deepEqual(controls.map(({input}) => [input.operation, input.expected_version]),
      [["propose", 0], ["confirm", 1], ["revoke", 2]]);
    assert.ok(controls.every(({key}) => key));
    console.log("PASS: pending removed stale cards; detail rechecked access; feedback conflict refreshed queue; versioned consent lifecycle");
    await button("К списку решений").click();
    const lists = examples.filter(item => item.request === "GET /v1/priorities");
    for (const item of lists) {
      example = item;
      await button("Обновить решения").click();
      if (example.body.actions.length === 0)
        await queue.getByText("Сейчас от вас не требуется решений.").waitFor();
      for (const item of example.body.actions) {
        await queue.getByRole("button").filter({ hasText: item.title }).getByText(item.reason_text).waitFor();
      }
    }
    detailExample = examples.find(item => item.http_status === 404);
    const revokedId = detailExample.request.split("/").pop();
    example = lists.find(item => item.body.actions.some(action => action.action_id === revokedId));
    await button("Обновить решения").click();
    await queue.getByRole("button").filter({ hasText: example.body.actions[0].title }).click();
    await queue.getByRole("alert").waitFor();
    assert.equal(await button("Открыть поручение").count(), 0);
    assert.deepEqual(problems, []);
    console.log("PASS: all five shared v1 queue and detail examples rendered");
    console.log(
      "PASS: real HTTP client repeated one create key/body after 503, read the selected ID, and refreshed after 409",
    );
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
