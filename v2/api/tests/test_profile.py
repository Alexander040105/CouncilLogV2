"""Unit tests for the /me self-service surface — no DB required."""
import uuid

import pytest
from pydantic import ValidationError

from app.errors import APIError
from app.routers.core import MePatch, _avatar_url_prefix, _validate_avatar_url


def test_me_patch_rejects_privilege_fields():
    """The allowlist is the whole point: role/org/status must never be writable."""
    with pytest.raises(ValidationError):
        MePatch(role="owner")
    with pytest.raises(ValidationError):
        MePatch(display_name="ok", org_id=str(uuid.uuid4()))
    with pytest.raises(ValidationError):
        MePatch(status="active")


def test_me_patch_allows_profile_fields():
    m = MePatch(display_name="AJ", avatar_url=None)
    assert m.display_name == "AJ" and m.avatar_url is None
    assert m.model_fields_set == {"display_name", "avatar_url"}


def test_avatar_url_scoped_to_own_user():
    uid = uuid.uuid4()
    prefix = _avatar_url_prefix(uid)
    _validate_avatar_url(prefix + f"{uuid.uuid4()}", uid)  # own upload — ok
    _validate_avatar_url(None, uid)  # clearing — ok

    other = uuid.uuid4()
    with pytest.raises(APIError) as e:
        _validate_avatar_url(_avatar_url_prefix(other) + f"{uuid.uuid4()}", uid)
    assert e.value.code == "BAD_AVATAR_URL"


def test_avatar_url_rejects_arbitrary_urls():
    uid = uuid.uuid4()
    for bad in [
        "https://evil.example.com/x.jpg",
        "javascript:alert(1)",
        "data:image/png;base64,xxxx",
        _avatar_url_prefix(uid)[:-1] + "evil/x.jpg",  # sibling path escape
    ]:
        with pytest.raises(APIError):
            _validate_avatar_url(bad, uid)
