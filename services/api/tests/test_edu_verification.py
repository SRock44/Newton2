"""Tests for free Pro via a verified school email: app/services/edu_verification.py +
app/services/email.py, and the /account/edu-verification* endpoints.

send_email is always mocked here -- there's no real SMTP relay configured in this dev
stack (see app/core/config.py's smtp_* fields, dormant by default), and even if there
were, a test suite should never depend on actually delivering an email. Router tests
that need send_email mocked go through an in-process ASGI client against the real `app`
object this test process imports (same idiom test_billing.py's Stripe-mocked endpoints
use) -- the live http_client fixture talks to a separate OS process this test's
monkeypatch can't reach into. The plain status-check endpoint (no email involved) uses
the live http_client fixture like every other simple router test.
"""

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from jose import jwt as jose_jwt
from sqlalchemy import delete, select

from app.core.config import Settings
from app.db.models import EduVerificationCode, User
from app.services import billing as billing_service
from app.services import edu_verification
from app.services import email as email_service

# ---------------------------------------------------------------------------
# Domain allowlist / is_pro — pure, no DB/network.
# ---------------------------------------------------------------------------


def test_allowed_domains_parses_the_comma_separated_setting(monkeypatch):
    monkeypatch.setattr(
        edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu, other.edu")
    )
    assert edu_verification.allowed_domains() == ["nyit.edu", "other.edu"]


