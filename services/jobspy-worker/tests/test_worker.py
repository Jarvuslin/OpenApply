import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from openapply_jobspy.client import ApiError
from openapply_jobspy.linkedin import SearchResult
from openapply_jobspy.state import StateStore
from openapply_jobspy.worker import run_once, searches_from_claim

CLAIM = {
    "runId": "21edc394-d547-4fb8-9b17-b5d9a419b227",
    "leaseToken": "a" * 64,
    "maxResultsPerSearch": 50,
    "maxPagesPerSearch": 5,
    "maxResults": 200,
    "searches": [
        {
            "index": index,
            "query": "software engineer",
            "location": "Canada",
            "distance": 25,
            "experienceLevels": ["entry"],
            "maxYearsExperience": 2,
            "countries": ["CA"],
            "remoteOnly": False,
        }
        for index in range(4)
    ],
}


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.state = StateStore(Path(self.folder.name) / "state.json", clock=lambda: 1000)
        self.client = Mock()
        self.client.owner_key = "test-owner"
        self.client.claim.return_value = copy.deepcopy(CLAIM)
        self.client.ingest.return_value = {"runId": CLAIM["runId"], "imported": 1}

    def test_claim_bounds_and_experience_is_disabled_despite_saved_preferences(self):
        searches = searches_from_claim(CLAIM)
        self.assertEqual(len(searches), 4)
        self.assertTrue(
            all(search.experience is None and search.results == 50 for search in searches)
        )
        for field, value in (
            ("maxResultsPerSearch", 51),
            ("maxPagesPerSearch", 6),
            ("maxResults", 201),
        ):
            with self.assertRaises(ValueError):
                searches_from_claim({**CLAIM, field: value})
        with self.assertRaises(ValueError):
            searches_from_claim({**CLAIM, "searches": CLAIM["searches"] * 2})

    def test_stops_at_first_block_and_reports_every_claimed_index_once(self):
        def blocked(search, state):
            state.block("http_429")
            return SearchResult(search.id, requests=1, stop_reason="http_429", statuses=[429])

        scraper = Mock(side_effect=blocked)
        result = run_once(self.client, self.state, scraper)
        self.assertEqual(scraper.call_count, 1)
        self.assertEqual(
            result["workerMetrics"], {"requests": 1, "pagesFetched": 0, "stopReason": "http_429"}
        )
        payload = self.client.ingest.call_args.args[0]
        self.assertEqual(payload["searches"][0]["status"], "blocked")
        self.assertEqual(payload["searches"][0]["httpStatus"], 429)
        self.assertEqual([batch["index"] for batch in payload["searches"]], [0, 1, 2, 3])
        self.assertTrue(
            all(
                batch["status"] == "error" and batch["pagesFetched"] == 0 and not batch["jobs"]
                for batch in payload["searches"][1:]
            )
        )
        self.client.ingest.assert_called_once()

    def test_api_receives_only_the_strict_ingestion_fields(self):
        row = {
            "id": "li-123",
            "title": "Engineer",
            "company": "Example",
            "location": "Canada",
            "url": "https://www.linkedin.com/jobs/view/123",
            "description": None,
            "postedAt": "2026-10-07",
            "companyUrl": "https://www.linkedin.com/company/example",
            "applyUrl": "not-accepted",
        }
        scraper = Mock(
            side_effect=lambda search, state: SearchResult(
                search.id, jobs=[row], requests=1, pages=1, statuses=[200]
            )
        )
        result = run_once(self.client, self.state, scraper)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(scraper.call_count, 4)
        job = self.client.ingest.call_args.args[0]["searches"][0]["jobs"][0]
        self.assertEqual(
            set(job), {"url", "title", "company", "location", "description", "datePosted"}
        )
        self.assertEqual(job["description"], "")

    def test_existing_backoff_and_not_due_do_not_fetch_linkedin(self):
        scraper = Mock()
        self.client.claim.return_value = None
        self.assertEqual(
            run_once(self.client, self.state, scraper)["status"], "not_due_or_disabled"
        )
        self.client.ingest.assert_not_called()
        self.state.block("http_429")
        self.client.reset_mock()
        self.assertEqual(run_once(self.client, self.state, scraper)["status"], "backoff")
        self.client.claim.assert_not_called()
        scraper.assert_not_called()

    def test_unexpected_scraper_failure_also_stops_and_backoffs(self):
        scraper = Mock(side_effect=RuntimeError("parser failed"))
        run_once(self.client, self.state, scraper)
        self.assertEqual(scraper.call_count, 1)
        self.assertTrue(self.state.is_blocked())
        self.assertEqual(self.client.ingest.call_args.args[0]["searches"][0]["status"], "error")

    def test_ingest_failure_preserves_exact_payload_for_later_retry_without_scraping(self):
        scraper = Mock(
            side_effect=lambda search, state: SearchResult(
                search.id, requests=1, pages=1, statuses=[200]
            )
        )
        self.client.ingest.side_effect = ApiError("timeout")
        with self.assertRaises(ApiError):
            run_once(self.client, self.state, scraper)
        original = self.client.ingest.call_args.args[0]
        self.assertEqual(scraper.call_count, 4)
        self.client.reset_mock()
        scraper.reset_mock()
        self.client.ingest.side_effect = None
        self.assertEqual(run_once(self.client, self.state, scraper)["status"], "completed")
        self.client.ingest.assert_called_once_with(original)
        self.client.claim.assert_not_called()
        scraper.assert_not_called()

    def test_confirmed_expired_pending_is_discarded_without_new_linkedin_requests(self):
        scraper = Mock(side_effect=lambda search, state: SearchResult(search.id))
        self.client.ingest.side_effect = ApiError("expired", expired_lease=True)
        self.assertEqual(
            run_once(self.client, self.state, scraper)["status"], "expired_pending_run"
        )
        self.assertFalse((self.state.path.parent / "test-owner.pending.json").exists())


if __name__ == "__main__":
    unittest.main()
