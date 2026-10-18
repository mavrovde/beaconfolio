"""``X-Robots-Tag: noindex`` on the API's JSON responses.

The public site is server-rendered: what a search engine should index is the
HTML page, which already carries the post, the profile and their metadata. The
JSON the page was rendered FROM (``/api/app/posts?page=3``, ``/config/site``,
…) is reachable by URL too, and a crawler that follows one indexes a bare JSON
document as a duplicate, title-less result. ``noindex`` on those responses
keeps them out of the index WITHOUT blocking them in ``robots.txt`` — a
renderer that fetches them to build the page still can, which a ``Disallow``
would prevent.

Exempt: the documented machine surfaces whose whole purpose is to be found and
read by agents (:data:`INDEXABLE_API_PATHS`), and every non-JSON response — a
post image served from ``/posts/{id}/image`` should stay eligible for image
search. A header the route set itself is never overwritten.

Pure ASGI (not ``BaseHTTPMiddleware``): it only edits the response-start
message, so streamed NDJSON and background tasks are untouched.
"""

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

NOINDEX = b"noindex"
# Relative to the API prefix. resume.json is linked from /llms.txt and
# advertised as the one request an agent needs (#252).
INDEXABLE_API_PATHS = frozenset({"/profile/resume.json"})


class ApiNoindexMiddleware:
    def __init__(self, app: ASGIApp, api_prefix: str) -> None:
        self.app = app
        self.api_prefix = api_prefix.rstrip("/")

    def _applies(self, path: str) -> bool:
        if not path.startswith(self.api_prefix + "/"):
            return False
        return path[len(self.api_prefix) :] not in INDEXABLE_API_PATHS

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self._applies(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {name.lower() for name, _ in headers}
                content_type = next(
                    (v for n, v in headers if n.lower() == b"content-type"), b""
                )
                if (
                    content_type.split(b";")[0].strip() == b"application/json"
                    and b"x-robots-tag" not in names
                ):
                    headers.append((b"x-robots-tag", NOINDEX))
                    message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_header)
