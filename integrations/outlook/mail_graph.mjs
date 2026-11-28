// Use the existing single-account Outlook provider; give each call only its own tool.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const request = JSON.parse(readFileSync(0, "utf8"));
const operations = { message: "get-mail-message", messageIdentity: "get-mail-message", folderMessages: "list-mail-folder-messages", create: "create-subscription", renew: "update-subscription", me: "get-current-user", list: "list-subscriptions", inspect: "get-subscription", remove: "delete-subscription" };
const tool = operations[request.operation];
const immutable = request.operation === "messageIdentity";
if (!tool) throw new Error("Unsupported Outlook operation");
const client = new Client({name: "vilar-mail-stage", version: "1"});
try {
  const args = ["--enabled-tools", "^" + tool + "$", "--allowed-scopes", "Mail.Read Calendars.Read User.Read"];
  if (["message", "messageIdentity", "folderMessages", "inspect", "me", "list"].includes(request.operation)) args.push("--read-only");
  const entry = fileURLToPath(new URL("./node_modules/.bin/ms-365-mcp-server", import.meta.url));
  const preload = fileURLToPath(new URL("./mail_graph_immutable.mjs", import.meta.url));
  await client.connect(new StdioClientTransport({
    command: immutable ? process.execPath : entry,
    args: immutable ? ["--import", preload, entry, ...args] : args,
    env: process.env, stderr: "ignore",
  }));
  const result = await client.callTool({name: tool, arguments: request.args});
  if (result.isError) {
    const status = result._meta?.http_status;
    const message = result.content?.[0]?.text || "";
    const category = /account mismatch|unexpected account|expected username/i.test(message) ? "account_mismatch"
      : /invalid.grant|interaction.required|authentication.required|login|unauthenticated/i.test(message) ? "authorization"
      : /scope|permission|access.denied/i.test(message) ? "permissions"
      : /arguments|parameters|schema/i.test(message) ? "parameters"
      : /tool.*not found|not.*available/i.test(message) ? "tool_unavailable" : "provider";

    if (request.operation === "inspect" && result._meta?.http_status === 404) {
      process.stdout.write("null");
    } else {
      process.stderr.write("Outlook read error: " + category +
        (Number.isInteger(status) && status >= 100 && status < 600 ? " HTTP " + status : "") + "\n");
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(request.operation === "remove" ? "{}" : result.content[0].text);
  }
} catch (err) {
  const kind = /not found|unknown tool/i.test(err.message) ? "tool_unavailable"
    : /closed|connect|spawn|ENOENT|denied/i.test(err.message) ? "transport" : "client";
  process.stderr.write("Outlook call failed: " + kind + "\n");
  process.exitCode = 1;
} finally {
  await client.close();
}
