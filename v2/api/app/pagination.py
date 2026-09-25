from datetime import date, datetime
from zoneinfo import ZoneInfo

from .config import get_settings


def org_today() -> date:
    """'Today' in the org timezone (Asia/Manila default)."""
    return datetime.now(ZoneInfo(get_settings().org_timezone)).date()


def page_params(page: int, page_size: int) -> tuple[int, int]:
    return max(page, 1), min(max(page_size, 1), 100)


def envelope(items: list, page: int, page_size: int, total: int) -> dict:
    return {
        "data": items,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalItems": total,
            "totalPages": (total + page_size - 1) // page_size if page_size else 1,
        },
    }
