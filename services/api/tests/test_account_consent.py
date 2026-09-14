import pytest_asyncio
from jose import jwt as jose_jwt
from sqlalchemy import select

from app.db.models import User

# ---------------------------------------------------------------------------
# Router tests for the age-gate scaffolding (GET /account, POST /account/age-consent)
# -- see app/routers/account.py and docs/data-retention-and-privacy.md. Mutates the
# shared dev "student1" account's age_band/consented_at, so every test that writes uses
# the same snapshot+restore fixture test_billing.py's student1_status_snapshot already
# established, scoped to the two new columns instead.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def student1_consent_snapshot(db_session, keycloak_token):
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub)
        db_session.add(user)
        await db_session.commit()

    original_age_band = user.age_band
    original_consented_at = user.consented_at
    yield user
    user.age_band = original_age_band
    user.consented_at = original_consented_at
    await db_session.commit()


async def test_account_status_requires_auth(http_client):
    resp = await http_client.get("/account")
    assert resp.status_code in (401, 403)


async def test_age_consent_requires_auth(http_client):
    resp = await http_client.post("/account/age-consent", json={"age_band": "18_plus"})
    assert resp.status_code in (401, 403)


async def test_age_consent_rejects_an_unrecognized_band(http_client, auth_headers):
    resp = await http_client.post(
        "/account/age-consent", json={"age_band": "not-a-real-band"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_account_status_reports_needs_consent_before_any_answer(
    http_client, auth_headers, student1_consent_snapshot, db_session
):
    student1_consent_snapshot.age_band = None
    student1_consent_snapshot.consented_at = None
    await db_session.commit()

    resp = await http_client.get("/account", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["needs_consent"] is True
    assert body["age_band"] is None
    assert body["consented_at"] is None


async def test_18_plus_answer_records_consented_at_and_unblocks(
    http_client, auth_headers, student1_consent_snapshot, db_session
):
    resp = await http_client.post("/account/age-consent", json={"age_band": "18_plus"}, headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["age_band"] == "18_plus"
    assert body["consented_at"] is not None
    assert body["needs_consent"] is False

    await db_session.refresh(student1_consent_snapshot)
    assert student1_consent_snapshot.age_band == "18_plus"
    assert student1_consent_snapshot.consented_at is not None


async def test_13_17_answer_also_records_consented_at(
    http_client, auth_headers, student1_consent_snapshot, db_session
):
    resp = await http_client.post("/account/age-consent", json={"age_band": "13_17"}, headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["age_band"] == "13_17"
    assert body["needs_consent"] is False


async def test_under_13_answer_is_recorded_but_never_unblocks(
    http_client, auth_headers, student1_consent_snapshot, db_session
):
    """The whole point of the age-gate design: self-attestation of "under 13" is not
    COPPA's required verifiable PARENTAL consent, so this must record the answer
    without setting consented_at -- account_status must keep reporting needs_consent."""
    resp = await http_client.post("/account/age-consent", json={"age_band": "under_13"}, headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["age_band"] == "under_13"
    assert body["consented_at"] is None
    assert body["needs_consent"] is True

    await db_session.refresh(student1_consent_snapshot)
    assert student1_consent_snapshot.age_band == "under_13"
    assert student1_consent_snapshot.consented_at is None


async def test_switching_from_under_13_to_18_plus_clears_the_block(
    http_client, auth_headers, student1_consent_snapshot, db_session
):
    """Regression guard for a real correction path (e.g. a misclick) -- picking
    "under 13" first must not permanently lock the account out of ever answering
    again."""
    first = await http_client.post("/account/age-consent", json={"age_band": "under_13"}, headers=auth_headers)
    assert first.json()["needs_consent"] is True

    second = await http_client.post("/account/age-consent", json={"age_band": "18_plus"}, headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["needs_consent"] is False
