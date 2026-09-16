import uuid

from sqlalchemy import delete, select

from app.db.models import Document, DocumentChunk, User
from app.services import billing as billing_service
from app.services import documents as documents_service
from app.services import notes as notes_service
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# Create / list / get / update / delete — the note-picker + editor's own CRUD.
# ---------------------------------------------------------------------------


async def test_create_note_defaults_title_to_todays_date(http_client, auth_headers, db_session):
    resp = await http_client.post("/notes", headers=auth_headers, json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"]  # today's date string, non-empty
    assert body["id"]
    assert body["updated_at"]

    document = await db_session.get(Document, uuid.UUID(body["id"]))
    assert document is not None
    assert document.kind == "note"
    await documents_service.delete_document(db_session, document)


async def test_create_note_with_explicit_title(http_client, auth_headers, db_session):
    resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Chemistry — Sept 15"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Chemistry — Sept 15"

    document = await db_session.get(Document, uuid.UUID(body["id"]))
    await documents_service.delete_document(db_session, document)


async def test_new_note_does_not_appear_in_documents_list(http_client, auth_headers, db_session):
    """Decision 1: notes are a first-class, separately-listable thing, not folded into
    the existing uploaded-files Documents panel."""
    resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Should not leak"})
    note_id = resp.json()["id"]

    docs_resp = await http_client.get("/documents", headers=auth_headers)
    assert docs_resp.status_code == 200
    assert not any(d["id"] == note_id for d in docs_resp.json())

    notes_resp = await http_client.get("/notes", headers=auth_headers)
    assert any(n["id"] == note_id for n in notes_resp.json())

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_get_note_returns_empty_content_for_a_fresh_note(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Fresh"})
    note_id = create_resp.json()["id"]

    get_resp = await http_client.get(f"/notes/{note_id}", headers=auth_headers)
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["content"] == ""

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_patch_note_saves_content_and_title_and_rechunks_for_rag(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Draft"})
    note_id = create_resp.json()["id"]

    unique_marker = f"notemarker{uuid.uuid4().hex[:10]}"
    new_content = f"Photosynthesis converts light energy into chemical energy. {unique_marker}."

    patch_resp = await http_client.patch(
        f"/notes/{note_id}",
        headers=auth_headers,
        json={"title": "Biology — Photosynthesis", "content": new_content},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["title"] == "Biology — Photosynthesis"

    get_resp = await http_client.get(f"/notes/{note_id}", headers=auth_headers)
    assert get_resp.json()["content"] == new_content
    assert get_resp.json()["title"] == "Biology — Photosynthesis"

    # Proves reuse of the real chunk+embed pipeline, not a stub: real DocumentChunk rows
    # with real embeddings exist for this note, exactly like an uploaded file.
    rows = (
        (
            await db_session.execute(
                select(DocumentChunk).where(DocumentChunk.document_id == uuid.UUID(note_id))
            )
        )
        .scalars()
        .all()
    )
    assert rows, "expected chunked rows for the saved note content"
    assert any(unique_marker in row.content for row in rows)
    for row in rows:
        assert row.embedding is not None
        assert len(row.embedding) == 384

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_delete_note_cleans_up_chunks_same_as_document_deletion(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "To delete"})
    note_id = create_resp.json()["id"]
    await http_client.patch(
        f"/notes/{note_id}", headers=auth_headers, json={"title": "To delete", "content": "some real content here"}
    )

    delete_resp = await http_client.delete(f"/notes/{note_id}", headers=auth_headers)
    assert delete_resp.status_code == 200

    remaining_chunks = (
        (
            await db_session.execute(
                select(DocumentChunk).where(DocumentChunk.document_id == uuid.UUID(note_id))
            )
        )
        .scalars()
        .all()
    )
    assert remaining_chunks == []
    assert await db_session.get(Document, uuid.UUID(note_id)) is None


async def test_new_note_has_no_tags_by_default(http_client, auth_headers, db_session):
    resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Untagged"})
    body = resp.json()
    assert body["tags"] == []

    document = await db_session.get(Document, uuid.UUID(body["id"]))
    await documents_service.delete_document(db_session, document)


async def test_patch_tags_sets_trims_dedupes_and_persists(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Tag me"})
    note_id = create_resp.json()["id"]

    resp = await http_client.patch(
        f"/notes/{note_id}/tags",
        headers=auth_headers,
        json={"tags": [" Bio 101 ", "Midterm", "Bio 101", "", "  "]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["tags"] == ["Bio 101", "Midterm"]

    # Persisted -- a fresh GET reflects it, not just the PATCH response.
    get_resp = await http_client.get(f"/notes/{note_id}", headers=auth_headers)
    assert get_resp.json()["tags"] == ["Bio 101", "Midterm"]

    list_resp = await http_client.get("/notes", headers=auth_headers)
    listed = next(n for n in list_resp.json() if n["id"] == note_id)
    assert listed["tags"] == ["Bio 101", "Midterm"]

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_patch_tags_does_not_touch_content_or_updated_at_debounce_path(
    http_client, auth_headers, db_session
):
    """Tags are a separate, immediate write -- setting them must not require or disturb
    the note's content."""
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Content untouched"})
    note_id = create_resp.json()["id"]
    await http_client.patch(
        f"/notes/{note_id}", headers=auth_headers, json={"title": "Content untouched", "content": "real content"}
    )

    tags_resp = await http_client.patch(f"/notes/{note_id}/tags", headers=auth_headers, json={"tags": ["Lecture"]})
    assert tags_resp.status_code == 200

    get_resp = await http_client.get(f"/notes/{note_id}", headers=auth_headers)
    assert get_resp.json()["content"] == "real content"
    assert get_resp.json()["tags"] == ["Lecture"]

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_patch_tags_404s_for_another_users_note(http_client, auth_headers, db_session):
    user, document = await _make_note_and_owner(db_session)
    resp = await http_client.patch(
        f"/notes/{document.id}/tags", headers=auth_headers, json={"tags": ["nope"]}
    )
    assert resp.status_code == 404

    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_notes_list_sorted_by_most_recently_updated(http_client, auth_headers, db_session):
    first = await http_client.post("/notes", headers=auth_headers, json={"title": "Older"})
    second = await http_client.post("/notes", headers=auth_headers, json={"title": "Newer"})
    first_id, second_id = first.json()["id"], second.json()["id"]

    # Touch the first note's content so it becomes the most recently updated one.
    await http_client.patch(
        f"/notes/{first_id}", headers=auth_headers, json={"title": "Older", "content": "now touched"}
    )

    listing = (await http_client.get("/notes", headers=auth_headers)).json()
    ids_in_order = [n["id"] for n in listing if n["id"] in (first_id, second_id)]
    assert ids_in_order[0] == first_id

    for note_id in (first_id, second_id):
        document = await db_session.get(Document, uuid.UUID(note_id))
        if document is not None:
            await documents_service.delete_document(db_session, document)


# ---------------------------------------------------------------------------
# Ownership — a note belongs only to its creator, same pattern as every other
# per-user resource in this codebase.
# ---------------------------------------------------------------------------


async def _make_note_and_owner(db_session, title="not yours"):
    user = User(keycloak_sub=f"test-notes-owner-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    document = Document(
        user_id=user.id, filename=title, mime_type="text/markdown", minio_key="unused/note", kind="note"
    )
    db_session.add(document)
    await db_session.flush()
    await db_session.commit()
    return user, document


async def test_note_endpoints_404_for_another_users_note(http_client, auth_headers, db_session):
    user, document = await _make_note_and_owner(db_session)
    note_id = document.id

    assert (await http_client.get(f"/notes/{note_id}", headers=auth_headers)).status_code == 404
    assert (
        await http_client.patch(
            f"/notes/{note_id}", headers=auth_headers, json={"title": "x", "content": "y"}
        )
    ).status_code == 404
    assert (await http_client.delete(f"/notes/{note_id}", headers=auth_headers)).status_code == 404
    assert (
        await http_client.post(
            f"/notes/{note_id}/annotate",
            headers=auth_headers,
            json={"selected_text": "x", "context": "y", "action": "explain"},
        )
    ).status_code == 404

    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_notes_endpoints_404_for_a_plain_uploaded_document(http_client, auth_headers, db_session):
    """The reverse ownership guard: a real document owned by this same user that is
    kind="upload" (not a note) must still 404 through the /notes/{id} endpoints --
    guards against a future regression that drops the kind filter from
    _get_owned_note."""
    upload_resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("plain.txt", b"just an uploaded file, not a note", "text/plain")},
    )
    document_id = upload_resp.json()["id"]

    assert (await http_client.get(f"/notes/{document_id}", headers=auth_headers)).status_code == 404
    assert (await http_client.delete(f"/notes/{document_id}", headers=auth_headers)).status_code == 404

    document = await db_session.get(Document, uuid.UUID(document_id))
    await documents_service.delete_document(db_session, document)


# ---------------------------------------------------------------------------
# Full pipeline: a note's content is retrievable via RAG in a normal chat session,
# with zero new retrieval logic — proving "notes are just documents" end to end.
# ---------------------------------------------------------------------------


async def test_note_content_is_retrieved_into_rag_like_any_uploaded_document(db_session):
    from app.memory import rag as rag_memory

    user = User(keycloak_sub=f"test-notes-rag-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = await documents_service.create_note(db_session, user.id, "RAG check")
    unique_marker = f"noteragmarker{uuid.uuid4().hex[:10]}"
    content = f"A fact only in this note: {unique_marker} is the boiling point marker for this test."
    await documents_service.update_document_content(db_session, document, content)

    results = await rag_memory.retrieve_relevant_chunks(db_session, user.id, unique_marker, top_k=5)
    assert results, "expected the note's own chunk back — same retrieval path as an uploaded document"
    assert any(unique_marker in r.content for r in results)

    await documents_service.delete_document(db_session, document)
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# Annotate (explain/define/summarize) — one direct, stateless, unbilled call.
# ---------------------------------------------------------------------------


async def test_annotate_selection_returns_generated_text_for_each_action(monkeypatch):
    """Exercises app.services.notes.annotate_selection directly, the same way
    test_agents_tutor.py's provider-mocking tests call tutor.run_tutor directly rather
    than through HTTP -- the hermetic suite's http_client hits a REAL, separate uvicorn
    subprocess (see tests/conftest.py), so a monkeypatch in this test process would be
    invisible to it. Direct in-process calls are how this codebase already tests
    provider-dependent behavior without a real model."""
    for action, canned in (
        ("explain", "This means the derivative measures instantaneous rate of change."),
        ("define", "Derivative: the instantaneous rate of change of a function."),
        ("summarize", "The passage defines a derivative as a rate of change."),
    ):
        fake = ScriptedToolCallingProvider([[canned]])
        monkeypatch.setattr(notes_service, "get_provider", lambda **kwargs: (fake, "fake-model"))

        result = await notes_service.annotate_selection(
            "the derivative", "In calculus, the derivative describes how a function changes.", action
        )

        assert result == canned
        # No tool belt, no chat history — a single system+user turn, exactly like
        # _plan_narration.
        assert len(fake.calls_seen) == 1
        assert [t.role for t in fake.calls_seen[0]["messages"]] == ["system", "user"]


async def test_annotate_endpoint_returns_a_reasonably_scoped_response_over_http(
    http_client, auth_headers, db_session
):
    """A real HTTP round-trip through the router (auth, ownership check, JSON shape) --
    deliberately doesn't assert exact wording (the hermetic suite has no real model
    configured, see pytest.ini/test.yml, so this exercises the keyless EchoProvider
    fallback), just that the endpoint wires up correctly end to end."""
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Annotate me"})
    note_id = create_resp.json()["id"]

    resp = await http_client.post(
        f"/notes/{note_id}/annotate",
        headers=auth_headers,
        json={
            "selected_text": "the derivative",
            "context": "In calculus, the derivative describes how a function changes.",
            "action": "explain",
        },
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json()["text"], str) and resp.json()["text"].strip()

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_annotate_rejects_invalid_action(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/notes", headers=auth_headers, json={"title": "Bad action"})
    note_id = create_resp.json()["id"]

    resp = await http_client.post(
        f"/notes/{note_id}/annotate",
        headers=auth_headers,
        json={"selected_text": "x", "context": "y", "action": "rewrite"},
    )
    assert resp.status_code == 422

    document = await db_session.get(Document, uuid.UUID(note_id))
    await documents_service.delete_document(db_session, document)


async def test_annotate_selection_never_records_frontier_usage(monkeypatch):
    """Mirrors app/agents/tutor.py's own billing-isolation test for _plan_narration:
    annotate_selection must never touch billing_service.record_frontier_usage, since
    it's an unbilled operational cost like _plan_narration, not a routed frontier call.
    Calls annotate_selection directly (in-process) for the same reason the
    generated-text test above does -- see its docstring."""
    fake = ScriptedToolCallingProvider([["A short, on-topic answer."]])
    monkeypatch.setattr(notes_service, "get_provider", lambda **kwargs: (fake, "fake-model"))

    recorded: list[tuple] = []

    async def fake_record(user_id, model, prompt_tokens, completion_tokens):
        recorded.append((user_id, model, prompt_tokens, completion_tokens))
        return 5

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    result = await notes_service.annotate_selection("x", "y", "explain")

    assert result == "A short, on-topic answer."
    assert recorded == []
