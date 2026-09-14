from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.services.account import delete_own_account
from app.services.users import get_or_create_user

router = APIRouter(prefix="/account", tags=["account"])


@router.delete("")
async def delete_account(
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Deletes the calling user's own account and everything they own (chat history,
    documents, study plan items, flashcards/review logs, practice exams, profile
    facts, Google Classroom connection) via migration 0010's ON DELETE CASCADE, plus
    their MinIO-stored files. Deliberately takes no user-id parameter -- this is
    "delete my own account," never an admin operation on someone else's. See
    app/services/account.py's delete_own_account for the MinIO-ordering and
    Keycloak-identity-scope reasoning."""
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it
    await delete_own_account(db, user)
    return {"status": "deleted"}
