import httpx
import pytest

from app.tools.web_search import WebSearchTool, format_results

# A trimmed, realistic SearXNG `format=json` response — captured (fields kept, values
# tidied) from a real self-hosted instance queried during manual verification of this
# tool, so the shape here isn't guessed.
_SAMPLE_RESPONSE = {
    "query": "python asyncio",
    "number_of_results": 0,
    "results": [
        {
            "url": "https://docs.python.org/3/library/asyncio.html",
            "title": "asyncio — Asynchronous I/O — Python 3.14.7 documentation",
            "content": (
                "asyncio is a library to write concurrent code using the async/await "
                "syntax. asyncio is used as a foundation for multiple Python "
                "asynchronous frameworks that provide high-performance network and "
                "web-servers, database connection libraries, distributed task queues, "
                "etc. asyncio is often a perfect fit for building network applications."
            ),
            "engine": "google",
            "engines": ["google", "brave"],
            "score": 4.5,
            "category": "general",
        },
        {
            "url": "https://realpython.com/async-io-python/",
            "title": "Python's asyncio: A Hands-On Walkthrough",
            "content": "Python's asyncio library enables you to write concurrent code using the async and await keywords.",
            "engine": "bing",
            "engines": ["bing"],
            "score": 3.0,
            "category": "general",
        },
        {
            # SearXNG sometimes returns entries missing a title or URL (e.g. certain
            # answer/infobox-adjacent results) — these must be skipped, not shown.
            "url": "",
            "title": "Untitled partial result",
            "content": "should be skipped: no url",
            "engine": "duckduckgo",
        },
    ],
    "answers": [],
    "corrections": [],
    "infoboxes": [],
    "suggestions": [],
    "unresponsive_engines": [["wikidata", "timeout"]],
}


# ---- format_results: pure parsing/formatting logic, no I/O -----------------------


def test_format_results_lists_title_url_and_snippet():
    text = format_results("python asyncio", _SAMPLE_RESPONSE, num_results=5)
    assert "Search results for 'python asyncio':" in text
    assert "1. asyncio — Asynchronous I/O — Python 3.14.7 documentation" in text
    assert "https://docs.python.org/3/library/asyncio.html" in text
    assert "asyncio is a library to write concurrent code" in text
    assert "2. Python's asyncio: A Hands-On Walkthrough" in text


def test_format_results_skips_entries_missing_title_or_url():
    text = format_results("python asyncio", _SAMPLE_RESPONSE, num_results=5)
    assert "Untitled partial result" not in text
    assert "should be skipped" not in text


def test_format_results_respects_num_results_limit():
    text = format_results("python asyncio", _SAMPLE_RESPONSE, num_results=1)
    assert "docs.python.org" in text
    assert "realpython.com" not in text


def test_format_results_truncates_long_snippet():
    long_content = "x" * 500
    data = {"results": [{"title": "Long", "url": "https://example.com", "content": long_content}]}
    text = format_results("q", data, num_results=5)
    # 300-char cap plus "..." — well short of the original 500 chars.
    assert "x" * 400 not in text
    assert "..." in text


def test_format_results_handles_missing_snippet():
    data = {"results": [{"title": "No snippet", "url": "https://example.com"}]}
    text = format_results("q", data, num_results=5)
    assert "No snippet" in text
    assert "https://example.com" in text


def test_format_results_returns_search_failed_string_when_no_results():
    text = format_results("obscure query", {"results": []}, num_results=5)
    assert text.startswith("Search failed:")
    assert "obscure query" in text


def test_format_results_returns_search_failed_string_when_all_entries_unusable():
    data = {"results": [{"title": "", "url": ""}, {"title": "no url"}]}
    text = format_results("q", data, num_results=5)
    assert text.startswith("Search failed:")


def test_format_results_handles_missing_results_key():
    text = format_results("q", {}, num_results=5)
    assert text.startswith("Search failed:")


# ---- WebSearchTool.run: HTTP request/response path, mocked (no live SearXNG) -----


def _mock_transport(handler):
    return httpx.MockTransport(handler)


async def test_tool_run_returns_error_string_for_empty_query():
    tool = WebSearchTool(base_url="http://searxng:8080")
    result = await tool.run(query="   ")
    assert result.startswith("Error:")


async def test_tool_run_success_parses_mocked_searxng_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params["q"] == "python asyncio"
        assert request.url.params["format"] == "json"
        return httpx.Response(200, json=_SAMPLE_RESPONSE)

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="python asyncio", num_results=2)
    assert "docs.python.org" in result
    assert "realpython.com" in result
    assert not result.startswith("Search failed")
    assert not result.startswith("Error")


async def test_tool_run_respects_num_results_argument():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_SAMPLE_RESPONSE)

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="python asyncio", num_results=1)
    assert "docs.python.org" in result
    assert "realpython.com" not in result


async def test_tool_run_clamps_out_of_range_num_results():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_SAMPLE_RESPONSE)

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    # Should clamp to the max rather than error, and still return usable results.
    result = await tool.run(query="python asyncio", num_results=999)
    assert not result.startswith("Error")


async def test_tool_run_returns_search_failed_string_on_zero_results():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="something obscure")
    assert result.startswith("Search failed:")


async def test_tool_run_returns_search_failed_string_on_http_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream engines unavailable")

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="python asyncio")
    assert result.startswith("Search failed:")


async def test_tool_run_returns_search_failed_string_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="python asyncio")
    assert result.startswith("Search failed:")


async def test_tool_run_returns_search_failed_string_on_malformed_json():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    tool = WebSearchTool(base_url="http://searxng:8080", transport=_mock_transport(handler))
    result = await tool.run(query="python asyncio")
    assert result.startswith("Search failed:")


# ---- Real integration test against a manually-stood-up SearXNG instance ----------
#
# Not part of the long-term suite: it talks to a standalone `searxng-test` container
# that was brought up on the newton2_net Docker network for manual verification of
# this tool (see infra/searxng/README.md) and torn down afterward. It's expected to
# start skipping (not failing) once that container is gone — which is the point: the
# mocked tests above are what must keep passing once SearXNG is wired into the real
# deployed stack.
@pytest.mark.live_smoke
async def test_tool_run_against_real_standalone_searxng_instance():
    tool = WebSearchTool(base_url="http://searxng-test:8080")
    try:
        result = await tool.run(query="python asyncio", num_results=3)
    except Exception as exc:  # pragma: no cover - only reachable if run() itself raises
        pytest.skip(f"standalone searxng-test container not reachable: {exc}")
    if result.startswith("Search failed"):
        pytest.skip(f"standalone searxng-test container not reachable or search failed: {result}")
    assert "Search results for 'python asyncio':" in result
