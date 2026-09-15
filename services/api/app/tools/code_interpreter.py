from typing import Any

import httpx

from app.core.config import get_settings
from app.tools.base import Tool

# Deliberately generous relative to the sandbox-runner's own internal timeouts (wall-clock
# watchdog there defaults to ~10s) — this needs enough slack for the request/response
# round trip on top of that, not to add its own tighter limit that could fire first and
# leave the sandbox-runner's own accounting as the only meaningful source of truth.
_HTTP_TIMEOUT_S = 20.0


class CodeInterpreterTool(Tool):
    name = "code_interpreter"
    description = (
        "Executes Python code in an isolated sandbox, returning stdout/stderr/exit "
        "code. Use for real computation, data manipulation, or verifying a "
        "hand-worked answer. No network or filesystem access beyond a scratch "
        "directory."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Python source to execute."},
            "stdin": {"type": "string", "description": "Optional text piped to the program's stdin."},
        },
        "required": ["code"],
    }

    async def run(self, code: str, stdin: str | None = None) -> str:
        base_url = get_settings().sandbox_runner_url
        payload: dict[str, Any] = {"code": code}
        if stdin is not None:
            payload["stdin"] = stdin

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
                response = await client.post(f"{base_url}/execute", json=payload)
                response.raise_for_status()
                result = response.json()
        except httpx.TimeoutException:
            return "Error: sandbox-runner did not respond in time (the request may still be running there)."
        except httpx.HTTPError as exc:
            return f"Error: could not reach sandbox-runner at {base_url}: {exc}"

        lines = [
            f"Exit code: {result.get('exit_code')}",
            f"Timed out: {result.get('timed_out')}",
        ]
        stdout = result.get("stdout") or ""
        stderr = result.get("stderr") or ""
        lines.append(f"--- stdout ---\n{stdout}" if stdout else "--- stdout ---\n(empty)")
        lines.append(f"--- stderr ---\n{stderr}" if stderr else "--- stderr ---\n(empty)")
        return "\n".join(lines)
