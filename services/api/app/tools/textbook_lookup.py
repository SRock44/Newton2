from typing import Any

import httpx

from app.tools.base import Tool

OPEN_LIBRARY_BASE = "https://openlibrary.org"


def format_isbn_lookup(isbn: str, book: dict[str, Any] | None) -> str:
    """Pure formatting for Open Library's `/api/books?...&jscmd=data` shape — no I/O, so
    it's testable without a live request. `book` is `None` when Open Library has no
    record for that ISBN (it returns `{}` for an unknown key rather than a 404)."""
    if not book:
        return (
            f"No book found for ISBN {isbn}. Double-check the ISBN, or call this again "
            "with no_textbook=true if the course doesn't actually have one."
        )

    title = book.get("title", "Unknown title")
    authors = ", ".join(a.get("name", "") for a in book.get("authors", []) if a.get("name"))
    lines = [f"{title} — {authors or 'unknown author'} (ISBN {isbn})"]

    subjects = book.get("subjects") or []
    subject_names = [s.get("name", "") if isinstance(s, dict) else str(s) for s in subjects]
    subject_names = [s for s in subject_names if s]
    if subject_names:
        lines.append("Subjects: " + ", ".join(subject_names[:8]))

    toc = book.get("table_of_contents") or []
    chapter_titles = [c.get("title", "") for c in toc if isinstance(c, dict) and c.get("title")]
    if chapter_titles:
        lines.append("Table of contents: " + "; ".join(chapter_titles[:15]))

    return "\n".join(lines)


def format_title_search(query: str, docs: list[dict[str, Any]]) -> str:
    """Pure formatting for Open Library's `/search.json` shape."""
    if not docs:
        return (
            f"No book found matching '{query}'. Try a more specific title/author, or call "
            "this again with no_textbook=true if the course doesn't actually have one."
        )

    lines = [f"Possible matches for '{query}':"]
    for i, doc in enumerate(docs[:3], start=1):
        title = doc.get("title", "Unknown title")
        authors = ", ".join(doc.get("author_name") or []) or "unknown author"
        year = doc.get("first_publish_year")
        isbns = doc.get("isbn") or []
        year_hint = f" ({year})" if year else ""
        isbn_hint = f" [ISBN {isbns[0]}]" if isbns else ""
        lines.append(f"{i}. {title} — {authors}{year_hint}{isbn_hint}")
    return "\n".join(lines)


class TextbookLookupTool(Tool):
    """Looks up a course textbook via Open Library (free, keyless, legitimate metadata
    API — title/authors/subjects/table of contents only, never full copyrighted text).
    `no_textbook=true` is a first-class path, not an afterthought: plenty of courses
    genuinely have no assigned textbook, and this should record that cleanly rather
    than the model guessing or treating an empty ISBN as an error."""

    name = "textbook_lookup"
    description = (
        "Looks up a course textbook by ISBN or title/author (edition, subjects, table "
        "of contents) for context on the course material. If no textbook is assigned, "
        "call with no_textbook=true instead of guessing or leaving it blank."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "isbn": {"type": "string", "description": "10 or 13 digit ISBN, if known"},
            "title": {"type": "string", "description": "Book title, used if no ISBN is known"},
            "author": {"type": "string", "description": "Author name, to disambiguate a title search"},
            "no_textbook": {
                "type": "boolean",
                "description": "Set true if the instructor assigned no textbook",
            },
        },
    }

    def __init__(
        self,
        base_url: str = OPEN_LIBRARY_BASE,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10.0,
    ):
        self.base_url = base_url.rstrip("/")
        self._transport = transport
        self.timeout = timeout

    async def run(
        self,
        isbn: str | None = None,
        title: str | None = None,
        author: str | None = None,
        no_textbook: bool = False,
    ) -> str:
        if no_textbook:
            return (
                "No textbook assigned for this course. Newton will work from the syllabus "
                "and any uploaded materials instead."
            )

        isbn = (isbn or "").strip()
        title = (title or "").strip()
        if not isbn and not title:
            return "Error: provide an isbn, a title, or set no_textbook=true."

        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                if isbn:
                    cleaned = "".join(c for c in isbn if c.isalnum())
                    resp = await client.get(
                        f"{self.base_url}/api/books",
                        params={"bibkeys": f"ISBN:{cleaned}", "format": "json", "jscmd": "data"},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    return format_isbn_lookup(isbn, data.get(f"ISBN:{cleaned}"))

                query = f"{title} {author}".strip() if author else title
                resp = await client.get(f"{self.base_url}/search.json", params={"q": query, "limit": 3})
                resp.raise_for_status()
                data = resp.json()
                return format_title_search(query, data.get("docs") or [])
        except httpx.HTTPError as exc:
            return f"Textbook lookup failed: {exc}"
