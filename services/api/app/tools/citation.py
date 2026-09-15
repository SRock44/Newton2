from typing import Any

from app.tools.base import Tool

_STYLES = {"apa", "mla", "chicago"}
_SOURCE_TYPES = {"book", "journal_article", "website"}


def _initials(first_name: str) -> str:
    parts = [p for p in first_name.replace("-", " ").split() if p]
    return " ".join(f"{p[0].upper()}." for p in parts)


def _author_name(author: dict[str, str], style: str) -> str:
    last = (author.get("last") or "").strip()
    first = (author.get("first") or "").strip()
    if not first:
        return last
    given = _initials(first) if style == "apa" else first
    return f"{last}, {given}"


def _join_authors(names: list[str], style: str) -> str:
    names = [n for n in names if n]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        conj = "&" if style in ("apa", "chicago") else "and"
        return f"{names[0]} {conj} {names[1]}"
    # 3+: first author + et al. -- a deliberate simplification. Real APA 7 lists every
    # author up to 20 before truncating, and MLA/Chicago have their own similarly
    # detailed rules; reproducing those exactly is a lot of surface area for a tool
    # whose job is a quick, good-enough citation, not full bibliographic software.
    return f"{names[0]} et al."


def format_citation(
    style: str,
    source_type: str,
    authors: list[dict[str, str]],
    title: str,
    year: str,
    publisher: str | None = None,
    journal: str | None = None,
    volume: str | None = None,
    issue: str | None = None,
    pages: str | None = None,
    site_name: str | None = None,
    url: str | None = None,
) -> str:
    """Pure formatting, no I/O -- deterministic like calculator/unit_converter, not a
    model call, so a citation is exact and reproducible rather than something an LLM
    might phrase slightly differently each time. Covers the common cases (book, journal
    article, website) across APA 7 / MLA 9 / Chicago (author-date) author-list and
    field conventions; see _join_authors for the one deliberate simplification."""
    style = style.lower().strip()
    source_type = source_type.lower().strip()
    if style not in _STYLES:
        raise ValueError(f"unknown style '{style}', expected one of {sorted(_STYLES)}")
    if source_type not in _SOURCE_TYPES:
        raise ValueError(f"unknown source_type '{source_type}', expected one of {sorted(_SOURCE_TYPES)}")
    if not authors:
        raise ValueError("at least one author is required")
    if not title or not title.strip():
        raise ValueError("title is required")
    if not year or not str(year).strip():
        raise ValueError("year is required")

    title = title.strip()
    year = str(year).strip()
    author_str = _join_authors([_author_name(a, style) for a in authors], style)

    def part(prefix: str, value: str | None, suffix: str = "") -> str:
        return f"{prefix}{value}{suffix}" if value else ""

    if style == "apa":
        if source_type == "book":
            return f"{author_str} ({year}). {title}.{part(' ', publisher, '.')}"
        if source_type == "journal_article":
            vol_issue = f"{volume}({issue})" if volume and issue else (volume or issue or "")
            return (
                f"{author_str} ({year}). {title}. {journal or ''}"
                f"{part(', ', vol_issue)}{part(', ', pages)}."
            )
        return f"{author_str} ({year}). {title}.{part(' ', site_name, '.')}{part(' ', url)}"  # website

    if style == "mla":
        if source_type == "book":
            return f'{author_str}. {title}.{part(" ", publisher, ",")} {year}.'
        if source_type == "journal_article":
            return (
                f'{author_str}. "{title}." {journal or ""}'
                f'{part(", vol. ", volume)}{part(", no. ", issue)}, {year}{part(", pp. ", pages)}.'
            )
        return f'{author_str}. "{title}."{part(" ", site_name, ",")} {year}.{part(" ", url)}'  # website

    # chicago (author-date)
    if source_type == "book":
        return f"{author_str}. {year}. {title}.{part(' ', publisher, '.')}"
    if source_type == "journal_article":
        return (
            f'{author_str}. {year}. "{title}." {journal or ""}'
            f"{part(' ', volume)}{part(' (', issue, ')')}{part(': ', pages)}."
        )
    return f'{author_str}. {year}. "{title}."{part(" ", site_name, ".")}{part(" ", url)}'  # website


class CitationFormatterTool(Tool):
    name = "format_citation"
    description = (
        "Formats a source into an APA, MLA, or Chicago (author-date) citation -- exact, "
        "not a guess, always use this instead of writing one by hand. source_type "
        "'book' uses publisher; 'journal_article' uses journal/volume/issue/pages; "
        "'website' uses site_name/url."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "style": {"type": "string", "enum": sorted(_STYLES)},
            "source_type": {"type": "string", "enum": sorted(_SOURCE_TYPES)},
            "authors": {
                "type": "array",
                "description": "e.g. [{\"last\": \"Doe\", \"first\": \"Jane\"}]",
                "items": {
                    "type": "object",
                    "properties": {"last": {"type": "string"}, "first": {"type": "string"}},
                    "required": ["last"],
                },
            },
            "title": {"type": "string"},
            "year": {"type": "string"},
            "publisher": {"type": "string"},
            "journal": {"type": "string"},
            "volume": {"type": "string"},
            "issue": {"type": "string"},
            "pages": {"type": "string"},
            "site_name": {"type": "string"},
            "url": {"type": "string"},
        },
        "required": ["style", "source_type", "authors", "title", "year"],
    }

    async def run(
        self,
        style: str,
        source_type: str,
        authors: list[dict[str, str]],
        title: str,
        year: str,
        publisher: str | None = None,
        journal: str | None = None,
        volume: str | None = None,
        issue: str | None = None,
        pages: str | None = None,
        site_name: str | None = None,
        url: str | None = None,
    ) -> str:
        try:
            return format_citation(
                style, source_type, authors, title, year,
                publisher=publisher, journal=journal, volume=volume, issue=issue,
                pages=pages, site_name=site_name, url=url,
            )
        except (ValueError, TypeError, KeyError) as exc:
            return f"Error: {exc}"
