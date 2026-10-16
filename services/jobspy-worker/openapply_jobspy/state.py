import json
import math
import os
import tempfile
import time
from pathlib import Path

BACKOFF_SECONDS = 24 * 60 * 60


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".jobspy-state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class PendingStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Invalid pending ingest; refusing to start another search.")
        return value

    def save(self, payload: dict) -> None:
        write_json(self.path, payload)

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)


class StateStore:
    def __init__(self, path: Path, clock=time.time):
        self.path = path
        self.clock = clock

    def read(self) -> dict:
        if not self.path.exists():
            return {}
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Invalid worker state; refusing to issue LinkedIn requests.")
        return value

    def ensure_writable(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=self.path.parent) as probe:
            probe.write(b"{}")
            probe.flush()
            os.fsync(probe.fileno())
        if self.path.exists():
            with self.path.open("ab"):
                pass

    def blocked_until(self) -> float:
        value = float(self.read().get("blockedUntil", 0))
        if not math.isfinite(value) or value < 0:
            raise ValueError("Invalid worker backoff; refusing to issue LinkedIn requests.")
        return value

    def is_blocked(self) -> bool:
        return self.blocked_until() > self.clock()

    def block(self, reason: str) -> None:
        state = self.read()
        state.update(blockedUntil=self.clock() + BACKOFF_SECONDS, reason=reason)
        write_json(self.path, state)
