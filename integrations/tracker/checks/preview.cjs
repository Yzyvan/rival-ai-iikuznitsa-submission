// Build the preview first. Install Playwright and Chromium, then run "node checks/preview.cjs".
// A custom browser or Playwright installation can be set with CHROMIUM_PATH or PLAYWRIGHT_MODULE.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const dist = path.resolve(process.argv[2] || path.join(__dirname, "../dist"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const assets = new Map([["/", path.join(dist, "index.html")]]);
for (const name of fs.readdirSync(path.join(dist, "assets"))) {
  if (mime[path.extname(name)]) assets.set("/assets/" + name, path.join(dist, "assets", name));
}

function button(container, name) {
  return container.getByRole("button", { name, exact: true });
}

function column(page, title) {
  return page.locator("section").filter({ has: page.getByText(title, { exact: true }) });
}

function task(container, name) {
  return container.getByRole("button").filter({ hasText: name });
}

async function create(page, kind, name, fill) {
  await button(column(page, "Новые"), "Добавить").click();
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await button(dialog, kind).click();
  await dialog.getByRole("textbox", { name: "Название" }).fill(name);
  if (fill) await fill(dialog);
  await button(dialog, "Создать задачу").click();
  await dialog.waitFor({ state: "hidden" });
  await task(column(page, "Новые"), name).waitFor();
}

async function open(page, name, inColumn = "Новые") {
  await task(column(page, inColumn), name).click();
  const dialog = page.getByRole("dialog", { name });
  await dialog.getByRole("heading", { name, exact: true }).waitFor();
  return dialog;
}

async function close(dialog) {
  await button(dialog, "Закрыть").click();
  await dialog.waitFor({ state: "hidden" });
}

// The browser holds a task and moves towards the previous visible column until the board slides under it.
async function dragLeft(page, name) {
  const card = task(column(page, "Новые"), name);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  const viewport = page.viewportSize();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const dropX = Math.round(viewport.width * 0.17);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.locator(".drag-float").waitFor();
  await page.mouse.move(dropX, y, { steps: 3 });
  const next = column(page, "В работе");
  await next.evaluate(
    (section, pointerX) =>
      new Promise((resolve, reject) => {
        const deadline = performance.now() + 3000;
        function check() {
          const bounds = section.getBoundingClientRect();
          if (bounds.left < pointerX && pointerX < bounds.right) return resolve();
          if (performance.now() >= deadline)
            return reject(new Error("The neighbouring column did not move into view"));
          requestAnimationFrame(check);
        }
        check();
      }),
    dropX
  );
  await page.mouse.up();
  await task(next, name).waitFor();
}

