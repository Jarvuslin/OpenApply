import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from openapply_jobspy import __main__ as cli
from openapply_jobspy.client import ApiError
from openapply_jobspy.linkedin import SearchResult
from openapply_jobspy.scheduler import run_daily
from openapply_jobspy.state import StateStore
from openapply_jobspy.worker import run_once

from tests.test_worker import CLAIM


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name)
        self.client = Mock()
        self.client.owner_key = "reliability-test"
        self.client.claim.return_value = CLAIM
        self.client.ingest.return_value = {"runId": CLAIM["runId"]}
        self.scraper = Mock(
            side_effect=lambda search, state: SearchResult(
                search.id, requests=1, pages=1, statuses=[200]
            )
        )

    def test_unusable_state_storage_fails_before_claiming_or_scraping(self):
        parent = self.path / "not-a-directory"
        parent.write_text("occupied", encoding="utf-8")
        state = StateStore(parent / "state.json")
        with self.assertRaises(OSError):
            run_once(self.client, state, self.scraper)
        self.client.claim.assert_not_called()
        self.scraper.assert_not_called()

    def test_daemon_recovers_pending_ingest_before_the_one_hour_lease_expires(self):
        now = [1000.0]
        state = StateStore(self.path / "state.json", clock=lambda: now[0])
        attempts = []

        def ingest(payload):
            attempts.append(payload)
            if len(attempts) == 1:
                raise ApiError("connection failed before server received the payload")
            if now[0] >= 1000 + 3600:
                raise ApiError("lease expired", expired_lease=True)
            return {"runId": CLAIM["runId"]}

        self.client.ingest.side_effect = ingest
        emitted = []
        waits = []

        def wait(seconds):
            waits.append(seconds)
            now[0] += seconds
            return len(waits) == 2

        run_daily(
            self.client,
            state,
            emitted.append,
            wait,
            run=lambda client, storage: run_once(client, storage, self.scraper),
            clock=lambda: now[0],
        )
        self.assertLess(waits[0], 3600)
        self.assertEqual(emitted[-1]["status"], "completed")
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])
        self.client.claim.assert_called_once()
        self.assertEqual(self.scraper.call_count, 4)

    def test_native_default_state_is_in_the_user_directory(self):
        with (
            patch.dict(
                "os.environ",
                {
                    "OPENAPPLY_API_URL": "http://127.0.0.1:4101",
                    "OPENAPPLY_API_TOKEN": "fixture-token",
                },
                clear=True,
            ),
            patch("sys.argv", ["worker", "--once"]),
            patch.object(cli, "OpenApplyClient"),
            patch.object(cli.Path, "home", return_value=self.path / "user"),
            patch.object(cli, "StateStore") as store,
            patch.object(cli, "run_once", return_value={"status": "not_due_or_disabled"}),
            patch("builtins.print"),
        ):
            self.assertEqual(cli.main(), 0)
        self.assertTrue(store.call_args.args[0].is_relative_to(self.path / "user"))

    def test_block_and_pending_recovery_files_share_the_preflighted_directory(self):
        state = StateStore(self.path / "state.json")

        def blocked(search, storage):
            storage.block("http_429")
            return SearchResult(search.id, requests=1, stop_reason="http_429", statuses=[429])

        self.client.ingest.side_effect = ApiError("temporary failure")
        with self.assertRaises(ApiError):
            run_once(self.client, state, blocked)
        self.assertTrue(state.is_blocked())
        pending_files = list(self.path.glob("*.pending.json"))
        self.assertEqual(len(pending_files), 1)
        self.assertEqual(pending_files[0].parent, state.path.parent)


if __name__ == "__main__":
    unittest.main()
