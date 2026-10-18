"""Conditional GET for JSON read routes: ``ETag`` + ``If-None-Match`` → ``304``.

Applied as a ROUTE CLASS (``APIRouter(route_class=ConditionalGetRoute)``), not
inside the handlers, so a handler keeps returning its typed Pydantic model —
``response_model`` validation, the OpenAPI schema and every direct-call test
are unchanged — and the validator is computed from the bytes FastAPI actually
rendered.

* **ETag** — a weak tag over a SHA-256 of the exact body, so it is correct by
  construction: anything a reader could see change (an edit, an unpublish, a
  deletion that shifts a list page, an admin seeing drafts) changes it. A
  matching ``If-None-Match`` (RFC 9110 §13.1.2: weak comparison, a list, or
  ``*``) gets ``304`` with no body.
* **Last-Modified** — only for a single-resource body (a JSON object with an
  ``updated_at`` and no ``items``), from that ``updated_at``. ADVISORY ONLY:
  ``If-Modified-Since`` is deliberately NOT honoured, because the admin SQL
  console can change a row without bumping ``updated_at`` and a date-based 304
  would then serve stale content. RFC 9110 lets a server ignore it.
* ``Cache-Control: no-cache`` — a response carrying ``Last-Modified`` and no
  explicit freshness is HEURISTICALLY cacheable by any shared cache in front of
  us; ``no-cache`` keeps every reuse behind a revalidation.
* ``Vary: Authorization`` — an admin sees drafts an anonymous reader does not.

Only ``200`` JSON responses with a rendered body are touched: a 404, a
streamed image or a redirect passes through untouched.
"""

import hashlib
import json
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from email.utils import format_datetime
from typing import Any

from fastapi import Request, Response
from fastapi.routing import APIRoute


def weak_etag(body: bytes) -> str:
    return f'W/"{hashlib.sha256(body).hexdigest()[:32]}"'


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    """Weak comparison over a comma-separated list; ``*`` matches anything."""
    if not if_none_match:
        return False
    opaque = etag.removeprefix("W/")
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate == "*" or candidate.removeprefix("W/") == opaque:
            return True
    return False


def _last_modified(body: bytes) -> str | None:
    try:
        data = json.loads(body)
    except ValueError:
        return None
    if not isinstance(data, dict) or "items" in data:
        return None
    raw = data.get("updated_at")
    if not isinstance(raw, str):
        return None
    try:
        stamp = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return format_datetime(stamp.astimezone(UTC), usegmt=True)


def apply_validators(request: Request, response: Response) -> Response:
    """Add the validators to a rendered response; turn it into a 304 when the
    client already holds this exact representation."""
    body = getattr(response, "body", None)
    if (
        request.method != "GET"
        or response.status_code != 200
        or not isinstance(body, bytes)
        or not (response.media_type or "").startswith("application/json")
    ):
        return response
    etag = weak_etag(body)
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Authorization"}
    last_modified = _last_modified(body)
    if last_modified is not None:
        headers["Last-Modified"] = last_modified
    if etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return response


class ConditionalGetRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def conditional_handler(request: Request) -> Response:
            return apply_validators(request, await handler(request))

        return conditional_handler
