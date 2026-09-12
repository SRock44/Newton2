import uuid

from app.services.images import get_image_for_session

# The smallest possible valid PNG (1x1, transparent) — real bytes a real image decoder
# would accept, not just an arbitrary blob, so this exercises the actual upload path
# rather than assuming any bytes work.
_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def test_upload_image_returns_an_id_readable_only_from_its_own_session(
    http_client, auth_headers, created_session_ids
):
    session_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = session_resp.json()["session_id"]
    created_session_ids.append(uuid.UUID(session_id))

    upload_resp = await http_client.post(
        f"/chat/sessions/{session_id}/images",
        headers=auth_headers,
        files={"file": ("problem.png", _TINY_PNG, "image/png")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    image_id = upload_resp.json()["image_id"]

    found = await get_image_for_session(session_id, image_id)
    assert found is not None
    raw, mime_type = found
    assert raw == _TINY_PNG
    assert mime_type == "image/png"

    # not visible from a different session, even with a syntactically valid id
    assert await get_image_for_session(str(uuid.uuid4()), image_id) is None


async def test_upload_image_rejects_unsupported_type(http_client, auth_headers, created_session_ids):
    session_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = session_resp.json()["session_id"]
    created_session_ids.append(uuid.UUID(session_id))

    resp = await http_client.post(
        f"/chat/sessions/{session_id}/images",
        headers=auth_headers,
        files={"file": ("notes.txt", b"just some text", "text/plain")},
    )
    assert resp.status_code == 400


async def test_upload_image_404_for_foreign_or_missing_session(http_client, auth_headers):
    resp = await http_client.post(
        f"/chat/sessions/{uuid.uuid4()}/images",
        headers=auth_headers,
        files={"file": ("problem.png", _TINY_PNG, "image/png")},
    )
    assert resp.status_code == 404


async def test_get_image_for_session_returns_none_for_unknown_id():
    assert await get_image_for_session(str(uuid.uuid4()), str(uuid.uuid4())) is None
