from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .errors import (APIError, api_error_handler, integrity_error_handler,
                     unhandled_error_handler)
from .routers import audit, core, daily, documents, org_structure, orgs, projects

settings = get_settings()

app = FastAPI(
    title="CounciLog API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=False,  # Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["authorization", "content-type", "x-org-id"],
)

app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(IntegrityError, integrity_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

for r in (core.router, orgs.router, org_structure.router,
          daily.router, projects.router, documents.router, audit.router):
    app.include_router(r, prefix="/api/v1")
