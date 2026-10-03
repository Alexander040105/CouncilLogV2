import logging
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


def error_body(code: str, message: str, details: Any | None = None) -> dict:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


class APIError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str, details: Any | None = None):
        super().__init__(status_code=status_code)
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str = "resource") -> APIError:
    return APIError(404, "NOT_FOUND", f"{what} not found")


def forbidden(message: str = "Not authorized") -> APIError:
    return APIError(403, "FORBIDDEN", message)


async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(exc.code, exc.message, exc.details),
    )


async def integrity_error_handler(_: Request, exc: IntegrityError) -> JSONResponse:
    # Unique/FK violations are client conflicts, not server faults.
    return JSONResponse(
        status_code=409,
        content=error_body("CONFLICT", "A record with those values already exists"),
    )


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Never leak internals — generic 500 only.
    return JSONResponse(
        status_code=500,
        content=error_body("INTERNAL_ERROR", "Something went wrong"),
    )


class UnhandledErrorMiddleware:
    """500 catch-all registered INSIDE the CORS layer.

    FastAPI's Exception handler runs in ServerErrorMiddleware — outside
    CORSMiddleware — so bare 500s carry no Access-Control-Allow-Origin and
    browsers report a CORS failure instead of the real error body. Catching
    here means the response passes back through CORS and keeps its headers.
    Registered before add_middleware(CORSMiddleware) in main.py.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        except Exception:
            logger.exception("unhandled request error")
            await JSONResponse(
                status_code=500,
                content=error_body("INTERNAL_ERROR", "Something went wrong"),
            )(scope, receive, send)
