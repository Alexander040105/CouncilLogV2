"""Workflow instantiation — pure functions, unit-tested.

Rules evaluated at instantiate-time only; instances are snapshots so later
template edits never rewrite live projects/documents.

rule_json (checklist items):
  {"due_days_before_event": 15}  → due_date = target_date - 15d
  {"due_days_after_event": 7}    → due_date = target_date + 7d
  {"include_if_event_type": "webinar_intl"}   → include only when match
  {"exclude_if_event_type": "webinar_intl"}   → exclude when match

condition_json (signatory steps):
  {"include_if_event_type": "webinar_intl"} → e.g. RFP step
  {"include_if_flag": "has_merch"}          → e.g. Marketing step
"""

from datetime import date, timedelta
from typing import Any


def _event_ok(rule: dict[str, Any] | None, event_type: str | None) -> bool:
    if not rule:
        return True
    if (v := rule.get("include_if_event_type")) is not None and v != event_type:
        return False
    if (v := rule.get("exclude_if_event_type")) is not None and v == event_type:
        return False
    return True


def flag_ok(rule: dict[str, Any] | None, flags: dict[str, bool]) -> bool:
    if not rule:
        return True
    if (flag := rule.get("include_if_flag")) is not None and not flags.get(flag, False):
        return False
    return True


def compute_due(rule: dict[str, Any] | None, target_date: date | None) -> date | None:
    if not rule or target_date is None:
        return None
    if (n := rule.get("due_days_before_event")) is not None:
        return target_date - timedelta(days=int(n))
    if (n := rule.get("due_days_after_event")) is not None:
        return target_date + timedelta(days=int(n))
    return None


def instantiate_checklist(
    items: list[dict],
    *,
    event_type: str | None,
    flags: dict[str, bool] | None = None,
    target_date: date | None = None,
) -> list[dict]:
    """Filter template items by rules → instance rows preserving ord."""
    flags = flags or {}
    out = []
    for it in sorted(items, key=lambda x: x["ord"]):
        rule = it.get("rule_json")
        if not _event_ok(rule, event_type) or not flag_ok(rule, flags):
            continue
        out.append({**it, "due_date": compute_due(rule, target_date)})
    return out


def instantiate_chain(
    steps: list[dict],
    *,
    event_type: str | None,
    flags: dict[str, bool] | None = None,
) -> list[dict]:
    """Filter signatory template steps by conditions → instance snapshot."""
    flags = flags or {}
    return [
        s
        for s in sorted(steps, key=lambda x: x["ord"])
        if _event_ok(s.get("condition_json"), event_type) and flag_ok(s.get("condition_json"), flags)
    ]


# reason values — mirrored client-side in web/src/lib/rules.js (keep in sync)
def diagnose_checklist(
    templates_all: list[Any],
    *,
    needs_paper: bool,
    needs_logistics: bool,
    event_type: str | None,
) -> str:
    """Why auto-match will produce zero items. Caller adds 'ok'/'items_filtered'
    once actual generation is known; explicit-ids path uses 'templates_not_found'."""
    if not needs_paper and not needs_logistics:
        return "no_needs"
    if not templates_all:
        return "no_templates"
    wanted = (["paper", "both"] if needs_paper else []) + \
             (["logistics", "both"] if needs_logistics else [])
    on_track = [t for t in templates_all if t.track in wanted]
    if not on_track:
        return "track_mismatch"
    if not [t for t in on_track if t.event_type is None or t.event_type == event_type]:
        return "event_type_mismatch"
    return "items_filtered"  # templates matched → zero items means rules/empty filtered all