async function exercise(page) {
  const assignment = "Разобрать иллюстрации";
  let person;
  await create(page, "Поручение", assignment, async (dialog) => {
    const assignee = dialog.getByRole("combobox", { name: "Ответственный" });
    await assignee.selectOption({ index: 1 });
    person = await assignee.locator("option:checked").innerText();
  });
  let dialog = await open(page, assignment);
  await dialog.getByText(person, { exact: true }).first().waitFor();
  await close(dialog);

  await create(page, "Задача по проекту", "Напечатать обложку", async (form) => {
    await form.getByRole("textbox", { name: "Проект" }).fill("Летний альбом");
    await form.getByRole("combobox", { name: "Ответственный" }).selectOption({ index: 1 });
  });
  dialog = await open(page, "Напечатать обложку");
  await dialog.getByText("Летний альбом", { exact: true }).waitFor();
  await close(dialog);

  await create(page, "Встреча", "Обсудить цвет бумаги", async (form) => {
    await form.getByRole("listbox", { name: "Участники" }).selectOption([{ index: 0 }, { index: 1 }]);
    await form.getByLabel("Дедлайн", { exact: true }).fill("2031-05-15");
    await form.getByLabel("Время", { exact: true }).fill("11:00");
    await form.getByRole("combobox", { name: "Длительность, минут" }).selectOption({ label: "45" });
    await form.getByRole("checkbox", { name: "Видеозвонок" }).check();
  });
  dialog = await open(page, "Обсудить цвет бумаги");
  await dialog.getByText("45 мин", { exact: true }).waitFor();
  await dialog.getByText("Видеозвонок", { exact: true }).waitFor();
  await close(dialog);

  await create(page, "Напомнить себе", "Забрать пробный оттиск", (form) =>
    form.getByRole("checkbox", { name: "Напоминание" }).check()
  );
  dialog = await open(page, "Забрать пробный оттиск");
  await dialog.getByText("Включено", { exact: true }).waitFor();
  await close(dialog);
  console.log("PASS: opened all four forms, created and read four different cards");

  await dragLeft(page, assignment);
  dialog = await open(page, assignment, "В работе");
  await dialog.getByRole("combobox", { name: "Переместить в колонку" }).selectOption({ label: "Готово" });
  await button(dialog, "Переместить").click();
  await dialog.getByText("Выполнено", { exact: true }).waitFor();
  await close(dialog);
  await task(column(page, "Готово"), assignment).waitFor();
  await task(column(page, "Новые"), "Напечатать обложку").waitFor();
  console.log("PASS: pointer drag and accessible move changed the selected card and preserved its neighbour");

  await button(page, "Фильтр").click();
  await page.getByLabel("Поиск задач").fill("цвет бумаги");
  await task(column(page, "Новые"), "Напечатать обложку").waitFor({ state: "detached" });
  await task(column(page, "Новые"), "Обсудить цвет бумаги").waitFor();
  await button(page, "Сбросить фильтры").click();
  await task(column(page, "Новые"), "Напечатать обложку").waitFor();
  console.log("PASS: search and reset");

  dialog = await open(page, "Напечатать обложку");
  await button(dialog, "Изменить задачу").click();
  await dialog.getByRole("textbox", { name: "Название" }).fill("Проверить корешок альбома");
  await button(dialog, "Сохранить изменения").click();
  dialog = page.getByRole("dialog", { name: "Проверить корешок альбома" });
  await button(dialog, "Перенести срок").click();
  await dialog.getByLabel("Новый срок", { exact: true }).fill("2031-05-21");
  await dialog.getByLabel("Новое время", { exact: true }).fill("13:15");
  await button(dialog, "Сохранить срок").click();
  await dialog.getByText(/13:15/).waitFor();
  await button(dialog, "Напомнить исполнителю").click();
  await dialog.getByText("Напоминаний", { exact: true }).waitFor();
  await close(dialog);
  await create(page, "Напомнить себе", "Черновик для отмены");
  await button(page, "Отменить создание").click();
  await task(column(page, "Новые"), "Черновик для отмены").waitFor({ state: "detached" });
  console.log("PASS: edit, change of deadline, reminder and undo");
}

async function run() {
  const violations = [],
    errors = [];
  const served = new Set();
  const server = http.createServer((req, res) => {
    const file = assets.get(req.url);
    if (!file || req.method !== "GET") {
      violations.push("unexpected HTTP request " + req.method + " " + req.url);
      res.writeHead(404).end();
      return;
    }
    served.add(req.url);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)], "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    const context = await browser.newContext({ viewport: { width: 430, height: 920 } });
    await context.route("**/*", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (
        url.origin === origin &&
        assets.has(url.pathname) &&
        req.method() === "GET" &&
        ["document", "script", "stylesheet"].includes(req.resourceType())
      )
        return route.continue();
      violations.push(req.method() + " " + req.resourceType() + " " + url.pathname);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", () => violations.push("WebSocket"));
    // Record attempts even if blocked by the browser before a request reaches the server.
    await page.exposeFunction("recordPreviewNetworkAttempt", (type) => violations.push(type));
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        window.recordPreviewNetworkAttempt("fetch");
        return originalFetch(...args);
      };
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) {
        window.recordPreviewNetworkAttempt("XMLHttpRequest");
        return originalOpen.apply(this, args);
      };
    });
    await page.goto(origin);
    const sampleButtons = column(page, "Новые").getByRole("button");
    await sampleButtons.first().waitFor();
    const initial = await sampleButtons.allTextContents();
    await exercise(page);
    await page.reload();
    await sampleButtons.first().waitFor();
    assert.deepEqual(await sampleButtons.allTextContents(), initial);
    assert.equal(await task(column(page, "Готово"), "Разобрать иллюстрации").count(), 0);
    console.log("PASS: reloading returns the preview to the initial example");
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, []);
    assert.ok(
      served.has("/") &&
        [...served].some((url) => url.endsWith(".js")) &&
        [...served].some((url) => url.endsWith(".css"))
    );
    console.log("PASS: only " + served.size + " local build files, zero data requests or external connections");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