def test_is_eligible_domain_true_only_for_an_allowlisted_domain(monkeypatch):
    monkeypatch.setattr(edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu"))
    assert edu_verification.is_eligible_domain("student@nyit.edu") is True
    assert edu_verification.is_eligible_domain("Student@NYIT.EDU") is True  # case-insensitive
    assert edu_verification.is_eligible_domain("student@gmail.com") is False
    assert edu_verification.is_eligible_domain("not-an-email") is False


def test_is_pro_true_for_a_verified_edu_account_regardless_of_plan():
    user = User(keycloak_sub="unused", plan="free", edu_verified_at=datetime.now(timezone.utc))
    assert billing_service.is_pro(user) is True


def test_is_pro_false_for_free_plan_with_no_edu_verification():
    user = User(keycloak_sub="unused", plan="free")
    assert billing_service.is_pro(user) is False


# ---------------------------------------------------------------------------
# start_edu_verification / confirm_edu_verification — real DB, mocked send_email.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def edu_user(db_session):
    """A throwaway user, not the shared student1 account — this suite mutates
    edu_email/edu_verified_at and creates/deletes real edu_verification_codes rows, and
    a dedicated row avoids any chance of leaking verified-Pro state into student1 for
    every other test that happens to check is_pro()."""
    user = User(keycloak_sub=f"edu-test-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.commit()
    yield user
    await db_session.execute(delete(EduVerificationCode).where(EduVerificationCode.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


@pytest_asyncio.fixture
def mock_send_email(monkeypatch):
    sent = []

    def fake_send(to: str, subject: str, body: str) -> None:
        sent.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(edu_verification, "send_email", fake_send)
    monkeypatch.setattr(
        edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu")
    )
    return sent


async def test_start_rejects_an_ineligible_domain(db_session, edu_user, mock_send_email):
    with pytest.raises(ValueError):
        await edu_verification.start_edu_verification(db_session, edu_user, "student@gmail.com")
    assert mock_send_email == []


async def test_start_sends_a_real_6_digit_code_to_the_given_address(db_session, edu_user, mock_send_email):
    await edu_verification.start_edu_verification(db_session, edu_user, "Student@NYIT.edu")

    assert len(mock_send_email) == 1
    assert mock_send_email[0]["to"] == "Student@NYIT.edu"
    code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()
    assert code_row.email == "student@nyit.edu"
    assert len(code_row.code) == 6 and code_row.code.isdigit()
    assert code_row.code in mock_send_email[0]["body"]


async def test_starting_again_invalidates_the_previous_code(db_session, edu_user, mock_send_email):
    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")
    first_code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()
    first_code = first_code_row.code

    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")

    assert len(mock_send_email) == 2  # a real second email really was sent
    rows = (
        (await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 1  # the old row was deleted, not left behind alongside the new one

    # The old code genuinely no longer works, even though its row is simply gone rather
    # than explicitly flagged "used" — confirm_edu_verification has nothing left to
    # match it against.
    assert await edu_verification.confirm_edu_verification(db_session, edu_user, first_code) is False


async def test_confirm_with_no_code_ever_requested_fails(db_session, edu_user):
    assert await edu_verification.confirm_edu_verification(db_session, edu_user, "000000") is False
    assert edu_user.edu_verified_at is None


async def test_confirm_with_the_right_code_grants_pro(db_session, edu_user, mock_send_email):
    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")
    code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()

    ok = await edu_verification.confirm_edu_verification(db_session, edu_user, code_row.code)

    assert ok is True
    assert edu_user.edu_email == "student@nyit.edu"
    assert edu_user.edu_verified_at is not None
    assert billing_service.is_pro(edu_user) is True
    # The code is consumed — can't be replayed.
    remaining = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one_or_none()
    assert remaining is None


async def test_confirm_with_the_wrong_code_fails_and_counts_as_an_attempt(db_session, edu_user, mock_send_email):
    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")

    ok = await edu_verification.confirm_edu_verification(db_session, edu_user, "000000")

    assert ok is False
    assert edu_user.edu_verified_at is None
    code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()
    assert code_row.attempts == 1


async def test_confirm_locks_out_after_max_attempts_even_with_the_right_code(
    db_session, edu_user, mock_send_email
):
    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")
    code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()
    real_code = code_row.code

    for _ in range(edu_verification.MAX_ATTEMPTS):
        assert await edu_verification.confirm_edu_verification(db_session, edu_user, "000000") is False

    # Even the real code is rejected now — the attempt budget is spent, not the code.
    assert await edu_verification.confirm_edu_verification(db_session, edu_user, real_code) is False
    assert edu_user.edu_verified_at is None


async def test_confirm_rejects_an_expired_code(db_session, edu_user, mock_send_email):
    await edu_verification.start_edu_verification(db_session, edu_user, "student@nyit.edu")
    code_row = (
        await db_session.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == edu_user.id))
    ).scalar_one()
    code_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    ok = await edu_verification.confirm_edu_verification(db_session, edu_user, code_row.code)

    assert ok is False
    assert edu_user.edu_verified_at is None


# ---------------------------------------------------------------------------
# Router — /account/edu-verification*
# ---------------------------------------------------------------------------


async def test_edu_verification_status_requires_auth(http_client):
    resp = await http_client.get("/account/edu-verification")
    assert resp.status_code in (401, 403)


async def test_edu_verification_status_reports_not_verified_and_the_eligible_domains(
    http_client, auth_headers
):
    resp = await http_client.get("/account/edu-verification", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "eligible_domains" in body
    assert isinstance(body["eligible_domains"], list)


@pytest_asyncio.fixture
async def inprocess_client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest_asyncio.fixture
async def student1_edu_snapshot(db_session, keycloak_token):
    """Snapshots+restores student1's edu_email/edu_verified_at around a test, and
    cleans up any edu_verification_codes row it creates — same pattern test_billing.py's
    student1_user fixture already established for stripe_customer_id."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub)
        db_session.add(user)
        await db_session.commit()

    original_edu_email = user.edu_email
    original_edu_verified_at = user.edu_verified_at
    yield user
    await db_session.execute(delete(EduVerificationCode).where(EduVerificationCode.user_id == user.id))
    user.edu_email = original_edu_email
    user.edu_verified_at = original_edu_verified_at
    await db_session.commit()


async def test_start_endpoint_rejects_an_ineligible_domain_with_400(
    inprocess_client, auth_headers, student1_edu_snapshot, monkeypatch
):
    monkeypatch.setattr(edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu"))
    monkeypatch.setattr(edu_verification, "send_email", lambda *a, **k: None)

    resp = await inprocess_client.post(
        "/account/edu-verification/start", json={"email": "student@gmail.com"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_start_endpoint_returns_503_when_smtp_isnt_configured(
    inprocess_client, auth_headers, student1_edu_snapshot, monkeypatch
):
    # Real app/services/email.py behavior, not mocked here — proves the router surfaces
    # it as a clear 503, not an unhandled 500. Explicitly forces smtp_host unset on
    # BOTH modules' own get_settings (edu_verification's for the domain check, email's
    # for the actual send) rather than relying on this dev stack happening not to have
    # SMTP configured — that's true today but shouldn't be what makes this test pass.
    monkeypatch.setattr(edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu"))
    monkeypatch.setattr(email_service, "get_settings", lambda: Settings(smtp_host=None, smtp_from_email=None))

    resp = await inprocess_client.post(
        "/account/edu-verification/start", json={"email": "student@nyit.edu"}, headers=auth_headers
    )
    assert resp.status_code == 503


async def test_full_start_then_confirm_round_trip_through_the_real_router(
    inprocess_client, auth_headers, student1_edu_snapshot, monkeypatch, db_session
):
    sent = []
    monkeypatch.setattr(edu_verification, "send_email", lambda to, subject, body: sent.append(body))
    monkeypatch.setattr(edu_verification, "get_settings", lambda: Settings(edu_verified_domains="nyit.edu"))

    start_resp = await inprocess_client.post(
        "/account/edu-verification/start", json={"email": "student1@nyit.edu"}, headers=auth_headers
    )
    assert start_resp.status_code == 200
    assert len(sent) == 1

    # Pull the real code back out of the email body sent — the test has no other way to
    # know it (it's randomly generated), same as a real student reading their inbox.
    code = next(word for word in sent[0].split() if word.isdigit() and len(word) == 6)

    wrong_resp = await inprocess_client.post(
        "/account/edu-verification/confirm", json={"code": "000000"}, headers=auth_headers
    )
    assert wrong_resp.status_code == 400

    confirm_resp = await inprocess_client.post(
        "/account/edu-verification/confirm", json={"code": code}, headers=auth_headers
    )
    assert confirm_resp.status_code == 200
    body = confirm_resp.json()
    assert body["edu_email"] == "student1@nyit.edu"
    assert body["edu_verified_at"] is not None

    await db_session.refresh(student1_edu_snapshot)
    assert billing_service.is_pro(student1_edu_snapshot) is True
