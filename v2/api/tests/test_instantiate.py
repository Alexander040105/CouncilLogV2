from datetime import date
from types import SimpleNamespace as NS

from app.services import instantiate


def test_include_if_event_type_matches():
    items = [
        {"ord": 1, "label": "concept paper"},
        {"ord": 2, "label": "RFP", "rule_json": {"include_if_event_type": "webinar_intl"}},
    ]
    out = instantiate.instantiate_checklist(items, event_type="webinar_intl")
    assert [i["label"] for i in out] == ["concept paper", "RFP"]
    out = instantiate.instantiate_checklist(items, event_type="seminar")
    assert [i["label"] for i in out] == ["concept paper"]


def test_exclude_if_event_type():
    items = [
        {"ord": 1, "label": "x", "rule_json": {"exclude_if_event_type": "ces"}},
        {"ord": 2, "label": "bennyl", "rule_json": {"include_if_event_type": "ces"}},
    ]
    assert [i["label"] for i in instantiate.instantiate_checklist(items, event_type="ces")] == ["bennyl"]
    assert [i["label"] for i in instantiate.instantiate_checklist(items, event_type="seminar")] == ["x"]


def test_due_days_rules():
    t = date(2026, 10, 30)
    before = instantiate.compute_due({"due_days_before_event": 15}, t)
    after = instantiate.compute_due({"due_days_after_event": 7}, t)
    assert before == date(2026, 10, 15)
    assert after == date(2026, 11, 6)
    assert instantiate.compute_due(None, t) is None
    assert instantiate.compute_due({"due_days_before_event": 15}, None) is None


def test_chain_conditional_steps():
    steps = [
        {"ord": 1, "label": "SSC President"},
        {"ord": 2, "label": "SAS"},
        {"ord": 3, "label": "SD"},
        {"ord": 4, "label": "RFP", "condition_json": {"include_if_event_type": "webinar_intl"}},
    ]
    assert [s["label"] for s in instantiate.instantiate_chain(steps, event_type="webinar_intl")] \
        == ["SSC President", "SAS", "SD", "RFP"]
    assert [s["label"] for s in instantiate.instantiate_chain(steps, event_type=None)] \
        == ["SSC President", "SAS", "SD"]


def test_flag_conditions():
    steps = [
        {"ord": 1, "label": "standard"},
        {"ord": 2, "label": "Marketing", "condition_json": {"include_if_flag": "has_merch"}},
    ]
    assert len(instantiate.instantiate_chain(steps, event_type=None, flags={"has_merch": True})) == 2
    assert len(instantiate.instantiate_chain(steps, event_type=None, flags={})) == 1


def test_flag_gated_checklist_items():
    items = [
        {"ord": 1, "label": "always"},
        {"ord": 2, "label": "CHED letter", "rule_json": {"include_if_flag": "off_campus"}},
    ]
    on = instantiate.instantiate_checklist(items, event_type=None, flags={"off_campus": True})
    off = instantiate.instantiate_checklist(items, event_type=None, flags={"off_campus": False})
    assert [i["label"] for i in on] == ["always", "CHED letter"]
    assert [i["label"] for i in off] == ["always"]
    # absent key is the same as false
    assert [i["label"] for i in instantiate.instantiate_checklist(items, event_type=None)] == ["always"]


def test_combined_flag_and_due_rule():
    t = date(2026, 10, 30)
    items = [
        {"ord": 1, "label": "CHED letter",
         "rule_json": {"include_if_flag": "off_campus", "due_days_before_event": 15}},
    ]
    on = instantiate.instantiate_checklist(
        items, event_type=None, flags={"off_campus": True}, target_date=t)
    assert len(on) == 1 and on[0]["due_date"] == date(2026, 10, 15)
    assert instantiate.instantiate_checklist(items, event_type=None, flags={}, target_date=t) == []


def test_event_and_flag_both_required():
    # a rule carrying both keys must satisfy both (AND semantics)
    items = [
        {"ord": 1, "label": "x",
         "rule_json": {"include_if_event_type": "webinar_intl", "include_if_flag": "off_campus"}},
    ]
    assert instantiate.instantiate_checklist(
        items, event_type="webinar_intl", flags={"off_campus": True})
    assert not instantiate.instantiate_checklist(
        items, event_type="webinar_intl", flags={})
    assert not instantiate.instantiate_checklist(
        items, event_type="seminar", flags={"off_campus": True})


def tpl(track, event_type=None):
    return NS(track=track, event_type=event_type)


def test_diagnose_no_needs():
    out = instantiate.diagnose_checklist(
        [tpl("paper")], needs_paper=False, needs_logistics=False, event_type=None)
    assert out == "no_needs"


def test_diagnose_no_templates():
    out = instantiate.diagnose_checklist(
        [], needs_paper=True, needs_logistics=False, event_type=None)
    assert out == "no_templates"


def test_diagnose_track_mismatch():
    out = instantiate.diagnose_checklist(
        [tpl("paper")], needs_paper=False, needs_logistics=True, event_type=None)
    assert out == "track_mismatch"


def test_diagnose_event_type_mismatch():
    out = instantiate.diagnose_checklist(
        [tpl("paper", "seminar")], needs_paper=True, needs_logistics=False,
        event_type="competition")
    assert out == "event_type_mismatch"


def test_diagnose_matched():
    # templates matched — zero items downstream means items_filtered
    out = instantiate.diagnose_checklist(
        [tpl("paper"), tpl("both", "seminar")], needs_paper=True,
        needs_logistics=False, event_type="seminar")
    assert out == "items_filtered"
