import uuid

import pytest

from app.deps import ROLE_RANK, Membership


def test_role_rank_order():
    assert ROLE_RANK["member"] < ROLE_RANK["officer"]
    assert ROLE_RANK["officer"] < ROLE_RANK["adviser"]
    assert ROLE_RANK["adviser"] < ROLE_RANK["owner"]


def test_membership_at_least():
    m = Membership(org_id=uuid.uuid4(), user_id="u", role="officer")
    assert m.at_least("member") and m.at_least("officer")
    assert not m.at_least("adviser") and not m.at_least("owner")


@pytest.mark.parametrize("role,allowed", [
    ("owner", True), ("adviser", True), ("officer", False), ("member", False),
])
def test_admin_gate(role, allowed):
    m = Membership(org_id=uuid.uuid4(), user_id="u", role=role)
    assert m.at_least("adviser") == allowed
