import asyncio
import io
import json
import uuid

import pytest_asyncio
import websockets
from sqlalchemy import delete, select

from app.db.models import ChatMessage, ChatSession, Document, DocumentChunk, User
from app.memory import rag as rag_memory
from app.memory import working as working_memory
from app.services import documents as documents_service

WS_BASE_URL = "ws://localhost:8000"


# ---------------------------------------------------------------------------
# Pure unit tests for the chunker — no DB, no network.
# ---------------------------------------------------------------------------


def test_chunk_text_produces_overlapping_chunks_for_multi_paragraph_input():
    paragraphs = [f"Paragraph {i}: " + ("lorem ipsum dolor sit amet " * 6) for i in range(8)]
    text = "\n\n".join(paragraphs)
    assert len(text) > 1000  # sanity: long enough that it must span multiple chunks

    chunks = rag_memory.chunk_text(text, chunk_size=300, overlap=60)

    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks)

    # consecutive chunks genuinely overlap by the requested amount
    for i in range(len(chunks) - 1):
        assert chunks[i][-60:] == chunks[i + 1][:60]

    # stitching the chunks back together (respecting the overlap) reproduces the
    # original text — nothing in the middle got dropped
    reconstructed = chunks[0]
    for c in chunks[1:]:
        reconstructed += c[60:]
    assert reconstructed == text.strip()


def test_chunk_text_returns_empty_list_for_blank_input():
    assert rag_memory.chunk_text("   \n\n  ") == []


def test_chunk_text_returns_single_chunk_when_shorter_than_chunk_size():
    text = "just one short paragraph, well under the chunk size."
    assert rag_memory.chunk_text(text, chunk_size=1000, overlap=200) == [text]


def test_chunk_text_rejects_overlap_not_smaller_than_chunk_size():
    try:
        rag_memory.chunk_text("anything", chunk_size=100, overlap=100)
        assert False, "expected ValueError"
    except ValueError:
        pass


# ---------------------------------------------------------------------------
# Upload -> chunks land in the DB with embeddings.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def uploaded_document(http_client, auth_headers, db_session):
    content = ("The mitochondria is the powerhouse of the cell. " * 40).encode()
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("biology-notes.txt", content, "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    document_id = uuid.UUID(resp.json()["id"])

    yield document_id

    document = await db_session.get(Document, document_id)
    if document is not None:
        await documents_service.delete_document(db_session, document)


async def test_upload_stores_chunks_with_embeddings(uploaded_document, db_session):
    rows = (
        (
            await db_session.execute(
                select(DocumentChunk).where(DocumentChunk.document_id == uploaded_document)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) > 1, "the fixture's content is long enough to need multiple chunks"
    for row in rows:
        assert row.embedding is not None
        assert len(row.embedding) == 384


async def test_upload_rejects_unsupported_file_type(http_client, auth_headers):
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("photo.png", b"\x89PNG\r\n not really a png", "image/png")},
    )
    assert resp.status_code == 400


async def test_upload_rejects_oversized_file(http_client, auth_headers):
    oversized = b"x" * (documents_service.MAX_UPLOAD_BYTES + 1)
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("huge.txt", oversized, "text/plain")},
    )
    assert resp.status_code == 400


