"""Recover missed Inbox notifications into the existing durable receive queue."""
from datetime import datetime, timedelta, timezone
import re

LIMIT = 100
OVERLAP = timedelta(minutes=5)
QUERY_BUDGET = 64


def graph_time(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("timezone-aware checkpoint required")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def recover_inbox(db, provider, *, initial_since, until):
    """Use fixed time slices, advancing the checkpoint only with a complete queue write."""
    graph_time(initial_since)
    graph_time(until)
    db.execute("""CREATE TABLE IF NOT EXISTS inbox_recovery (
        id INTEGER PRIMARY KEY CHECK(id=1), recovered_until TEXT NOT NULL)""")
    prior = db.execute("SELECT recovered_until FROM inbox_recovery WHERE id=1").fetchone()
    previous = datetime.fromisoformat(prior[0]) if prior else initial_since
    if until <= previous:
        return 0
    lower = max(initial_since, previous - OVERLAP)
    remaining = [(lower, until)]
    messages = set()
    for _ in range(QUERY_BUDGET):
        if not remaining:
            break
        start, end = remaining.pop()
        result = provider("folderMessages", mailFolderId="inbox", top=LIMIT,
                          filter=f"receivedDateTime ge {graph_time(start)} and receivedDateTime lt {graph_time(end)}",
                          select="id,receivedDateTime")
        rows = result["value"]
        if not isinstance(rows, list) or len(rows) > LIMIT:
            raise ValueError("invalid Inbox listing")
        if result.get("@odata.nextLink") or len(rows) == LIMIT:
            if end - start <= timedelta(seconds=1):
                raise ValueError("Inbox slice is too dense to recover safely")
            midpoint = start + (end - start) / 2
            remaining.extend(((midpoint, end), (start, midpoint)))
            continue
        for row in rows:
            mid = row["id"]
            stamp = datetime.fromisoformat(row["receivedDateTime"])
            if not re.fullmatch(r"[A-Za-z0-9_+=/-]{1,1024}", mid) or not start <= stamp < end:
                raise ValueError("unexpected message outside Inbox recovery bounds")
            messages.add(mid)
    if remaining:
        raise ValueError("Inbox recovery incomplete")
    with db:
        # Failure to claim the old checkpoint rolls back all staged inbox rows.
        if prior:
            changed = db.execute("""UPDATE inbox_recovery SET recovered_until=?
                WHERE id=1 AND recovered_until=?""", (graph_time(until), prior[0])).rowcount
        else:
            changed = db.execute("INSERT OR IGNORE INTO inbox_recovery VALUES(1,?)",
                                 (graph_time(until),)).rowcount
        if changed != 1:
            raise RuntimeError("Inbox recovery checkpoint changed")
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO incoming(message_id) VALUES(?)",
                       ((mid,) for mid in sorted(messages)))
        return db.total_changes - before
