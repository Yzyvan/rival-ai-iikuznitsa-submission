"""Import one verified Outlook Inbox revision through the source adapter API."""
import argparse
import asyncio
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sources"))
from client import SourceClient


HERE = Path(__file__).resolve().parent
NATIVE_BODY = "Integer 0x1016"
FIELDS = ("id,changeKey,conversationId,conversationIndex,isDraft,hasAttachments,from,sender,toRecipients,"
          "ccRecipients,bccRecipients,replyTo,subject,body,receivedDateTime,lastModifiedDateTime,internetMessageHeaders")


class Refused(ValueError):
    pass


def required(value):
    if not isinstance(value, str) or not value.strip():
        raise Refused("Missing source field")
    return value


def address(person):
    addr = required(person["emailAddress"]["address"])
    if not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+", addr):
        raise Refused("Invalid address")
    return addr


def parent_reference(headers, self_id):
    # Require evidence that Graph returned this message's actual headers.
    if not isinstance(headers, list):
        raise Refused("Missing message headers")
    values = {}
    for header in headers:
        name = required(header["name"]).lower()
        if name in {"message-id", "references", "in-reply-to"}:
            if name in values:
                raise Refused("Repeated threading header")
            values[name] = required(header["value"]).strip()
    if values.get("message-id") != self_id:
        raise Refused("Unverified message headers")
    parent = values.get("in-reply-to")
    references = values.get("references")
    if parent is None:
        if references is not None:
            raise Refused("References without a direct parent")
        return None
    # Support one simple Internet message ID. Refuse lists and obsolete forms.
    pattern = r"<[^<>@\s]+@[^<>@\s]+>"
    if not re.fullmatch(pattern, parent) or parent == self_id:
        raise Refused("Invalid parent reference")
    if references is not None:
        ids = references.split()
        if not all(re.fullmatch(pattern, value) for value in ids) or ids[-1] != parent or self_id in ids:
            raise Refused("Conflicting parent references")
    return parent


async def resolve_parent(get, msg, self_id):
    reference = parent_reference(msg.get("internetMessageHeaders"), self_id)
    if reference is None:
        # Exchange appends five bytes per reply level to the 22-byte root index.
        index = base64.b64decode(required(msg["conversationIndex"]), validate=True)
        if len(index) != 22 or index[0] != 1:
            raise Refused("Conversation does not confirm an original message")
        return None
    escaped = reference.replace("'", "''")
    found = await get("list-mail-folder-messages", {"mailFolderId": "inbox", "top": 2,
                      "filter": f"internetMessageId eq '{escaped}'",
                      "select": "id,internetMessageId,conversationId,isDraft"})
    rows = found["value"]
    if found.get("@odata.nextLink") or not isinstance(rows, list) or len(rows) != 1:
        raise Refused("Unverified parent in Inbox")
    parent = rows[0]
    if (parent["internetMessageId"] != reference or parent["conversationId"] != msg["conversationId"]
            or parent["isDraft"] is not False or parent["id"] == msg["id"]):
        raise Refused("Parent does not match the conversation")
    return required(parent["id"])


def event_for(msg, account, message_id, revision, change, parent_id):
    if msg["id"] != message_id or msg["changeKey"] != revision or msg["isDraft"] is not False:
        raise Refused("Original message changed or is a draft")
    native = msg.get("singleValueExtendedProperties")
    body = msg.get("body", {})
    if (not isinstance(native, list) or len(native) != 1 or
            native[0].get("id", "").lower() != NATIVE_BODY.lower() or native[0].get("value") != "1" or
            body.get("contentType", "").lower() != "text"):
        raise Refused("Original plain text could not be verified")
    if msg.get("hasAttachments") is not False or msg.get("attachments") != [] or msg.get("attachments@odata.nextLink"):
        raise Refused("Attachment-free message required")
    sender = address(msg["from"])
    if (address(msg["sender"]) != sender or msg["ccRecipients"] != [] or msg["bccRecipients"] != []
            or not isinstance(msg["toRecipients"], list) or len(msg["toRecipients"]) != 1
            or not isinstance(msg["replyTo"], list) or len(msg["replyTo"]) > 1):
        raise Refused("Unsupported addressing")
    if not isinstance(msg["subject"], str):
        raise Refused("Missing subject")
    data = {"text": required(body["content"]), "subject": msg["subject"],
            "from_name": msg["from"]["emailAddress"].get("name"), "to": address(msg["toRecipients"][0]),
            "reply_to_address": address(msg["replyTo"][0]) if msg["replyTo"] else None}
    source = {"provider": "mail", "channel": "inbox", "account": account, "object": message_id,
              "revision": revision, "change": change, "thread": required(msg["conversationId"]),
              "occurred_at": required(msg["receivedDateTime" if change == "create" else "lastModifiedDateTime"]),
              "actor_external": sender, "reply_to": parent_id}
    return {"source": source, "data": data}


