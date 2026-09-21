"""Pure functions for turning the source metadata gathered by
app/tools/write_research_paper.py's per-section provider calls into a real `.bib` file a
biblatex/biber pipeline can consume.

This is a DIFFERENT, deliberately separate problem from app/tools/citation.py's
`format_citation()`: that produces a human-readable APA/MLA/Chicago citation STRING for
display; this produces machine-readable `@article{...}`/`@misc{...}`/`@inproceedings{...}`
BibTeX *entries* that `\\cite{}` + biblatex/biber actually parse and typeset. Nothing here
touches citation.py's existing behavior. Field-handling spirit (a plain dict of optional
string fields, missing ones simply omitted) follows the same shape citation.py uses, but
the output format itself is unrelated.

No I/O, no model calls -- fully deterministic and unit-testable, same as calculator/
unit_converter/citation.py.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.paper_templates import escape_latex_text

_ENTRY_TYPES = {"article", "misc", "inproceedings"}
_DEFAULT_ENTRY_TYPE = "misc"

_STOP_WORDS = {"a", "an", "the", "on", "of", "in", "for", "and", "to", "with"}
_KEY_UNSAFE_RE = re.compile(r"[^a-z0-9]")


def _slug(text: str) -> str:
    return _KEY_UNSAFE_RE.sub("", text.lower())


def make_bibtex_key(source: dict[str, Any]) -> str:
    """A readable, best-effort BibTeX key derived from author/year/title -- e.g.
    "doe2024attention" -- following the shape real BibTeX databases conventionally use.
    Degrades gracefully as fields are missing, all the way down to the literal "source"
    if nothing usable is present. Does NOT guarantee uniqueness across a whole
    bibliography -- that's assign_citation_keys' job (it de-dupes and suffixes
    collisions), this is just "what's a good key for this one source in isolation"."""
    author = str(source.get("author") or "").strip()
    author_last = ""
    if author:
        first_author = re.split(r",|;| and ", author, maxsplit=1)[0].strip()
        # "Doe, Jane" -> "Doe"; "Jane Doe" -> "Doe" (last space-separated token).
        if "," in author.split(";")[0]:
            author_last = first_author.split(",")[0]
        else:
            parts = first_author.split()
            author_last = parts[-1] if parts else ""

    year_digits = "".join(ch for ch in str(source.get("year") or "") if ch.isdigit())[:4]

    title_word = ""
    title = str(source.get("title") or "").strip()
    for word in re.findall(r"[A-Za-z0-9]+", title):
        if word.lower() not in _STOP_WORDS:
            title_word = word
            break

    key = "".join(_slug(p) for p in (author_last, year_digits, title_word) if p)
    return key or "source"


def _normalize(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def _identity(source: dict[str, Any]) -> str:
    """Two source dicts describe "the same real-world source" (and should collapse to
    one bibliography entry) if they share a normalized URL, or -- when neither has a
    URL -- a normalized (title, author) pair."""
    url = _normalize(source.get("url"))
    if url:
        return f"url:{url}"
    return f"ta:{_normalize(source.get('title'))}|{_normalize(source.get('author'))}"


_MERGE_FIELDS = ("author", "title", "year", "venue", "url", "type")


def assign_citation_keys(
    sources_by_section: list[list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Takes one list of raw source dicts per paper section (each dict's own "key" field
    is whatever short key the model invented to correlate its own `\\cite{key}`
    placeholders within THAT section's prose only -- not yet a real, collision-free
    bibliography key) and returns:

      - `sources`: a de-duplicated list of source dicts, in first-seen order, each
        stamped with its FINAL, stable, collision-free BibTeX key in its own "key"
        field -- ready to hand to assemble_bib().
      - `rename_maps`: a list the same length/order as `sources_by_section`, one
        {old_key: new_key} dict per section, for the caller to rewrite that section's
        `\\cite{old_key}` placeholders to `\\cite{new_key}` before the final document is
        assembled (see write_research_paper.py's `_rewrite_cite_keys`).

    Two sources with the same "identity" (see `_identity`) collapse into a single entry
    even if they came from different sections or used different model-invented keys;
    fields missing from the first-seen copy are filled in from a later duplicate rather
    than discarded. A key collision between two otherwise-DIFFERENT sources (e.g. two
    distinct papers that both produce the candidate key "smith2020") is resolved by
    appending a, b, c, ... to the later one(s).
    """
    canonical_by_identity: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    used_keys: set[str] = set()
    rename_maps: list[dict[str, str]] = []

    for section_sources in sources_by_section:
        section_rename: dict[str, str] = {}
        for source in section_sources:
            old_key = str(source.get("key") or "").strip()
            identity = _identity(source)

            if identity in canonical_by_identity:
                merged = canonical_by_identity[identity]
                for field in _MERGE_FIELDS:
                    if not merged.get(field) and source.get(field):
                        merged[field] = source[field]
                final_key = merged["key"]
            else:
                candidate = make_bibtex_key(source)
                final_key = candidate
                suffix = 0
                while final_key in used_keys:
                    final_key = f"{candidate}{chr(ord('a') + suffix)}"
                    suffix += 1
                used_keys.add(final_key)
                merged = dict(source)
                merged["key"] = final_key
                canonical_by_identity[identity] = merged
                order.append(identity)

            if old_key:
                section_rename[old_key] = final_key
        rename_maps.append(section_rename)

    sources = [canonical_by_identity[identity] for identity in order]
    return sources, rename_maps


