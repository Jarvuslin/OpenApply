import time

from .client import OpenApplyClient
from .state import BACKOFF_SECONDS, StateStore
from .worker import PendingIngestError, run_once

IDLE_POLL_SECONDS = 60 * 60
PENDING_RETRY_SECONDS = 5 * 60


def next_delay(result: dict, now: float) -> float:
    if result["status"] == "pending_ingest":
        return PENDING_RETRY_SECONDS
    if result["status"] == "backoff":
        return max(60, min(BACKOFF_SECONDS, result["backoffUntil"] - now))
    if result["status"] == "completed":
        return BACKOFF_SECONDS
    return IDLE_POLL_SECONDS


def run_daily(
    client: OpenApplyClient, state: StateStore, emit, wait, run=run_once, clock=time.time
):
    while True:
        try:
            result = run(client, state)
        except PendingIngestError as error:
            result = {"status": "pending_ingest", "error": str(error)}
        except Exception as error:
            result = {"status": "error", "error": str(error)}
        emit(result)
        if wait(next_delay(result, clock())):
            return