async def read_message(account, message_id, change):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    env = {"VILAR_OUTLOOK_ACCOUNT": account, "MS365_MCP_BODY_FORMAT": "text",
           "MS365_MCP_OUTPUT_FORMAT": "json"}
    if os.environ.get("XDG_CONFIG_HOME"):
        env["XDG_CONFIG_HOME"] = os.environ["XDG_CONFIG_HOME"]
    params = StdioServerParameters(command=str(HERE / "outlook"), args=["serve"], env=env)
    with open(os.devnull, "w") as err:
        async with stdio_client(params, errlog=err) as (reader, writer), ClientSession(reader, writer) as session:
            await session.initialize()

            async def get(name, args):
                result = await session.call_tool(name, args)
                if result.is_error or len(result.content) != 1 or result.content[0].type != "text":
                    raise Refused("Outlook read failed")
                return json.loads(result.content[0].text)

            meta = await get("get-mail-message", {"messageId": message_id, "select": "id,changeKey,internetMessageId"})
            if meta["id"] != message_id:
                raise Refused("Outlook returned a different message")
            revision = required(meta["changeKey"])
            internet_id = required(meta["internetMessageId"])
            escaped = internet_id.replace("'", "''")
            inbox = await get("list-mail-folder-messages", {"mailFolderId": "inbox", "top": 2,
                              "filter": f"internetMessageId eq '{escaped}'", "select": "id,changeKey"})
            matches = inbox["value"]
            if (inbox.get("@odata.nextLink") or len(matches) != 1 or matches[0]["id"] != message_id
                    or matches[0]["changeKey"] != revision):
                raise Refused("Inbox revision could not be verified")
            msg = await get("get-mail-message", {"messageId": message_id, "select": FIELDS,
                            "expand": f"attachments($select=id),singleValueExtendedProperties($filter=id eq '{NATIVE_BODY}')"})
            parent_id = await resolve_parent(get, msg, internet_id)
    return event_for(msg, account, message_id, revision, change, parent_id)


def submit(client, event):
    source = event["source"]
    identity = [source[k] for k in ("provider", "account", "channel", "object", "revision")]
    key = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
    status, accepted = client.submit(event, key)
    if status != 202 or not re.fullmatch(r"evt-[0-9a-f]{32}", accepted["event_id"]):
        raise Refused("Invalid acceptance receipt")
    status, receipt = client.read(accepted["event_id"])
    if (status != 200 or receipt["event_id"] != accepted["event_id"]
            or receipt["correlation_id"] != accepted["correlation_id"]
            or receipt["status"] not in {"received", "admitted", "quarantined"}):
        raise Refused("Could not verify receipt")
    return {"event_id": receipt["event_id"], "status": receipt["status"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("message_id", help="Graph message ID")
    parser.add_argument("--change", choices=("create", "update"), default="create")
    args = parser.parse_args()
    # MCP diagnostics can contain raw provider responses, including on parse errors.
    logging.disable(logging.CRITICAL)
    try:
        account = required(os.environ["VILAR_OUTLOOK_ACCOUNT"])
        if not re.fullmatch(r"[a-zA-Z0-9_+.-]+@[a-zA-Z0-9.-]+", account):
            raise Refused("Invalid Outlook account")
        if not re.fullmatch(r"[a-zA-Z0-9_+=/-]{1,512}", args.message_id):
            raise Refused("Invalid Graph message ID")
        client = SourceClient(os.environ["VILAR_API_URL"], required(os.environ["VILAR_SOURCE_TOKEN"]))
        event = asyncio.run(asyncio.wait_for(read_message(account, args.message_id, args.change), 45))
        print(json.dumps(submit(client, event)))
    except Refused as exc:
        sys.exit(str(exc))
    except HTTPError as exc:
        sys.exit(f"Core request failed (HTTP {exc.code})")
    except Exception:
        sys.exit("Import failed. Check mailbox, source configuration and service availability.")


if __name__ == "__main__":
    main()
