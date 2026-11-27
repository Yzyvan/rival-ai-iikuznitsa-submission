// Use the existing single-account Outlook provider; give each call only its own tool.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const request = JSON.parse(readFileSync(0, "utf8"));
const operations = { message: "get-mail-message", folderMessages: "list-mail-folder-messages", create: "create-subscription", renew: "update-subscription" };
const tool = operations[request.operation];
if (!tool) throw new Error("Unsupported Outlook operation");
const client = new Client({name: "vilar-mail-stage", version: "1"});
try {
  const args = ["--enabled-tools", "^" + tool + "$", "--allowed-scopes", "Mail.Read Calendars.Read User.Read"];
  if (["message", "folderMessages"].includes(request.operation)) args.push("--read-only");
  await client.connect(new StdioClientTransport({
    command: fileURLToPath(new URL("./node_modules/.bin/ms-365-mcp-server", import.meta.url)),
    args, env: process.env, stderr: "ignore",
  }));
  const result = await client.callTool({name: tool, arguments: request.args});
  if (result.isError) throw new Error("provider refused");
  process.stdout.write(result.content[0].text);
} catch {
  process.stderr.write("Outlook operation failed\n");
  process.exitCode = 1;
} finally {
  await client.close();
}
