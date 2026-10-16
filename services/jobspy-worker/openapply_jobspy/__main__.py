import argparse
import json
import os
import signal
import sys
import threading
from pathlib import Path

from .client import OpenApplyClient
from .scheduler import run_daily
from .state import StateStore
from .worker import run_once


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily, bounded OpenApply LinkedIn discovery.")
    parser.add_argument("--once", action="store_true", help="Run one scheduled attempt and exit.")
    options = parser.parse_args()
    client = None
    try:
        client = OpenApplyClient(os.environ["OPENAPPLY_API_URL"], os.environ["OPENAPPLY_API_TOKEN"])
        configured_state = os.environ.get("OPENAPPLY_JOBSPY_STATE")
        state_path = (
            Path(configured_state)
            if configured_state
            else Path.home() / ".openapply" / "jobspy-worker" / "state.json"
        )
        state = StateStore(state_path)
        if options.once:
            print(json.dumps(run_once(client, state)))
        else:
            stopped = threading.Event()
            signal.signal(signal.SIGTERM, lambda *_: stopped.set())
            signal.signal(signal.SIGINT, lambda *_: stopped.set())
            run_daily(client, state, lambda result: print(json.dumps(result)), stopped.wait)
        return 0
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        return 1
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    raise SystemExit(main())
