from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.services.gamification import get_stats
from app.services.users import get_or_create_user

router = APIRouter(prefix="/gamification", tags=["gamification"])


@router.get("/stats")
async def stats(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it
    return await get_stats(db, user.id)
