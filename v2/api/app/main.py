from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.exc import IntegrityError

from .cache import CacheHeadersMiddleware
from .config import get_settings
from .errors import (APIError, UnhandledErrorMiddleware, api_error_handler,
                     integrity_error_handler, unhandled_error_handler)
from .routers import (admin, audit, core, daily, documents, internal,
                      notifications, org_structure, orgs, projects, tasks)

settings = get_settings()

_docs_enabled = settings.env != "prod"
app = FastAPI(
    title="CounciLog API",
    version="0.1.0",
    docs_url="/api/v1/docs" if _docs_enabled else None,
    openapi_url="/api/v1/openapi.json" if _docs_enabled else None,
)

_origins = [settings.web_origin] + [
    o.strip() for o in settings.web_origin_extra.split(",") if o.strip()]

# Added before CORSMiddleware so it runs inside it — the 500 it produces
# still carries CORS headers instead of surfacing as a CORS failure.
app.add_middleware(UnhandledErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # Dev previews/proxies land on arbitrary 127.0.0.1 ports; safe because
    # auth is Bearer headers, not cookies, and credentials are off anyway.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?" if settings.env == "dev" else None,
    allow_credentials=False,  # Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["authorization", "content-type", "x-org-id"],
)

# Outermost: stamps tiered Cache-Control on GETs that didn't set their own —
# private everywhere (browser-only reuse), no-store as the default (app/cache.py).
app.add_middleware(CacheHeadersMiddleware)

app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(IntegrityError, integrity_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

for r in (core.router, orgs.router, org_structure.router,
          daily.router, projects.router, documents.router, tasks.router,
          notifications.router, internal.router, audit.router, admin.router):
    app.include_router(r, prefix="/api/v1")
