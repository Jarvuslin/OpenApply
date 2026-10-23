import unittest
from unittest.mock import Mock

from openapply_jobspy.scheduler import IDLE_POLL_SECONDS, next_delay, run_daily
from openapply_jobspy.state import BACKOFF_SECONDS


class SchedulerTests(unittest.TestCase):
    def test_daily_completion_and_hourly_api_only_idle_checks(self):
        self.assertEqual(next_delay({"status": "completed"}, 0), BACKOFF_SECONDS)
        for status in ("not_due_or_disabled", "error", "expired_pending_run"):
            self.assertEqual(next_delay({"status": status}, 0), IDLE_POLL_SECONDS)
        self.assertEqual(next_delay({"status": "backoff", "backoffUntil": 2000}, 1000), 1000)

    def test_daemon_runs_one_iteration_then_sleeps_and_can_stop(self):
        run = Mock(return_value={"status": "completed", "imported": 1})
        wait = Mock(return_value=True)
        emit = Mock()
        run_daily(Mock(), Mock(), emit, wait, run=run, clock=lambda: 1000)
        run.assert_called_once()
        wait.assert_called_once_with(BACKOFF_SECONDS)
        emit.assert_called_once_with({"status": "completed", "imported": 1})

    def test_error_waits_instead_of_creating_a_tight_loop(self):
        run = Mock(side_effect=RuntimeError("API unavailable"))
        wait = Mock(return_value=True)
        run_daily(Mock(), Mock(), Mock(), wait, run=run)
        wait.assert_called_once_with(IDLE_POLL_SECONDS)


if __name__ == "__main__":
    unittest.main()
