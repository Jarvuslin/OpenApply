import unittest
from unittest.mock import patch

from openapply_jobspy.client import ApiError, OpenApplyClient

from tests.helpers import response


class ClientTests(unittest.TestCase):
    def test_personal_token_goes_only_to_fixed_api_endpoint_without_redirects(self):
        client = OpenApplyClient("https://api.example.test/api", "test-token")
        self.addCleanup(client.close)
        with patch(
            "requests.Session.send",
            side_effect=lambda request, **kwargs: response(request, body='{"runId":"test"}'),
        ) as send:
            self.assertEqual(client.claim(), {"runId": "test"})
        request = send.call_args.args[0]
        self.assertEqual(request.url, "https://api.example.test/api/job-sources/linkedin/runs")
        self.assertEqual(request.headers["Authorization"], "Bearer test-token")
        self.assertFalse(send.call_args.kwargs["allow_redirects"])
        self.assertFalse(client.session.trust_env)

    def test_not_due_is_skipped_but_other_errors_never_retry(self):
        for status in (409, 302, 401, 429, 500):
            client = OpenApplyClient("http://127.0.0.1:4101", "test-token")
            self.addCleanup(client.close)
            with patch(
                "requests.Session.send",
                side_effect=lambda request, **kwargs: response(request, status=status),
            ) as send:
                if status == 409:
                    self.assertIsNone(client.claim())
                else:
                    with self.assertRaises(ApiError):
                        client.claim()
                self.assertEqual(send.call_count, 1)

    def test_insecure_or_credentialed_api_origins_are_rejected(self):
        for url in (
            "http://api.example.test",
            "https://token@api.example.test",
            "https://api.example.test?token=x",
            "https://api.example.test/elsewhere",
        ):
            with self.assertRaises(ValueError):
                OpenApplyClient(url, "test-token")

    def test_expired_lease_is_distinguished_from_processing_conflict(self):
        client = OpenApplyClient("https://api.example.test", "test-token")
        self.addCleanup(client.close)
        for message, expired in (
            ("This discovery run's lease expired.", True),
            ("This discovery result is already processing. Retry the same payload later.", False),
        ):
            with patch(
                "requests.Session.send",
                side_effect=lambda request, **kwargs: response(
                    request, status=409, body='{"message": "' + message + '"}'
                ),
            ):
                with self.assertRaises(ApiError) as error:
                    client.ingest({})
                self.assertEqual(error.exception.expired_lease, expired)


if __name__ == "__main__":
    unittest.main()
