import uuid
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, StudyPlanItem, User
from app.services import documents as documents_service
from app.services import study_planner
from app.services.study_planner import _parse_due_date, generate_study_plan, parse_study_plan_items
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# Pure parsing tests — no DB, no network, no provider.
# ---------------------------------------------------------------------------


def test_parse_study_plan_items_extracts_valid_items():
    raw = (
        "Here you go:\n"
        '{"items": [{"title": "Problem Set 1", "due_date": "2026-09-20", '
        '"due_date_text": "Sept 20", "notes": "10%"}]}'
    )
    items = parse_study_plan_items(raw)
    assert len(items) == 1
    assert items[0]["title"] == "Problem Set 1"


def test_parse_study_plan_items_filters_items_without_a_title():
    raw = '{"items": [{"due_date": "2026-09-20"}, {"title": "Real item"}]}'
    items = parse_study_plan_items(raw)
    assert [i["title"] for i in items] == ["Real item"]


def test_parse_study_plan_items_returns_empty_list_for_unparseable_text():
    # exactly what the keyless EchoProvider produces — it echoes the prompt back,
    # which is not the requested JSON shape.
    items = parse_study_plan_items("[echo/no-provider-configured] you said: whatever")
    assert items == []


def test_parse_study_plan_items_handles_empty_items_list():
    assert parse_study_plan_items('{"items": []}') == []


def test_parse_study_plan_items_handles_non_list_items_field():
    assert parse_study_plan_items('{"items": "not a list"}') == []


@pytest.mark.parametrize(
    "raw_date,expected",
    [
        ("2026-09-20", date(2026, 9, 20)),
        ("not a date", None),
        (None, None),
        ("", None),
        (42, None),
    ],
)
def test_parse_due_date(raw_date, expected):
    assert _parse_due_date(raw_date) == expected


# ---------------------------------------------------------------------------
# generate_study_plan orchestration — real DB rows, scripted provider (no real
# LLM key exists in this dev environment, so this is the only way to exercise
# what happens with a genuinely well-formed structured response).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_document(db_session):
    user = User(keycloak_sub=f"test-study-planner-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = Document(user_id=user.id, filename="syllabus.txt", mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.flush()
    await db_session.commit()

    yield user, document

    await db_session.execute(delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _fake_get_document_text(_document) -> str:
    return "Week 3: Reading Response due. Sept 20: Problem Set 1 due (10% of grade)."


async def test_generate_study_plan_creates_rows_from_a_well_formed_response(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider(
        [
            [
                '{"items": [',
                '{"title": "Problem Set 1", "due_date": "2026-09-20", '
                '"due_date_text": "Sept 20", "notes": "10%"},',
                '{"title": "Reading Response", "due_date": null, '
                '"due_date_text": "Week 3", "notes": null}',
                "]}",
            ]
        ]
    )
    monkeypatch.setattr(study_planner, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(study_planner, "get_document_text", _fake_get_document_text)

    items = await generate_study_plan(db_session, user.id, document)
    await db_session.commit()

    assert len(items) == 2
    ps1 = next(i for i in items if i.title == "Problem Set 1")
    assert ps1.due_date == date(2026, 9, 20)
    assert ps1.due_date_text == "Sept 20"
    assert ps1.notes == "10%"
    assert ps1.source == "syllabus_upload"
    assert ps1.document_id == document.id

    reading = next(i for i in items if i.title == "Reading Response")
    assert reading.due_date is None
    assert reading.due_date_text == "Week 3"

    # actually persisted, not just returned in memory
    rows = (
        (await db_session.execute(select(StudyPlanItem).where(StudyPlanItem.user_id == user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 2


async def test_generate_study_plan_creates_no_rows_for_an_unparseable_response(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider([["I'm not going to give you JSON, sorry."]])
    monkeypatch.setattr(study_planner, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(study_planner, "get_document_text", _fake_get_document_text)

    items = await generate_study_plan(db_session, user.id, document)
    assert items == []


# ---------------------------------------------------------------------------
# Router-level tests — real HTTP against the live server. Generation itself
# necessarily goes through the real (keyless Echo) provider here, so these
# check plumbing/auth/ownership, not extraction quality (covered above).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def uploaded_document(http_client, auth_headers, db_session):
    content = b"Week 1: Intro. Week 10: Final Project due."
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("syllabus.txt", content, "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    document_id = uuid.UUID(resp.json()["id"])

    yield document_id

    document = await db_session.get(Document, document_id)
    if document is not None:
        await documents_service.delete_document(db_session, document)


async def test_generate_requires_auth(http_client):
    resp = await http_client.post(f"/study-plan/generate/{uuid.uuid4()}")
    assert resp.status_code == 401


async def test_generate_404s_for_a_nonexistent_document(http_client, auth_headers):
    resp = await http_client.post(f"/study-plan/generate/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


async def test_generate_returns_a_list_and_items_show_up_in_list_endpoint(
    uploaded_document, http_client, auth_headers, db_session
):
    resp = await http_client.post(f"/study-plan/generate/{uploaded_document}", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    list_resp = await http_client.get("/study-plan", headers=auth_headers)
    assert list_resp.status_code == 200
    returned_ids = {item["id"] for item in resp.json()}
    listed_ids = {item["id"] for item in list_resp.json()}
    assert returned_ids <= listed_ids


async def test_delete_study_plan_item_removes_it(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    # Insert directly under student1's own document rather than depending on the live
    # (Echo) provider producing a real item — student1 is who auth_headers authenticates as.
    item = StudyPlanItem(user_id=document.user_id, document_id=document.id, title="Manual item")
    db_session.add(item)
    await db_session.commit()

    resp = await http_client.delete(f"/study-plan/{item.id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "deleted"}

    # The delete happened through the live server's own DB session, not this one.
    # db_session.get() short-circuits on its identity map for a known primary key
    # without emitting SQL, so it can't observe that — a plain select() always hits
    # the DB and correctly comes back empty.
    remaining = (
        await db_session.execute(select(StudyPlanItem).where(StudyPlanItem.id == item.id))
    ).scalar_one_or_none()
    assert remaining is None


async def test_delete_study_plan_item_404s_for_another_users_item(
    throwaway_document, http_client, auth_headers, db_session
):
    # throwaway_document's item belongs to a *different* user than the authenticated
    # test client (student1) — deleting it through the API must not be allowed, and it
    # must genuinely still exist afterward, not just return a 404 for the wrong reason.
    _, document = throwaway_document
    item = StudyPlanItem(user_id=document.user_id, document_id=document.id, title="Someone else's item")
    db_session.add(item)
    await db_session.commit()

    resp = await http_client.delete(f"/study-plan/{item.id}", headers=auth_headers)
    assert resp.status_code == 404
    assert await db_session.get(StudyPlanItem, item.id) is not None
