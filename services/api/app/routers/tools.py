from fastapi import APIRouter, Depends

from app.core.auth import require_user
from app.tools.registry import get_tool_specs

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("")
async def list_tools(claims: dict = Depends(require_user)) -> list[dict]:
    """The live tool belt, straight from the registry — so the desktop app's
    capabilities panel can never drift from what the Tutor can actually call."""
    return [{"name": t.name, "description": t.description} for t in get_tool_specs()]
