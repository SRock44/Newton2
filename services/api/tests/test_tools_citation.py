import pytest

from app.tools.citation import CitationFormatterTool, format_citation

ONE_AUTHOR = [{"last": "Doe", "first": "Jane"}]
TWO_AUTHORS = [{"last": "Doe", "first": "Jane"}, {"last": "Smith", "first": "John"}]
THREE_AUTHORS = [
    {"last": "Doe", "first": "Jane"},
    {"last": "Smith", "first": "John"},
    {"last": "Lee", "first": "Amy"},
]

# ---------------------------------------------------------------------------
# APA
# ---------------------------------------------------------------------------


def test_apa_book_one_author():
    result = format_citation(
        "apa", "book", ONE_AUTHOR, "The Study Guide", "2020", publisher="Acme Press"
    )
    assert result == "Doe, J. (2020). The Study Guide. Acme Press."


def test_apa_uses_initials_not_full_first_name():
    result = format_citation("apa", "book", [{"last": "Doe", "first": "Jane Marie"}], "T", "2020")
    assert "Doe, J. M." in result


def test_apa_two_authors_joined_with_ampersand():
    result = format_citation("apa", "book", TWO_AUTHORS, "T", "2020")
    assert "Doe, J. & Smith, J." in result


def test_apa_three_authors_uses_et_al():
    result = format_citation("apa", "book", THREE_AUTHORS, "T", "2020")
    assert result.startswith("Doe, J. et al.")


def test_apa_journal_article_with_volume_and_issue():
    result = format_citation(
        "apa", "journal_article", ONE_AUTHOR, "A Study", "2021",
        journal="Journal of Things", volume="12", issue="3", pages="45-67",
    )
    assert result == "Doe, J. (2021). A Study. Journal of Things, 12(3), 45-67."


def test_apa_journal_article_with_only_volume():
    result = format_citation(
        "apa", "journal_article", ONE_AUTHOR, "A Study", "2021", journal="J", volume="12"
    )
    assert result == "Doe, J. (2021). A Study. J, 12."


def test_apa_website_with_url():
    result = format_citation(
        "apa", "website", ONE_AUTHOR, "A Page", "2022", site_name="Example.com",
        url="https://example.com/page",
    )
    assert result == "Doe, J. (2022). A Page. Example.com. https://example.com/page"


def test_apa_book_with_no_publisher_has_no_dangling_space():
    result = format_citation("apa", "book", ONE_AUTHOR, "T", "2020")
    assert result == "Doe, J. (2020). T."


# ---------------------------------------------------------------------------
# MLA
# ---------------------------------------------------------------------------


def test_mla_book_one_author():
    result = format_citation(
        "mla", "book", ONE_AUTHOR, "The Study Guide", "2020", publisher="Acme Press"
    )
    assert result == "Doe, Jane. The Study Guide. Acme Press, 2020."


def test_mla_uses_full_first_name_not_initials():
    result = format_citation("mla", "book", [{"last": "Doe", "first": "Jane Marie"}], "T", "2020")
    assert "Doe, Jane Marie" in result


def test_mla_two_authors_joined_with_and():
    result = format_citation("mla", "book", TWO_AUTHORS, "T", "2020")
    assert "Doe, Jane and Smith, John" in result


def test_mla_journal_article():
    result = format_citation(
        "mla", "journal_article", ONE_AUTHOR, "A Study", "2021",
        journal="Journal of Things", volume="12", issue="3", pages="45-67",
    )
    assert result == 'Doe, Jane. "A Study." Journal of Things, vol. 12, no. 3, 2021, pp. 45-67.'


def test_mla_website():
    result = format_citation(
        "mla", "website", ONE_AUTHOR, "A Page", "2022", site_name="Example.com",
        url="https://example.com/page",
    )
    assert result == 'Doe, Jane. "A Page." Example.com, 2022. https://example.com/page'


# ---------------------------------------------------------------------------
# Chicago (author-date)
# ---------------------------------------------------------------------------


def test_chicago_book():
    result = format_citation(
        "chicago", "book", ONE_AUTHOR, "The Study Guide", "2020", publisher="Acme Press"
    )
    assert result == "Doe, Jane. 2020. The Study Guide. Acme Press."


def test_chicago_two_authors_joined_with_ampersand():
    result = format_citation("chicago", "book", TWO_AUTHORS, "T", "2020")
    assert "Doe, Jane & Smith, John" in result


def test_chicago_journal_article():
    result = format_citation(
        "chicago", "journal_article", ONE_AUTHOR, "A Study", "2021",
        journal="Journal of Things", volume="12", issue="3", pages="45-67",
    )
    assert result == 'Doe, Jane. 2021. "A Study." Journal of Things 12 (3): 45-67.'


def test_chicago_website():
    result = format_citation(
        "chicago", "website", ONE_AUTHOR, "A Page", "2022", site_name="Example.com",
        url="https://example.com/page",
    )
    assert result == 'Doe, Jane. 2022. "A Page." Example.com. https://example.com/page'


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_rejects_unknown_style():
    with pytest.raises(ValueError, match="unknown style"):
        format_citation("harvard", "book", ONE_AUTHOR, "T", "2020")


def test_rejects_unknown_source_type():
    with pytest.raises(ValueError, match="unknown source_type"):
        format_citation("apa", "podcast", ONE_AUTHOR, "T", "2020")


def test_rejects_no_authors():
    with pytest.raises(ValueError, match="author"):
        format_citation("apa", "book", [], "T", "2020")


def test_rejects_empty_title():
    with pytest.raises(ValueError, match="title"):
        format_citation("apa", "book", ONE_AUTHOR, "", "2020")


def test_rejects_empty_year():
    with pytest.raises(ValueError, match="year"):
        format_citation("apa", "book", ONE_AUTHOR, "T", "")


def test_style_and_source_type_are_case_insensitive():
    result = format_citation("APA", "Book", ONE_AUTHOR, "T", "2020")
    assert result.startswith("Doe, J.")


def test_author_with_no_first_name_uses_last_name_only():
    result = format_citation("apa", "book", [{"last": "Cher"}], "T", "2020")
    assert result.startswith("Cher (2020)")


# ---------------------------------------------------------------------------
# CitationFormatterTool.run — error strings instead of raising
# ---------------------------------------------------------------------------


async def test_tool_run_returns_the_citation_on_success():
    tool = CitationFormatterTool()
    result = await tool.run("apa", "book", ONE_AUTHOR, "T", "2020", publisher="P")
    assert result == "Doe, J. (2020). T. P."


async def test_tool_run_returns_error_string_for_invalid_style():
    tool = CitationFormatterTool()
    result = await tool.run("harvard", "book", ONE_AUTHOR, "T", "2020")
    assert result.startswith("Error:")


async def test_tool_run_returns_error_string_for_no_authors():
    tool = CitationFormatterTool()
    result = await tool.run("apa", "book", [], "T", "2020")
    assert result.startswith("Error:")
