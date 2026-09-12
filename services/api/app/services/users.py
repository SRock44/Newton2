from sqlalchemy import select
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
        await db.flush()
    return user
