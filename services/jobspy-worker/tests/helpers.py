from pathlib import Path

import requests

CARD = (Path(__file__).parent / "fixtures/linkedin-card.html").read_text(encoding="utf-8")


def response(request, status=200, body=CARD):
    result = requests.Response()
    result.status_code = status
    result._content = body.encode()
    result._content_consumed = True
    result.encoding = "utf-8"
    result.url = request.url
    result.request = request
    return result
