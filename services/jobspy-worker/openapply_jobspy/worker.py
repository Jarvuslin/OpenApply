import re
from uuid import UUID

from .client import ApiError, OpenApplyClient
from .linkedin import Search, scrape
from .state import PendingStore, StateStore


class PendingIngestError(ApiError):
    pass


def searches_from_claim(claim: dict) -> list[Search]:
    UUID(claim["runId"])
    if not re.fullmatch(r"[a-f0-9]{64}", claim["leaseToken"]):
        raise ValueError("Invalid worker lease.")
    if (
        claim.get("maxResultsPerSearch"),
        claim.get("maxPagesPerSearch"),
        claim.get("maxResults"),
    ) != (50, 5, 200):
        raise ValueError("Unsupported discovery limits.")
    entries = claim["searches"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= 4:
        raise ValueError("A run must contain one to four saved searches.")
    searches = []
    seen = set()
    for entry in entries:
        index = entry["index"]
        if type(index) is not int or not 0 <= index <= 3 or index in seen:
            raise ValueError("Invalid saved-search index.")
        seen.add(index)
        if not 2 <= len(entry["query"]) <= 200 or not 2 <= len(entry["location"]) <= 200:
            raise ValueError("Invalid saved-search query or location.")
        if type(entry["remoteOnly"]) is not bool or type(entry["distance"]) is not int:
            raise ValueError("Invalid saved-search filters.")
        # Guest f_E=1 and f_E=2 returned the same senior-heavy rows as baseline in the live check.
        searches.append(
            Search(
                id=str(index),
                term=entry["query"],
                location=entry["location"],
                remote=entry["remoteOnly"],
                distance=entry["distance"],
            )
        )
    return searches


def ingest_pending(
    client: OpenApplyClient, pending: PendingStore, payload: dict, metrics: dict
) -> dict:
    try:
        result = client.ingest(payload)
    except ApiError as error:
        if error.expired_lease:
            pending.clear()
            return {"status": "expired_pending_run", "workerMetrics": metrics}
        raise PendingIngestError(str(error)) from None
    pending.clear()
    return {"status": "completed", **result, "workerMetrics": metrics}


def run_once(client: OpenApplyClient, state: StateStore, scrape_search=scrape) -> dict:
    state.ensure_writable()
    pending = PendingStore(state.path.with_name(f"{client.owner_key}.pending.json"))
    saved = pending.load()
    if saved is not None:
        return ingest_pending(client, pending, saved["payload"], saved["metrics"])
    if state.is_blocked():
        return {
            "status": "backoff",
            "backoffUntil": state.blocked_until(),
            "workerMetrics": {
                "requests": 0,
                "pagesFetched": 0,
                "stopReason": state.read().get("reason"),
            },
        }
    claim = client.claim()
    if claim is None:
        return {"status": "not_due_or_disabled"}
    searches = searches_from_claim(claim)
    batches = []
    stopped = False
    requests = 0
    for search in searches:
        batch = {"index": int(search.id), "status": "error", "pagesFetched": 0, "jobs": []}
        if not stopped:
            try:
                result = scrape_search(search, state)
                requests += result.requests
                batch["pagesFetched"] = result.pages
                if result.statuses:
                    batch["httpStatus"] = result.statuses[-1]
                if result.stop_reason in (None, "page_limit", "offset_limit"):
                    batch["status"] = "ok"
                elif result.stop_reason in ("network_error", "unparseable_jobs"):
                    batch["status"] = "error"
                else:
                    batch["status"] = "blocked"
                batch["jobs"] = [
                    {
                        "url": job["url"],
                        "title": job["title"],
                        "company": job["company"],
                        "location": job["location"],
                        "description": job.get("description") or "",
                        "datePosted": job.get("postedAt"),
                    }
                    for job in result.jobs[:50]
                ]
            except Exception:
                state.block("worker_error")
            stopped = batch["status"] != "ok" or state.is_blocked()
        batches.append(batch)
    payload = {"runId": claim["runId"], "leaseToken": claim["leaseToken"], "searches": batches}
    metrics = {
        "requests": requests,
        "pagesFetched": sum(batch["pagesFetched"] for batch in batches),
        "stopReason": state.read().get("reason") if stopped else None,
    }
    pending.save({"payload": payload, "metrics": metrics})
    return ingest_pending(client, pending, payload, metrics)
