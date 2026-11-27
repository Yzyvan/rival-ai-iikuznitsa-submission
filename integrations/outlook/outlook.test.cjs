const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const test = require("node:test");

async function mailbox(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outlook-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // The launcher and its MCP dependency run normally, with a clean config and working directory.
  const wrapper = path.join(dir, "outlook");
  await fs.copyFile(path.join(__dirname, "outlook"), wrapper);
  await fs.symlink(path.join(__dirname, "node_modules"), path.join(dir, "node_modules"), "dir");
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir,
    VILAR_OUTLOOK_ACCOUNT: "qa@example.invalid" };
  return { wrapper, env };
}

test("permissions and startup for a mailbox with no cached login", async (t) => {
  const { wrapper, env } = await mailbox(t);
  const options = { env, timeout: 15000, encoding: "utf8" };
  const permissions = spawnSync(wrapper, ["permissions"], options);
  assert.equal(permissions.status, 0, permissions.stderr);
  const settings = JSON.parse(permissions.stdout);
  assert.equal(settings.mode, "personal");
  assert.deepEqual(settings.allowedScopes.sort(), ["Mail.ReadWrite", "Mail.Send", "User.Read"]);
  assert.deepEqual(settings.missingAllowedScopesForTools, []);
  const start = spawnSync(wrapper, ["serve"], options);
  assert.equal(start.status, 1, start.stderr);
  assert.ok(start.stderr.includes(env.VILAR_OUTLOOK_ACCOUNT), start.stderr);
  assert.match(start.stderr, /--login/);
});

test("five Outlook tools call the expected Graph routes over MCP stdio", async (t) => {
  const { wrapper, env } = await mailbox(t);
  const requests = [];
  let reply;
  const graph = http.createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    const raw = Buffer.concat(parts).toString("utf8");
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
      body: raw ? JSON.parse(raw) : undefined });
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(reply.body && JSON.stringify(reply.body));
  });
  graph.listen(0, "127.0.0.1");
  await once(graph, "listening");
  t.after(() => new Promise((resolve) => graph.close(resolve)));

  const token = "local-graph-fixture";
  const child = spawn(wrapper, ["serve"], { env: { ...env, MS365_MCP_OAUTH_TOKEN: token,
    MS365_MCP_GRAPH_BASE_URL: "http://127.0.0.1:" + graph.address().port }, timeout: 25000 });
  const closed = once(child, "close");
  t.after(async () => { child.kill(); await closed; });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  function send(message) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }
  async function request(method, params) {
    send({ id: ++id, method, params });
    for (;;) {
      const line = await lines.next();
      assert.ok(!line.done, "MCP server closed stdout: " + stderr);
      const message = JSON.parse(line.value);
      if (message.id !== id) continue;
      assert.ok(!message.error, JSON.stringify(message.error));
      return message.result;
    }
  }
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {},
    clientInfo: { name: "outlook-contract-test", version: "1" } });
  send({ method: "notifications/initialized" });
  const { tools } = await request("tools/list", {});
  const draft = { subject: "Черновик", body: { contentType: "text", content: "Тест" } };
  const cases = [
    { name: "list-mail-folder-messages", args: { mailFolderId: "inbox", top: 1 },
      path: "/me/mailFolders/inbox/messages", top: "1", response: { value: [{ id: "mail-1" }] } },
    { name: "get-mail-message", args: { messageId: "mail-1" }, path: "/me/messages/mail-1",
      response: { id: "mail-1", subject: "Входящее" } },
    { name: "create-draft-email", args: { body: draft, confirm: true }, method: "POST",
      path: "/me/messages", body: draft, status: 201, response: { id: "draft-1", isDraft: true } },
    { name: "create-reply-draft", args: { messageId: "mail-1", body: { comment: "Ответ" }, confirm: true },
      method: "POST", path: "/me/messages/mail-1/createReply", body: { comment: "Ответ" },
      status: 201, response: { id: "reply-1", isDraft: true } },
    { name: "send-draft-message", args: { messageId: "reply-1", confirm: true },
      method: "POST", path: "/me/messages/reply-1/send", status: 202 },
  ];
  assert.deepEqual(tools.map((tool) => tool.name).sort(), cases.map((c) => c.name).sort());
  for (const c of cases) {
    reply = { status: c.status || 200, body: c.response };
    const result = await request("tools/call", { name: c.name, arguments: c.args });
    assert.ok(!result.isError, c.name + ": " + JSON.stringify(result.content));
    assert.equal(requests.length, 1, c.name);
    const sent = requests.pop();
    const url = new URL(sent.url, "http://localhost");
    assert.equal(sent.method, c.method || "GET", c.name);
    assert.equal(url.pathname, "/v1.0" + c.path, c.name);
    assert.equal(url.searchParams.get("$top"), c.top || null, c.name);
    assert.equal(sent.authorization, "Bearer " + token, c.name);
    assert.deepEqual(sent.body, c.body, c.name);
    if (c.response) {
      const returned = JSON.parse(result.content[0].text);
      assert.deepEqual(returned, c.response, c.name);
    }
  }
  reply = { status: 403, body: { error: { code: "ErrorAccessDenied", message: "Send denied" } } };
  const denied = await request("tools/call", {
    name: "send-draft-message", arguments: { messageId: "draft-1", confirm: true },
  });
  assert.equal(denied.isError, true, JSON.stringify(denied.content));
  assert.match(denied.content[0].text, /ErrorAccessDenied|Send denied/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/v1.0/me/messages/draft-1/send");
});
