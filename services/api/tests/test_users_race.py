import asyncio
import uuid

from sqlalchemy import delete, select

from app.db.base import SessionLocal
from app.db.models import User
from app.services.users import get_or_create_user


async def test_get_or_create_user_survives_a_concurrent_first_sign_in():
    """Real bug: a brand-new account's first sign-in fires several endpoints in
    parallel, each with its own AsyncSession/transaction (App.tsx's account-status and
    chat-sessions effects both key off `[token]` and run concurrently on mount) -- and
    each one calls get_or_create_user for the same not-yet-existing keycloak_sub. Each
    transaction's own SELECT can't see the other's uncommitted INSERT, so both decide to
    create the row; whichever transaction commits second used to hit the unique
    keycloak_sub index and raise an unhandled IntegrityError, surfaced to a real new
    user as "Couldn't load your chats." even though they have zero chats.

    Reproduces the real race with two separate SessionLocal() instances (not just two
    sequential calls -- sequential calls never exercise this at all) racing via
    asyncio.gather, and asserts both resolve to the exact same row instead of one of
    them raising.
    """
    sub = f"race-test-{uuid.uuid4()}"
    claims = {"sub": sub, "email": "race-test@example.test", "name": "Race Test"}

    session_a = SessionLocal()
    session_b = SessionLocal()

    async def resolve(db):
        user = await get_or_create_user(db, claims)
        await db.commit()
        return user.id

    try:
        id_a, id_b = await asyncio.gather(resolve(session_a), resolve(session_b))
        assert id_a == id_b

        async with SessionLocal() as verify:
            rows = (
                (await verify.execute(select(User).where(User.keycloak_sub == sub)))
                .scalars()
                .all()
            )
            assert len(rows) == 1
            assert rows[0].id == id_a
    finally:
        await session_a.close()
        await session_b.close()
        async with SessionLocal() as cleanup:
            await cleanup.execute(delete(User).where(User.keycloak_sub == sub))
            await cleanup.commit()
