from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


async def get_or_create_user(db: AsyncSession, claims: dict) -> User:
    sub = claims["sub"]
    user = (await db.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(
            keycloak_sub=sub,
            email=claims.get("email"),
            display_name=claims.get("name") or claims.get("preferred_username"),
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            # A brand-new account's first sign-in fires several endpoints in parallel,
            # each with its own AsyncSession/transaction (App.tsx's account-status and
            # chat-sessions effects both key off `[token]` and run concurrently) -- each
            # one lands here with the same not-yet-existing keycloak_sub. The SELECT
            # above can't see another transaction's uncommitted insert, so two requests
            # can both decide to create the row; whichever commits second hits the
            # unique index and raises here. That's a lost race, not a real error -- roll
            # back this half-finished insert and fetch the row the other request made.
            await db.rollback()
            user = (await db.execute(select(User).where(User.keycloak_sub == sub))).scalar_one()
    return user
