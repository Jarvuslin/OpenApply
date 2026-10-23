import importlib.metadata
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup
from jobspy.linkedin import LinkedIn
from jobspy.linkedin.constant import headers
from jobspy.model import ScraperInput, Site
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .state import StateStore

JOBSPY_VERSION = "1.2.0"
ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
MAX_RESULTS = 50
MAX_PAGES = 5
MAX_RESPONSE_BYTES = 2_000_000


class StopSearch(RuntimeError):
    pass


@dataclass(frozen=True)
class Search:
    id: str
    term: str
    location: str
    remote: bool = False
    experience: str | None = None
    results: int = MAX_RESULTS
    distance: int = 25

    def __post_init__(self):
        if not self.id or not self.term.strip() or not self.location.strip():
            raise ValueError("Search id, term and location are required.")
        if self.experience not in (None, "1", "2"):
            raise ValueError("Only optional LinkedIn experience values 1 or 2 are supported.")
        if not 1 <= self.results <= MAX_RESULTS:
            raise ValueError("A search may request at most 50 results.")
        if not 1 <= self.distance <= 100:
            raise ValueError("Search distance must be between 1 and 100 miles.")


@dataclass
class SearchResult:
    search_id: str
    jobs: list[dict] = field(default_factory=list)
    requests: int = 0
    pages: int = 0
    stop_reason: str | None = None
    statuses: list[int] = field(default_factory=list)


class GuestSession(requests.Session):
    def __init__(
        self,
        search: Search,
        state: StateStore,
        fixture_dir: Path | None = None,
        page_limit: int = MAX_PAGES,
    ):
        super().__init__()
        if not 1 <= page_limit <= MAX_PAGES:
            raise ValueError("A search may fetch at most five pages.")
        self.search = search
        self.state = state
        self.fixture_dir = fixture_dir
        self.page_limit = page_limit
        self.result = SearchResult(search_id=search.id)
        self.trust_env = False
        self.proxies = {}
        self.auth = None
        self.headers.clear()
        self.headers.update(headers)
        retry = Retry(total=0, connect=0, read=0, redirect=0, status=0, other=0)
        self.mount("https://", HTTPAdapter(max_retries=retry))
        self.mount("http://", HTTPAdapter(max_retries=retry))

    def stop(self, reason: str, *, backoff: bool) -> None:
        self.result.stop_reason = reason
        if backoff:
            self.state.block(reason)
        raise StopSearch(reason)

    def request(self, method, url, **kwargs):
        parsed = urlsplit(url)
        if (
            method.upper() != "GET"
            or parsed.scheme != "https"
            or parsed.netloc != "www.linkedin.com"
            or parsed.path != urlsplit(ENDPOINT).path
            or parsed.query
            or parsed.fragment
        ):
            self.stop("unsupported_endpoint", backoff=True)
        if self.state.is_blocked():
            self.stop("backoff_active", backoff=False)
        if self.result.stop_reason:
            raise StopSearch(self.result.stop_reason)
        if self.result.requests >= self.page_limit:
            self.stop("page_limit", backoff=False)
        params = dict(kwargs.get("params") or {})
        start = params.get("start", 0)
        if not isinstance(start, int) or start < 0 or start >= MAX_RESULTS:
            self.stop("offset_limit", backoff=False)
        params.update(
            keywords=self.search.term,
            location=self.search.location,
            distance=self.search.distance,
            f_TPR="r86400",
        )
        params.pop("f_E", None)
        if self.search.experience:
            params["f_E"] = self.search.experience
        self.cookies.clear()
        self.headers.pop("Cookie", None)
        self.headers.pop("Authorization", None)
        self.result.requests += 1
        try:
            response = super().request(
                "GET",
                ENDPOINT,
                params=params,
                allow_redirects=False,
                timeout=(10, 20),
                verify=True,
                stream=True,
                proxies={},
            )
        except requests.RequestException:
            self.stop("network_error", backoff=True)
        self.result.statuses.append(response.status_code)
        if response.status_code != 200:
            response.close()
            self.stop(f"http_{response.status_code}", backoff=True)
        body = bytearray()
        try:
            for chunk in response.iter_content(64_000):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    self.stop("response_too_large", backoff=True)
        except requests.RequestException:
            self.stop("network_error", backoff=True)
        finally:
            response.close()
            self.cookies.clear()
        response._content = bytes(body)
        response._content_consumed = True
        if self.fixture_dir is not None:
            self.fixture_dir.mkdir(parents=True, exist_ok=True)
            (self.fixture_dir / f"{self.result.requests}.html").write_bytes(body)
        soup = BeautifulSoup(response.text, "html.parser")
        if not soup.find("div", class_="base-search-card"):
            self.stop("empty_or_blocked_page", backoff=True)
        self.result.pages += 1
        return response


def scrape(
    search: Search, state: StateStore, fixture_dir: Path | None = None, page_limit: int = MAX_PAGES
) -> SearchResult:
    if importlib.metadata.version("python-jobspy") != JOBSPY_VERSION:
        raise RuntimeError("The worker requires the tested python-jobspy==1.2.0 pin.")
    session = GuestSession(search, state, fixture_dir, page_limit)
    scraper = LinkedIn(proxies=None)
    scraper.session.close()
    scraper.session = session
    try:
        response = scraper.scrape(
            ScraperInput(
                site_type=[Site.LINKEDIN],
                search_term=search.term,
                location=search.location,
                is_remote=search.remote,
                results_wanted=search.results,
                hours_old=24,
                fetch_description=False,
                offset=0,
                distance=search.distance,
            )
        )
        for job in response.jobs[: search.results]:
            title = job.title.strip()
            company = (job.company_name or "").strip()
            location = job.location.display_location() if job.location else ""
            if not title or title == "N/A" or not company or company == "N/A":
                continue
            if len(title) > 500 or len(company) > 300 or len(location) > 500:
                continue
            if not re.fullmatch(r"https://www\.linkedin\.com/jobs/view/\d+", job.job_url):
                continue
            session.result.jobs.append(
                {
                    "id": job.id,
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": job.job_url,
                    "companyUrl": job.company_url,
                    "postedAt": job.date_posted.isoformat() if job.date_posted else None,
                    "description": job.description,
                }
            )
        if not session.result.jobs and session.result.pages and not session.result.stop_reason:
            session.result.stop_reason = "unparseable_jobs"
            state.block("unparseable_jobs")
        return session.result
    finally:
        session.close()
