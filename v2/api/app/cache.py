"""GET response Cache-Control by path tier (spec §927 perf pass).

Three tiers, matched most-specific-first on the path after /api/v1:
  near-static org config  → private, max-age=60, stale-while-revalidate=300
  list views              → private, max-age=10
  everything else GET     → no-store (conservative default — org data,
                            freshness-critical reads, and anything not yet
                            classified can never sit in a cache)

`private` everywhere: org data must never land in a shared CDN cache —
this only tells the *browser* it may reuse a response briefly, which pairs
with the client's staleTime to cut refetch chatter. A route that sets its
own Cache-Control wins (the middleware never overwrites).
"""
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

ORG = r"/orgs/[^/]+"

_SLOW = "private, max-age=60, stale-while-revalidate=300"
_LIST = "private, max-age=10"
_NONE = "no-store"

# Ordered: first match wins. Keep detail/wildcard patterns above their
# list parents (e.g. documents/{id} before documents).
_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"^{ORG}/documents/[^/]+/movements/[^/]+/photo$"), _NONE),
    (re.compile(rf"^{ORG}/documents/[^/]+$"), _NONE),
    (re.compile(rf"^{ORG}/projects/[^/]+(/.*)?$"), _NONE),
    (re.compile(rf"^{ORG}/tasks/[^/]+$"), _NONE),
    (re.compile(rf"^{ORG}/photos/[^/]+/url$"), _NONE),
    (re.compile(rf"^{ORG}/notifications"), _NONE),
    (re.compile(rf"^{ORG}/attendance"), _NONE),
    (re.compile(rf"^{ORG}/checklist-items"), _NONE),
    (re.compile(rf"^{ORG}/audit"), _NONE),
    (re.compile(rf"^{ORG}/invites"), _NONE),
    (re.compile(rf"^{ORG}/join-requests"), _NONE),
    (re.compile(r"^/me"), _NONE),
    (re.compile(r"^/admin"), _NONE),
    (re.compile(r"^/internal"), _NONE),
    (re.compile(rf"^{ORG}/school-years$"), _SLOW),
    (re.compile(rf"^{ORG}/positions$"), _SLOW),
    (re.compile(rf"^{ORG}/org-chart$"), _SLOW),
    (re.compile(rf"^{ORG}/duty-schedule$"), _SLOW),
    (re.compile(rf"^{ORG}/contacts$"), _SLOW),
    (re.compile(rf"^{ORG}/signatory-chains$"), _SLOW),
    (re.compile(rf"^{ORG}/checklist-templates$"), _SLOW),
    (re.compile(rf"^{ORG}/projects$"), _LIST),
    (re.compile(rf"^{ORG}/documents$"), _LIST),
    (re.compile(rf"^{ORG}/tasks$"), _LIST),
    (re.compile(rf"^{ORG}/journal$"), _LIST),
    (re.compile(rf"^{ORG}/members$"), _LIST),
    (re.compile(rf"^{ORG}$"), _LIST),
]


def cache_tier(path: str) -> str:
    """Map a request path (incl. /api/v1 prefix) to a Cache-Control value."""
    path = re.sub(r"^/api/v\d+", "", path)
    for pattern, value in _RULES:
        if pattern.match(path):
            return value
    return _NONE


class CacheHeadersMiddleware(BaseHTTPMiddleware):
    """Stamp Cache-Control on GET responses the route didn't set itself."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.method == "GET" and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = cache_tier(request.url.path)
        return response
