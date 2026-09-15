from typing import Any

import httpx

from app.core.config import get_settings
from app.tools.base import Tool

_DEFAULT_NUM_RESULTS = 5
_MAX_NUM_RESULTS = 10
_SNIPPET_MAX_LEN = 300


def format_results(query: str, data: dict[str, Any], num_results: int) -> str:
    """Turn a parsed SearXNG `format=json` response into the string handed back to the
    model. Pure/no I/O, so it's fully testable without a live SearXNG instance — tests
    just construct a dict in this shape.

    "Usable" means a result has both a title and a URL; SearXNG occasionally returns
    partial entries (e.g. answers/infoboxes) without one or the other, which we skip
    rather than show the model something broken. Zero usable results — whether because
    the response had none, or every entry was missing a title/URL — is reported the
    same way a request failure is, so a tool-calling loop can react to either uniformly."""
    raw_results = data.get("results") or []
    usable = [r for r in raw_results if r.get("title") and r.get("url")]
    if not usable:
        return f"Search failed: no results found for '{query}'."

    lines = [f"Search results for '{query}':"]
    for i, result in enumerate(usable[:num_results], start=1):
        snippet = (result.get("content") or "").strip()
        if len(snippet) > _SNIPPET_MAX_LEN:
            snippet = snippet[:_SNIPPET_MAX_LEN].rstrip() + "..."
        entry = f"{i}. {result['title']}\n   {result['url']}"
        if snippet:
            entry += f"\n   {snippet}"
        lines.append(entry)
    return "\n".join(lines)


class WebSearchTool(Tool):
    """Queries a self-hosted SearXNG metasearch instance (see infra/searxng/) for
    current web results. SearXNG proxies to real upstream engines (Google, Bing,
    DuckDuckGo, etc.), which sometimes rate-limit or block a fresh self-hosted
    instance — `run` never raises for that; it always returns a string, including a
    clear "Search failed: ..." one, so an agent loop can react to a failed search
    instead of crashing."""

    name = "web_search"
    description = (
        "Searches the web via a self-hosted metasearch instance for current "
        "information -- use for anything that may postdate your training data or "
        "you're not confident about. Returns numbered results with a title, URL, "
        "and snippet."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "e.g. 'FastAPI 0.115 changelog'"},
            "num_results": {
                "type": "integer",
                "description": f"How many results to return (default {_DEFAULT_NUM_RESULTS}, max {_MAX_NUM_RESULTS}).",
            },
        },
        "required": ["query"],
    }

    def __init__(
        self,
        base_url: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10.0,
    ):
        # base_url defaults to the configured SearXNG address (app/core/config.py's
        # SEARXNG_URL). `transport` is only ever passed in tests (httpx.MockTransport),
        # so the real HTTP request/response path gets exercised without a live SearXNG
        # instance.
        self.base_url = (base_url or get_settings().searxng_url).rstrip("/")
        self._transport = transport
        self.timeout = timeout

    async def run(self, query: str, num_results: int = _DEFAULT_NUM_RESULTS) -> str:
        query = (query or "").strip()
        if not query:
            return "Error: query must not be empty"

        try:
            num_results = int(num_results)
        except (TypeError, ValueError):
            num_results = _DEFAULT_NUM_RESULTS
        num_results = max(1, min(num_results, _MAX_NUM_RESULTS))

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.get("/search", params={"q": query, "format": "json"})
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return f"Search failed: could not reach search backend for '{query}' ({exc})"

        try:
            return format_results(query, data, num_results)
        except Exception as exc:
            return f"Search failed: could not parse search results for '{query}' ({exc})"
