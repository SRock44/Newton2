from typing import Any

import httpx

from app.core.config import get_settings
from app.tools.base import Tool

_MAX_ISSUES_SHOWN = 15
_CONTEXT_TRUNCATE_LEN = 120


def format_matches(text: str, matches: list[dict[str, Any]]) -> str:
    """Turn LanguageTool's `/v2/check` response `matches` array into the string handed
    back to the model. Pure/no I/O, so it's fully testable without a live LanguageTool
    instance — tests just construct a list in this shape."""
    if not matches:
        return "No issues found — this looks clean."

    lines = [f"Found {len(matches)} issue{'s' if len(matches) != 1 else ''}:"]
    for i, match in enumerate(matches[:_MAX_ISSUES_SHOWN], start=1):
        message = match.get("message") or match.get("shortMessage") or "Possible issue"
        offset = match.get("offset", 0)
        length = match.get("length", 0)
        snippet = text[offset : offset + length]

        replacements = match.get("replacements") or []
        suggestion = ""
        if replacements:
            values = [r.get("value", "") for r in replacements[:3] if r.get("value")]
            if values:
                suggestion = f" — suggested: {', '.join(values)}"

        context_start = max(0, offset - 30)
        context_end = min(len(text), offset + length + 30)
        context = text[context_start:context_end].strip()
        if len(context) > _CONTEXT_TRUNCATE_LEN:
            context = context[:_CONTEXT_TRUNCATE_LEN].rstrip() + "..."

        entry = f'{i}. "{snippet}" — {message}{suggestion}'
        if context:
            entry += f"\n   context: ...{context}..."
        lines.append(entry)

    if len(matches) > _MAX_ISSUES_SHOWN:
        lines.append(f"...and {len(matches) - _MAX_ISSUES_SHOWN} more issue(s) not shown.")

    return "\n".join(lines)


class GrammarCheckTool(Tool):
    """Queries a self-hosted LanguageTool instance for grammar/style feedback on a
    student's writing (an essay draft, a short answer, anything prose). `run` never
    raises for an upstream failure; it always returns a string, including a clear
    "Grammar check failed: ..." one, so an agent loop can react to it instead of
    crashing."""

    name = "grammar_check"
    description = (
        "Checks a piece of writing for grammar, spelling, and style issues via a "
        "self-hosted LanguageTool instance. Use this when a student asks for feedback "
        "on an essay, short answer, or other prose — never guess at grammar issues by "
        "eye when this is available. Returns a numbered list of issues with the exact "
        "text flagged, the problem, and a suggested fix."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The writing to check."},
            "language": {
                "type": "string",
                "description": "Language code, e.g. 'en-US' (default) or 'en-GB'.",
            },
        },
        "required": ["text"],
    }

    def __init__(
        self,
        base_url: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 15.0,
    ):
        self.base_url = (base_url or get_settings().languagetool_url).rstrip("/")
        self._transport = transport
        self.timeout = timeout

    async def run(self, text: str, language: str = "en-US") -> str:
        text = (text or "").strip()
        if not text:
            return "Error: text must not be empty"

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    "/v2/check", data={"text": text, "language": language}
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return f"Grammar check failed: could not reach LanguageTool ({exc})"

        try:
            return format_matches(text, data.get("matches", []))
        except Exception as exc:
            return f"Grammar check failed: could not parse LanguageTool's response ({exc})"