def to_bibtex_entry(key: str, source: dict[str, Any]) -> str:
    """Renders one real BibTeX entry -- the shape proven to actually resolve through
    pdflatex/biber/pdflatex in
    services/sandbox-runner/tests/test_latex_compile_integration.py's `_REFS_BIB`.

    Plain-text bibliographic fields (author/title/venue) are LaTeX-escaped with the same
    escape_latex_text() paper_templates.py uses for the title/headings it controls --
    these are typeset as running prose by biblatex, so the same "%"/"&"/"_"/etc. hazards
    apply. `url` is deliberately NOT escaped: it's a machine value biblatex's own
    \\url{}/hyperref handling consumes directly, and escaping "_"/"~"/"%" inside it would
    corrupt the actual link rather than protect anything.
    """
    entry_type = str(source.get("type") or "").strip().lower()
    if entry_type not in _ENTRY_TYPES:
        entry_type = _DEFAULT_ENTRY_TYPE

    fields: list[tuple[str, str]] = []
    if source.get("author"):
        fields.append(("author", escape_latex_text(str(source["author"]))))
    if source.get("title"):
        fields.append(("title", escape_latex_text(str(source["title"]))))
    if source.get("year"):
        fields.append(("year", escape_latex_text(str(source["year"]))))
    if source.get("venue"):
        field_name = "journal" if entry_type == "article" else "booktitle" if entry_type == "inproceedings" else "howpublished"
        fields.append((field_name, escape_latex_text(str(source["venue"]))))
    if source.get("url"):
        fields.append(("url", str(source["url"])))

    # `grounding_note` is stamped on by write_research_paper.py's citation-grounding
    # check (app/services/citation_grounding.py) -- a citation that cleared the check
    # carries no such field and renders exactly as before. Combined with the "no
    # bibliographic detail at all" fallback below (a genuinely separate, older reason to
    # have a note) rather than one replacing the other, so a source that's BOTH
    # bare-metadata AND grounding-flagged still gets both messages instead of losing one.
    note_bits: list[str] = []
    if not fields:
        note_bits.append("No further bibliographic detail was available.")
    if source.get("grounding_note"):
        note_bits.append(str(source["grounding_note"]))
    if note_bits:
        fields.append(("note", escape_latex_text(" ".join(note_bits))))

    body = ",\n  ".join(f"{name} = {{{value}}}" for name, value in fields)
    return f"@{entry_type}{{{key},\n  {body}\n}}"


def assemble_bib(sources: list[dict[str, Any]]) -> str:
    """Concatenates every source (each already stamped with its final "key", see
    assign_citation_keys) into one complete `.bib` file body. Empty input -> empty
    string; callers should treat that as "no bibliography needed" (see
    write_research_paper.py's `has_bibliography`) rather than passing an empty file to
    the compiler."""
    if not sources:
        return ""
    return "\n\n".join(to_bibtex_entry(s["key"], s) for s in sources)
