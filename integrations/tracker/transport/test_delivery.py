"""Provider-side retry checks on synthetic v1 responses. No core or database needed."""

import tempfile
import unittest
from pathlib import Path

from adapter import deliver


class SimulatedCore:
    def __init__(self):
        self.status = "in_flight"
        self.receipts = []
        self.lease = "2099-12-07T09:02:00+03:00"

    def request(self, path, body, key):
        if path == "/v1/dispatch/claim":
            return {
                "action": "issue_task",
                "status": self.status,
                "work_id": "w-07",
                "step_id": "s-07",
                "dispatch_id": "d-02",
                "account": "tracker-A",
                "recipient": "p02",
                "material_version": 1,
                "title": "Согласовать окно работ с клиентом",
                "attempt_token": "attempt-02",
                "lease_until": self.lease,
            }
        assert path == "/v1/dispatch/d-02/receipt"
        self.receipts.append((key, body))
        return {"dispatch_id": "d-02", "status": body["outcome"]}


class Delivery(unittest.TestCase):
    def test_lost_receipt_response(self):
        core = SimulatedCore()
        with tempfile.TemporaryDirectory() as folder:
            deliver(core, "tracker-A", folder, "poll")
            core.lease = "2000-01-01T00:00:00+00:00"
            deliver(core, "tracker-A", folder, "poll")
            self.assertEqual(len(list(Path(folder).glob("*.json"))), 1)
            self.assertEqual(core.receipts[0], core.receipts[1])
            self.assertEqual(core.receipts[1][1]["provider_receipt"]["id"], "ext-s-07")

    def test_expired_attempt_without_inbox_proof(self):
        core = SimulatedCore()
        core.lease = "2000-01-01T00:00:00+00:00"
        with tempfile.TemporaryDirectory() as folder:
            reply = deliver(core, "tracker-A", folder, "poll")
            self.assertEqual(reply["status"], "uncertain")
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
