"""Pure-function tests for app.services.bibliography -- no DB, no network, no provider.
Follows tests/test_study_planner.py's "pure parsing tests" style for this codebase's
deterministic, no-I/O helpers."""

from app.services.bibliography import (
    assemble_bib,
    assign_citation_keys,
    make_bibtex_key,
    to_bibtex_entry,
)

# ---------------------------------------------------------------------------
# make_bibtex_key
# ---------------------------------------------------------------------------


def test_make_bibtex_key_from_full_metadata():
    key = make_bibtex_key({"author": "Jane Doe", "year": "2024", "title": "Attention Is All You Need"})
    assert key == "doe2024attention"


def test_make_bibtex_key_handles_last_first_author_format():
    key = make_bibtex_key({"author": "Doe, Jane", "year": "2024", "title": "A Study of Things"})
    assert key == "doe2024study"


def test_make_bibtex_key_skips_leading_stop_words_in_title():
    key = make_bibtex_key({"author": "Smith", "year": "2020", "title": "The Analysis of Systems"})
    assert key == "smith2020analysis"


def test_make_bibtex_key_degrades_gracefully_with_missing_fields():
    assert make_bibtex_key({"title": "Only A Title Here"}) == "only"
    assert make_bibtex_key({}) == "source"


def test_make_bibtex_key_is_lowercase_alnum_only():
    key = make_bibtex_key({"author": "O'Brien-Smith", "year": "2021", "title": "Café Life"})
    assert key.isalnum()
    assert key == key.lower()


# ---------------------------------------------------------------------------
# assign_citation_keys -- de-duplication + stable key assignment across sections
# ---------------------------------------------------------------------------


def test_assign_citation_keys_gives_each_distinct_source_its_own_key():
    sources_by_section = [
        [{"key": "a", "author": "Doe", "year": "2020", "title": "First Paper"}],
        [{"key": "b", "author": "Smith", "year": "2021", "title": "Second Paper"}],
    ]
    sources, rename_maps = assign_citation_keys(sources_by_section)
    assert len(sources) == 2
    assert rename_maps[0] == {"a": sources[0]["key"]}
    assert rename_maps[1] == {"b": sources[1]["key"]}
    assert sources[0]["key"] != sources[1]["key"]


def test_assign_citation_keys_dedupes_same_url_across_sections():
    sources_by_section = [
        [{"key": "x", "title": "Paper", "url": "https://arxiv.org/abs/1234"}],
        [{"key": "y", "title": "Paper (dup)", "url": "https://arxiv.org/abs/1234"}],
    ]
    sources, rename_maps = assign_citation_keys(sources_by_section)
    assert len(sources) == 1
    final_key = sources[0]["key"]
    assert rename_maps[0]["x"] == final_key
    assert rename_maps[1]["y"] == final_key


def test_assign_citation_keys_dedupes_by_title_and_author_when_no_url():
    sources_by_section = [
        [{"key": "p1", "author": "Doe", "title": "Some Study"}],
        [{"key": "p2", "author": "doe", "title": "  some   study  "}],  # same, just noisy casing/whitespace
    ]
    sources, rename_maps = assign_citation_keys(sources_by_section)
    assert len(sources) == 1
    assert rename_maps[0]["p1"] == rename_maps[1]["p2"]


def test_assign_citation_keys_fills_in_missing_fields_from_a_later_duplicate():
    sources_by_section = [
        [{"key": "a", "title": "Paper", "url": "https://arxiv.org/abs/1"}],
        [{"key": "b", "title": "Paper", "url": "https://arxiv.org/abs/1", "author": "Doe", "year": "2022"}],
    ]
    sources, _ = assign_citation_keys(sources_by_section)
    assert len(sources) == 1
    assert sources[0]["author"] == "Doe"
    assert sources[0]["year"] == "2022"


def test_assign_citation_keys_suffixes_a_genuine_key_collision():
    # Two DIFFERENT real sources that happen to produce the same candidate key.
    sources_by_section = [
        [
            {"key": "s1", "author": "Smith", "year": "2020", "title": "Networks", "url": "https://arxiv.org/abs/1"},
            {"key": "s2", "author": "Smith", "year": "2020", "title": "Networks Revisited", "url": "https://arxiv.org/abs/2"},
        ]
    ]
    sources, rename_maps = assign_citation_keys(sources_by_section)
    keys = [s["key"] for s in sources]
    assert len(keys) == 2
    assert len(set(keys)) == 2  # no collision in the final output
    assert rename_maps[0]["s1"] != rename_maps[0]["s2"]


def test_assign_citation_keys_handles_no_sources_at_all():
    sources, rename_maps = assign_citation_keys([[], []])
    assert sources == []
    assert rename_maps == [{}, {}]


# ---------------------------------------------------------------------------
# to_bibtex_entry
# ---------------------------------------------------------------------------


def test_to_bibtex_entry_produces_a_real_article_entry():
    entry = to_bibtex_entry(
        "doe2024attention",
        {
            "type": "article",
            "author": "Jane Doe",
            "title": "Attention Is All You Need",
            "year": "2024",
            "venue": "Journal of AI",
            "url": "https://arxiv.org/abs/1234",
        },
    )
    assert entry.startswith("@article{doe2024attention,")
    assert "author = {Jane Doe}" in entry
    assert "title = {Attention Is All You Need}" in entry
    assert "journal = {Journal of AI}" in entry
    assert "url = {https://arxiv.org/abs/1234}" in entry
    assert entry.endswith("}")


def test_to_bibtex_entry_unknown_type_falls_back_to_misc():
    entry = to_bibtex_entry("k", {"type": "book", "title": "Something"})
    assert entry.startswith("@misc{k,")


def test_to_bibtex_entry_inproceedings_uses_booktitle_field():
    entry = to_bibtex_entry("k", {"type": "inproceedings", "title": "T", "venue": "NeurIPS"})
    assert "booktitle = {NeurIPS}" in entry


def test_to_bibtex_entry_escapes_dangerous_characters_in_text_fields():
    entry = to_bibtex_entry(
        "k", {"type": "misc", "title": "50% Faster & Better: A_Study #1", "author": "A~B^C"}
    )
    assert r"\%" in entry
    assert r"\&" in entry
    assert r"\_" in entry
    assert r"\#" in entry
    assert r"\textasciitilde{}" in entry
    assert r"\textasciicircum{}" in entry


def test_to_bibtex_entry_does_not_escape_the_url_field():
    entry = to_bibtex_entry("k", {"type": "misc", "title": "T", "url": "https://en.wikipedia.org/wiki/A_B%20C"})
    assert "url = {https://en.wikipedia.org/wiki/A_B%20C}" in entry


def test_to_bibtex_entry_with_no_fields_still_produces_valid_bibtex():
    entry = to_bibtex_entry("k", {})
    assert entry.startswith("@misc{k,")
    assert "note = {No further bibliographic detail was available.}" in entry


# ---------------------------------------------------------------------------
# assemble_bib
# ---------------------------------------------------------------------------


def test_assemble_bib_joins_multiple_entries():
    sources = [
        {"key": "a", "type": "misc", "title": "First"},
        {"key": "b", "type": "misc", "title": "Second"},
    ]
    bib = assemble_bib(sources)
    assert "@misc{a," in bib
    assert "@misc{b," in bib
    assert bib.count("@misc") == 2


def test_assemble_bib_empty_list_is_empty_string():
    assert assemble_bib([]) == ""
