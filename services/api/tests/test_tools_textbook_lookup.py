import httpx
import pytest

from app.tools.textbook_lookup import TextbookLookupTool, format_isbn_lookup, format_title_search


def test_format_isbn_lookup_with_full_data():
    book = {
        "title": "Calculus: Early Transcendentals",
        "authors": [{"name": "James Stewart"}],
        "subjects": [{"name": "Calculus"}, "Mathematics"],
        "table_of_contents": [{"title": "Functions and Limits"}, {"title": "Derivatives"}],
    }
    result = format_isbn_lookup("9780538497817", book)
    assert "Calculus: Early Transcendentals" in result
    assert "James Stewart" in result
    assert "9780538497817" in result
    assert "Calculus" in result and "Mathematics" in result
    assert "Functions and Limits" in result


def test_format_isbn_lookup_handles_missing_book():
    result = format_isbn_lookup("0000000000", None)
    assert "No book found" in result
    assert "no_textbook=true" in result


def test_format_isbn_lookup_handles_sparse_data_gracefully():
    # Real Open Library records frequently have no subjects/table_of_contents.
    result = format_isbn_lookup("123", {"title": "Some Book"})
    assert "Some Book" in result
    assert "unknown author" in result


def test_format_title_search_with_results():
    docs = [
        {"title": "Physics for Scientists", "author_name": ["Serway", "Jewett"], "first_publish_year": 2018, "isbn": ["1111111111"]},
    ]
    result = format_title_search("physics for scientists", docs)
    assert "Physics for Scientists" in result
    assert "Serway" in result
    assert "2018" in result
    assert "1111111111" in result


def test_format_title_search_no_results():
    result = format_title_search("a very obscure query", [])
    assert "No book found" in result
    assert "no_textbook=true" in result


async def test_run_no_textbook_returns_clean_message_without_any_http_call():
    def fail_if_called(request):
        raise AssertionError("no_textbook=true must not make an HTTP request")

    tool = TextbookLookupTool(transport=httpx.MockTransport(fail_if_called))
    result = await tool.run(no_textbook=True)
    assert "No textbook assigned" in result


async def test_run_requires_isbn_title_or_no_textbook():
    tool = TextbookLookupTool()
    result = await tool.run()
    assert result.startswith("Error:")


async def test_run_isbn_success_mocked():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["bibkeys"] == "ISBN:9780538497817"
        return httpx.Response(
            200,
            json={
                "ISBN:9780538497817": {
                    "title": "Calculus: Early Transcendentals",
                    "authors": [{"name": "James Stewart"}],
                }
            },
        )

    tool = TextbookLookupTool(transport=httpx.MockTransport(handler))
    result = await tool.run(isbn="9780538497817")
    assert "Calculus: Early Transcendentals" in result


async def test_run_isbn_not_found_mocked():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})  # Open Library's actual "unknown ISBN" shape

    tool = TextbookLookupTool(transport=httpx.MockTransport(handler))
    result = await tool.run(isbn="0000000000")
    assert "No book found" in result


async def test_run_title_search_mocked():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "physics" in request.url.params["q"].lower()
        return httpx.Response(200, json={"docs": [{"title": "Physics", "author_name": ["Halliday"]}]})

    tool = TextbookLookupTool(transport=httpx.MockTransport(handler))
    result = await tool.run(title="physics", author="Halliday")
    assert "Physics" in result


async def test_run_handles_http_error_gracefully():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    tool = TextbookLookupTool(transport=httpx.MockTransport(handler))
    result = await tool.run(isbn="123")
    assert result.startswith("Textbook lookup failed:")


async def test_run_handles_connection_error_gracefully():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated network failure")

    tool = TextbookLookupTool(transport=httpx.MockTransport(handler))
    result = await tool.run(title="anything")
    assert result.startswith("Textbook lookup failed:")


@pytest.mark.live_smoke
async def test_run_against_real_open_library():
    """One real network call against the actual Open Library API, for a well-known
    ISBN. Not mocked -- confirms the real integration works, not just our mock shape."""
    tool = TextbookLookupTool()
    result = await tool.run(isbn="9780262033848")  # "Introduction to Algorithms" (CLRS)
    assert "Error" not in result
    assert "algorithm" in result.lower() or "cormen" in result.lower() or "clrs" in result.lower()
