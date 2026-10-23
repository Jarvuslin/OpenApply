import hashlib
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class ApiError(RuntimeError):
    def __init__(self, message: str, *, expired_lease: bool = False):
        super().__init__(message)
        self.expired_lease = expired_lease


class OpenApplyClient:
    def __init__(self, base_url: str, token: str):
        url = urlsplit(base_url)
        local = url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")
        if (
            (url.scheme != "https" and not local)
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path.rstrip("/") not in ("", "/api")
        ):
            raise ValueError(
                "OPENAPPLY_API_URL must be an HTTPS API origin (HTTP loopback is allowed for development)."
            )
        if not token.strip() or any(character.isspace() for character in token):
            raise ValueError("OPENAPPLY_API_TOKEN must contain a personal API token.")
        self.base_url = f"{url.scheme}://{url.netloc}/api/job-sources/linkedin"
        self.owner_key = hashlib.sha256(token.encode()).hexdigest()
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.proxies = {}
        self.session.headers.update(Authorization=f"Bearer {token}", Accept="application/json")
        self.session.mount("https://", HTTPAdapter(max_retries=Retry(total=0)))
        self.session.mount("http://", HTTPAdapter(max_retries=Retry(total=0)))

    def post(self, path: str, body: dict, *, allow_conflict: bool = False) -> dict | None:
        self.session.cookies.clear()
        try:
            response = self.session.post(
                f"{self.base_url}/{path}",
                json=body,
                allow_redirects=False,
                timeout=(10, 300),
                verify=True,
            )
        except requests.RequestException:
            raise ApiError("OpenApply request failed; no automatic retry was attempted.") from None
        try:
            if allow_conflict and response.status_code == 409:
                return None
            if response.status_code != 200:
                expired = False
                if response.status_code == 409:
                    try:
                        expired = (
                            response.json().get("message") == "This discovery run's lease expired."
                        )
                    except (ValueError, AttributeError):
                        pass
                raise ApiError(
                    f"OpenApply returned HTTP {response.status_code}; no automatic retry was attempted.",
                    expired_lease=expired,
                )
            try:
                value = response.json()
            except ValueError:
                raise ApiError("OpenApply returned an invalid response.") from None
            if not isinstance(value, dict):
                raise ApiError("OpenApply returned an invalid response.")
            return value
        finally:
            response.close()
            self.session.cookies.clear()

    def claim(self) -> dict | None:
        return self.post("runs", {}, allow_conflict=True)

    def ingest(self, payload: dict) -> dict:
        return self.post("ingest", payload)

    def close(self) -> None:
        self.session.close()
