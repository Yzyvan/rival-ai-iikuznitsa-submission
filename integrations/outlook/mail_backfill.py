"""Recover missed Outlook messages into the durable receive queue."""
from datetime import datetime, timedelta, timezone
import re

LIMIT = 100
OVERLAP = timedelta(minutes=5)
QUERY_BUDGET = 64
CHECKPOINTS = {"receivedDateTime": "inbox_recovery", "lastModifiedDateTime": "mail_move_recovery"}


def graph_time(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("timezone-aware checkpoint required")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def scan_folder(provider, *, lower, until, mail_folder, date_field):
    remaining = [(lower, until)]
    messages = set()
    for _ in range(QUERY_BUDGET):
        if not remaining:
            break
        start, end = remaining.pop()
        result = provider("folderMessages", mailFolderId=mail_folder, top=LIMIT,
                          filter=f"{date_field} ge {graph_time(start)} and {date_field} lt {graph_time(end)}",
                          select=f"id,{date_field}")
        rows = result["value"]
        if not isinstance(rows, list) or len(rows) > LIMIT:
            raise ValueError("invalid Outlook listing")
        if result.get("@odata.nextLink") or len(rows) == LIMIT:
            if end - start <= timedelta(seconds=1):
                raise ValueError("Outlook slice is too dense to recover safely")
            midpoint = start + (end - start) / 2
            remaining.extend(((midpoint, end), (start, midpoint)))
            continue
        for row in rows:
            mid = row["id"]
            stamp = datetime.fromisoformat(row[date_field])
            if not re.fullmatch(r"[A-Za-z0-9_+=/-]{1,1024}", mid) or not start <= stamp < end:
                raise ValueError("unexpected message outside Outlook recovery bounds")
            messages.add(mid)
    if remaining:
        raise ValueError("Outlook recovery incomplete")
    return messages


def recover_inbox(db, provider, *, initial_since, until, mail_folder="inbox", date_field="receivedDateTime"):
    """Use fixed time slices, advancing the checkpoint only with a complete queue write."""
    if mail_folder not in {"inbox", "junkemail"}:
        raise ValueError("Unsupported Outlook recovery folder")
    if date_field not in CHECKPOINTS:
        raise ValueError("Unsupported Outlook recovery timestamp")
    graph_time(initial_since)
    graph_time(until)
    table = CHECKPOINTS[date_field]
    db.execute(f"""CREATE TABLE IF NOT EXISTS {table} (
        id INTEGER PRIMARY KEY CHECK(id=1), recovered_until TEXT NOT NULL)""")
    prior = db.execute(f"SELECT recovered_until FROM {table} WHERE id=1").fetchone()
    previous = datetime.fromisoformat(prior[0]) if prior else initial_since
    if until <= previous:
        return 0
    lower = max(initial_since, previous - OVERLAP)
    messages = scan_folder(provider, lower=lower, until=until, mail_folder=mail_folder,
                           date_field=date_field)
    with db:
        # Failure to claim the old checkpoint rolls back all staged inbox rows.
        if prior:
            changed = db.execute(f"""UPDATE {table} SET recovered_until=?
                WHERE id=1 AND recovered_until=?""", (graph_time(until), prior[0])).rowcount
        else:
            changed = db.execute(f"INSERT OR IGNORE INTO {table} VALUES(1,?)",
                                 (graph_time(until),)).rowcount
        if changed != 1:
            raise RuntimeError("Inbox recovery checkpoint changed")
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO incoming(message_id) VALUES(?)",
                       ((mid,) for mid in sorted(messages)))
        return db.total_changes - before
