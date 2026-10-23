import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import requests
from openapply_jobspy.linkedin import ENDPOINT, GuestSession, Search, StopSearch, scrape
from openapply_jobspy.state import BACKOFF_SECONDS, StateStore

from tests.helpers import CARD, response


class GuestSessionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.state = StateStore(Path(self.folder.name) / "state.json", clock=lambda: 1000)
        self.search = Search("0", "software engineer", "Canada")

    def test_plain_logged_out_transport_has_no_proxy_cookie_auth_redirect_or_retries(self):
        session = GuestSession(self.search, self.state)
        self.addCleanup(session.close)
        session.cookies.set("li_at", "never-send")
        session.headers["Cookie"] = "never-send"
        session.headers["Authorization"] = "never-send"
        with (
            patch.dict("os.environ", {"HTTPS_PROXY": "http://proxy.invalid"}),
            patch("requests.Session.send") as send,
        ):
            send.side_effect = lambda prepared, **kwargs: response(prepared)
            session.get(
                ENDPOINT,
                params={"start": 0},
                headers={"Authorization": "ignored"},
                cookies={"li_at": "ignored"},
            )
        prepared = send.call_args.args[0]
        self.assertNotIn("Cookie", prepared.headers)
        self.assertNotIn("Authorization", prepared.headers)
        self.assertEqual(send.call_args.kwargs["proxies"], {})
        self.assertFalse(send.call_args.kwargs["allow_redirects"])
        self.assertTrue(send.call_args.kwargs["verify"])
        self.assertFalse(session.trust_env)
        self.assertEqual(session.get_adapter(ENDPOINT).max_retries.total, 0)
        self.assertEqual(parse_qs(urlsplit(prepared.url).query)["f_TPR"], ["r86400"])

    def test_optional_experience_injection_is_exact_and_omitted_by_default(self):
        for value in (None, "1", "2"):
            with (
                self.subTest(value=value),
                GuestSession(
                    Search("0", "engineer", "Canada", experience=value), self.state
                ) as session,
                patch("requests.Session.send") as send,
            ):
                send.side_effect = lambda prepared, **kwargs: response(prepared)
                session.get(ENDPOINT, params={"start": 0, "f_E": "untrusted"})
                params = parse_qs(urlsplit(send.call_args.args[0].url).query)
                self.assertEqual(params.get("f_E"), [value] if value else None)

    def test_each_non200_blocks_the_entire_run_and_survives_restart(self):
        for status in (302, 401, 403, 429, 500):
            with self.subTest(status=status):
                state = StateStore(Path(self.folder.name) / str(status), clock=lambda: 1000)
                with (
                    GuestSession(self.search, state) as session,
                    patch("requests.Session.send") as send,
                ):
                    send.side_effect = lambda prepared, **kwargs: response(prepared, status=status)
                    with self.assertRaises(StopSearch):
                        session.get(ENDPOINT)
                    with self.assertRaises(StopSearch):
                        session.get(ENDPOINT)
                    self.assertEqual(send.call_count, 1)
                restarted = StateStore(state.path, clock=lambda: 1001)
                self.assertEqual(restarted.blocked_until(), 1000 + BACKOFF_SECONDS)
                self.assertTrue(restarted.is_blocked())

    def test_empty_or_challenge_html_and_network_errors_back_off_without_retry(self):
        for body in ("<!DOCTYPE html>\n\n<!---->", "<html>Sign in or verify your identity</html>"):
            state = StateStore(Path(self.folder.name) / str(len(body)), clock=lambda: 1000)
            with (
                GuestSession(self.search, state) as session,
                patch(
                    "requests.Session.send",
                    side_effect=lambda prepared, **kwargs: response(prepared, body=body),
                ),
            ):
                with self.assertRaises(StopSearch):
                    session.get(ENDPOINT)
                self.assertTrue(state.is_blocked())
        with (
            GuestSession(self.search, self.state) as session,
            patch("requests.Session.send", side_effect=requests.Timeout) as send,
        ):
            with self.assertRaises(StopSearch):
                session.get(ENDPOINT)
            self.assertEqual(send.call_count, 1)
            self.assertTrue(self.state.is_blocked())

    def test_only_the_exact_public_guest_endpoint_is_allowed(self):
        for url in (
            "http://www.linkedin.com/jobs",
            "https://www.linkedin.com/login",
            "https://www.linkedin.com/jobs/view/123",
            "https://linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
            ENDPOINT + "?start=0",
            "https://www.linkedin.com.evil.test/jobs",
        ):
            state = StateStore(Path(self.folder.name) / str(hash(url)), clock=lambda: 1000)
            with (
                GuestSession(self.search, state) as session,
                patch("requests.Session.send") as send,
            ):
                with self.assertRaises(StopSearch):
                    session.get(url)
                send.assert_not_called()

    def test_page_and_offset_caps_stop_before_an_extra_request(self):
        with (
            GuestSession(self.search, self.state) as session,
            patch(
                "requests.Session.send", side_effect=lambda prepared, **kwargs: response(prepared)
            ) as send,
        ):
            for start in range(0, 50, 10):
                session.get(ENDPOINT, params={"start": start})
            with self.assertRaises(StopSearch):
                session.get(ENDPOINT, params={"start": 50})
            self.assertEqual(send.call_count, 5)
            self.assertFalse(self.state.is_blocked())

    def test_released_jobspy_parses_cards_with_descriptions_disabled(self):
        with patch(
            "requests.Session.send", side_effect=lambda prepared, **kwargs: response(prepared)
        ) as send:
            result = scrape(Search("0", "software engineer", "Canada", results=1), self.state)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(result.jobs[0]["title"], "Software Engineer")
        self.assertEqual(result.jobs[0]["url"], "https://www.linkedin.com/jobs/view/1234567890")
        self.assertEqual(result.jobs[0]["postedAt"], "2026-10-07")
        self.assertIsNone(result.jobs[0]["description"])

    def test_duplicate_pages_cannot_make_jobspy_exceed_five_requests(self):
        with (
            patch(
                "requests.Session.send",
                side_effect=lambda prepared, **kwargs: response(prepared, body=CARD * 10),
            ) as send,
            patch("jobspy.linkedin.time.sleep"),
        ):
            result = scrape(self.search, self.state)
        self.assertEqual(send.call_count, 5)
        self.assertEqual(len(result.jobs), 1)
        self.assertEqual(result.stop_reason, "page_limit")

    def test_unparseable_cards_do_not_report_an_empty_success(self):
        with patch(
            "requests.Session.send",
            side_effect=lambda prepared, **kwargs: response(
                prepared,
                body=CARD.replace(
                    '<span class="sr-only">Software Engineer</span>',
                    '<span class="sr-only">N/A</span>',
                ),
            ),
        ):
            result = scrape(Search("0", "software engineer", "Canada", results=1), self.state)
        self.assertEqual(result.jobs, [])
        self.assertEqual(result.stop_reason, "unparseable_jobs")
        self.assertTrue(self.state.is_blocked())

    def test_invalid_limits_and_corrupt_state_fail_closed(self):
        with self.assertRaises(ValueError):
            Search("0", "software", "Canada", results=51)
        with self.assertRaises(ValueError):
            Search("0", "software", "Canada", experience="3")
        self.state.path.write_text('{"blockedUntil": "NaN"}')
        with (
            GuestSession(self.search, self.state) as session,
            patch("requests.Session.send") as send,
        ):
            with self.assertRaises(ValueError):
                session.get(ENDPOINT)
            send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
