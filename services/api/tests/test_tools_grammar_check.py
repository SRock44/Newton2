import httpx

from app.tools.grammar_check import GrammarCheckTool, format_matches

# ---- format_matches: pure formatting logic, no I/O ---------------------------------

_TEXT = "I has a apple and their are many problem."
_MATCHES = [
    {
        "message": "Use 'have' instead of 'has' after 'I'.",
        "shortMessage": "Grammatical problem",
        "offset": 2,
        "length": 3,
        "replacements": [{"value": "have"}],
    },
    {
        "message": "Use 'an' before a word starting with a vowel sound.",
        "shortMessage": "",
        "offset": 8,
        "length": 1,
        "replacements": [{"value": "an"}],
    },
]


def test_format_matches_lists_flagged_text_message_and_suggestion():
    text = format_matches(_TEXT, _MATCHES)
    assert "Found 2 issues:" in text
    assert '"has"' in text
    assert "Use 'have' instead of 'has' after 'I'." in text
    assert "suggested: have" in text


def test_format_matches_falls_back_to_short_message_when_message_missing():
    matches = [{"message": "", "shortMessage": "Spelling", "offset": 0, "length": 1}]
    text = format_matches("x", matches)
    assert "Spelling" in text


def test_format_matches_returns_clean_string_for_no_issues():
    text = format_matches(_TEXT, [])
    assert text == "No issues found — this looks clean."


def test_format_matches_includes_context():
    text = format_matches(_TEXT, _MATCHES[:1])
    assert "context:" in text


def test_format_matches_truncates_beyond_the_shown_limit():
    many_matches = [
        {"message": f"issue {i}", "offset": 0, "length": 1} for i in range(20)
    ]
    text = format_matches("x" * 50, many_matches)
    assert "more issue(s) not shown" in text


def test_format_matches_handles_no_replacements():
    matches = [{"message": "Something's off", "offset": 0, "length": 1, "replacements": []}]
    text = format_matches("x", matches)
    assert "suggested:" not in text
    assert "Something's off" in text


# ---- GrammarCheckTool.run: HTTP request/response path, mocked (no live LanguageTool) -


def _mock_transport(handler):
    return httpx.MockTransport(handler)


async def test_tool_run_returns_error_string_for_empty_text():
    tool = GrammarCheckTool(base_url="http://languagetool:8010")
    result = await tool.run(text="   ")
    assert result.startswith("Error:")


async def test_tool_run_success_parses_mocked_languagetool_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/check"
        return httpx.Response(200, json={"matches": _MATCHES})

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    result = await tool.run(text=_TEXT)
    assert "Found 2 issues" in result
    assert not result.startswith("Grammar check failed")


async def test_tool_run_sends_the_text_and_language():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"matches": []})

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    await tool.run(text="Hello world", language="en-GB")
    assert "text=Hello" in seen["body"] or "text=Hello+world" in seen["body"]
    assert "language=en-GB" in seen["body"]


async def test_tool_run_returns_clean_string_for_no_issues():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"matches": []})

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    result = await tool.run(text="This is fine.")
    assert result == "No issues found — this looks clean."


async def test_tool_run_returns_error_string_on_http_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream unavailable")

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    result = await tool.run(text=_TEXT)
    assert result.startswith("Grammar check failed:")


async def test_tool_run_returns_error_string_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    result = await tool.run(text=_TEXT)
    assert result.startswith("Grammar check failed:")


async def test_tool_run_returns_error_string_on_malformed_json():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    tool = GrammarCheckTool(base_url="http://languagetool:8010", transport=_mock_transport(handler))
    result = await tool.run(text=_TEXT)
    assert result.startswith("Grammar check failed:")