async def test_list_and_delete_document_via_api(http_client, auth_headers, db_session):
    content = b"A short note for the list and delete test."
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("scratch.txt", content, "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["id"]

    list_resp = await http_client.get("/documents", headers=auth_headers)
    assert list_resp.status_code == 200
    assert any(d["id"] == document_id for d in list_resp.json())

    delete_resp = await http_client.delete(f"/documents/{document_id}", headers=auth_headers)
    assert delete_resp.status_code == 200

    remaining = (
        (
            await db_session.execute(
                select(DocumentChunk).where(DocumentChunk.document_id == uuid.UUID(document_id))
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []

    remaining_doc = await db_session.get(Document, uuid.UUID(document_id))
    assert remaining_doc is None


# ---------------------------------------------------------------------------
# Security property: a user must never retrieve another user's chunks.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def two_throwaway_users(db_session):
    user_a = User(keycloak_sub=f"test-rag-a-{uuid.uuid4()}")
    user_b = User(keycloak_sub=f"test-rag-b-{uuid.uuid4()}")
    db_session.add_all([user_a, user_b])
    await db_session.commit()

    yield user_a, user_b

    user_ids = [user_a.id, user_b.id]
    doc_id_subquery = select(Document.id).where(Document.user_id.in_(user_ids))
    await db_session.execute(delete(DocumentChunk).where(DocumentChunk.document_id.in_(doc_id_subquery)))
    await db_session.execute(delete(Document).where(Document.user_id.in_(user_ids)))
    await db_session.execute(delete(User).where(User.id.in_(user_ids)))
    await db_session.commit()


async def test_retrieve_relevant_chunks_never_returns_another_users_chunks(
    db_session, two_throwaway_users
):
    user_a, user_b = two_throwaway_users

    doc_a = Document(user_id=user_a.id, filename="a.txt", mime_type="text/plain", minio_key="unused/a")
    doc_b = Document(user_id=user_b.id, filename="b.txt", mime_type="text/plain", minio_key="unused/b")
    db_session.add_all([doc_a, doc_b])
    await db_session.flush()

    # Deliberately identical content for both users' documents: if the retrieval query
    # weren't actually scoped by the documents.user_id join, both users would come back
    # with the same (tied-distance) results for the same query.
    shared_text = "Private notes about the French Revolution and its underlying causes."
    await rag_memory.store_document_chunks(db_session, doc_a.id, shared_text)
    await rag_memory.store_document_chunks(db_session, doc_b.id, shared_text)
    await db_session.commit()

    results_a = await rag_memory.retrieve_relevant_chunks(
        db_session, user_a.id, "French Revolution causes", top_k=10
    )
    assert results_a, "expected at least one chunk back for user A"
    assert all(r.document_id == doc_a.id for r in results_a)

    results_b = await rag_memory.retrieve_relevant_chunks(
        db_session, user_b.id, "French Revolution causes", top_k=10
    )
    assert results_b, "expected at least one chunk back for user B"
    assert all(r.document_id == doc_b.id for r in results_b)


# ---------------------------------------------------------------------------
# Full pipeline: upload -> chat -> retrieved chunk actually lands in the Tier 1 bundle.
# ---------------------------------------------------------------------------


async def test_uploaded_document_content_is_retrieved_into_chat_bundle(
    http_client, auth_headers, keycloak_token, db_session
):
    unique_marker = f"pytestmarker{uuid.uuid4().hex[:10]}"
    content = (
        "Newton's second law states that force equals mass times acceleration. "
        f"A special fact for this test: {unique_marker} refers to the acceleration "
        "due to gravity on Jupiter's moon Io."
    ).encode()

    upload_resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("physics-notes.txt", content, "text/plain")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    document_id = uuid.UUID(upload_resp.json()["id"])

    session_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert session_resp.status_code == 200
    session_id = session_resp.json()["session_id"]

    uri = f"{WS_BASE_URL}/chat/ws/{session_id}?token={keycloak_token}"
    try:
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"type": "user_message", "content": f"What does {unique_marker} refer to?"}))
            while True:
                # Generous on purpose (not just per-chunk gaps, also the model's real
                # time-to-first-token, which can be genuinely slow rather than stuck).
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    break

        bundle = await working_memory.get_bundle(session_id)
        retrieved = bundle.get("retrieved_chunks") or []
        assert any(unique_marker in chunk for chunk in retrieved), retrieved
    finally:
        document = await db_session.get(Document, document_id)
        if document is not None:
            await documents_service.delete_document(db_session, document)

        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


# ---------------------------------------------------------------------------
# Content viewing/editing/renaming — the "document drive" endpoints.
# ---------------------------------------------------------------------------


async def test_get_content_returns_extracted_text_and_editable_flag(uploaded_document, http_client, auth_headers):
    resp = await http_client.get(f"/documents/{uploaded_document}/content", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["editable"] is True
    assert "mitochondria" in body["content"]


async def test_get_raw_returns_original_bytes_with_content_type(uploaded_document, http_client, auth_headers):
    resp = await http_client.get(f"/documents/{uploaded_document}/raw", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/plain")
    assert b"mitochondria" in resp.content


async def test_update_content_rechunks_and_new_content_wins_in_rag(
    uploaded_document, http_client, auth_headers, db_session
):
    unique_marker = f"editedmarker{uuid.uuid4().hex[:10]}"
    new_content = f"After editing, this document is now entirely about {unique_marker} and photosynthesis."

    put_resp = await http_client.put(
        f"/documents/{uploaded_document}/content",
        headers=auth_headers,
        json={"content": new_content},
    )
    assert put_resp.status_code == 200, put_resp.text

    # The viewer reflects the edit immediately.
    get_resp = await http_client.get(f"/documents/{uploaded_document}/content", headers=auth_headers)
    assert unique_marker in get_resp.json()["content"]

    # RAG retrieval was re-chunked against the NEW content, not the stale old text.
    rows = (
        (
            await db_session.execute(
                select(DocumentChunk).where(DocumentChunk.document_id == uploaded_document)
            )
        )
        .scalars()
        .all()
    )
    assert rows, "expected re-chunked rows after the edit"
    assert any(unique_marker in row.content for row in rows)
    assert not any("mitochondria" in row.content for row in rows)


async def test_rename_document_updates_filename_only(uploaded_document, http_client, auth_headers):
    resp = await http_client.patch(
        f"/documents/{uploaded_document}",
        headers=auth_headers,
        json={"filename": "renamed-notes.txt"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["filename"] == "renamed-notes.txt"

    list_resp = await http_client.get("/documents", headers=auth_headers)
    assert any(d["id"] == str(uploaded_document) and d["filename"] == "renamed-notes.txt" for d in list_resp.json())


@pytest_asyncio.fixture
async def uploaded_pdf(http_client, auth_headers, db_session):
    """A minimal, real, parseable single-page PDF — not just bytes with a .pdf name —
    so upload's own PDF text extraction succeeds and this exercises the genuine
    view-only-PDF path rather than an upload-time rejection."""
    from pypdf import PdfWriter

    buffer = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.write(buffer)
    content = buffer.getvalue()

    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("scan.pdf", content, "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    document_id = uuid.UUID(resp.json()["id"])

    yield document_id

    document = await db_session.get(Document, document_id)
    if document is not None:
        await documents_service.delete_document(db_session, document)


async def test_pdf_content_is_view_only(uploaded_pdf, http_client, auth_headers):
    get_resp = await http_client.get(f"/documents/{uploaded_pdf}/content", headers=auth_headers)
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["editable"] is False

    put_resp = await http_client.put(
        f"/documents/{uploaded_pdf}/content",
        headers=auth_headers,
        json={"content": "trying to edit a pdf"},
    )
    assert put_resp.status_code == 400


@pytest_asyncio.fixture
async def someone_elses_document(db_session):
    """A document owned by a throwaway user who is NOT the authenticated test
    account (auth_headers always logs in as student1) — for asserting the ownership
    check on the new per-document endpoints, mirroring test_practice_exams.py's
    throwaway_document fixture."""
    user = User(keycloak_sub=f"test-documents-owner-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = Document(user_id=user.id, filename="not-yours.txt", mime_type="text/plain", minio_key="unused/doc")
    db_session.add(document)
    await db_session.flush()
    await db_session.commit()

    yield document

    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_content_endpoints_404_for_another_users_document(
    someone_elses_document, http_client, auth_headers
):
    doc_id = someone_elses_document.id
    assert (await http_client.get(f"/documents/{doc_id}/content", headers=auth_headers)).status_code == 404
    assert (await http_client.get(f"/documents/{doc_id}/raw", headers=auth_headers)).status_code == 404
    assert (
        await http_client.put(f"/documents/{doc_id}/content", headers=auth_headers, json={"content": "x"})
    ).status_code == 404
    assert (
        await http_client.patch(f"/documents/{doc_id}", headers=auth_headers, json={"filename": "x"})
    ).status_code == 404
