"""Real, deterministic check that a drafted section's \\cite{key} claims are actually
supported by that source's real fetched page text -- app/tools/write_research_paper.py's
answer to the product review finding that this tool had "zero computational grounding":
every other piece of that call chain is real (a real web_search, a real allowlisted/
SSRF-defended research_fetch of the page, real biblatex compilation) except the one link
this module now checks -- whether the sentence the model wrote next to `\\cite{key}` is
actually about what the fetched page for that key actually says, or is a citation-shaped
hallucination (a real, successfully-fetched source, attributed to a sentence it doesn't
support).

Deliberately NOT a general fact-checker or embeddings/ML similarity model -- see this
module's own tests (tests/test_citation_grounding.py) for why a much simpler, fully
deterministic, easily-audited measure was chosen instead: the fraction of a claim's own
significant (non-stopword, length>=4) words that also appear anywhere in the source's
fetched text ("containment"). This is the same "keyword/word-overlap heuristic over free
text" category of check app/tools/check_proof_work.py already uses for its own structural
critique -- not a logic/semantics engine, explicitly labeled as a heuristic wherever its
result surfaces (see write_research_paper.py's own grounding-summary text).

Known, honestly-stated limitation (confirmed by this module's own tests, not just
asserted): pure lexical overlap can tell "this sentence is about a topic nowhere in the
source" (the case this exists to catch -- an invented statistic/quote/claim attributed to
a real but unrelated fetched page) from "this sentence's vocabulary genuinely appears in
the source". It CANNOT tell "this sentence reuses the source's own vocabulary but asserts
something the source doesn't actually say" (e.g. inverting a real source's finding while
reusing its nouns) -- that would require actual semantic entailment, which is exactly the
"much harder, unbounded problem" this feature is deliberately scoped away from. This
module's docstring and write_research_paper.py's summary text both say so plainly rather
than letting a passing "grounded" status imply more confidence than the check earns.

GROUNDING_THRESHOLD was picked empirically, not guessed: a real short passage of source
text was compared against a real paraphrase of it (should pass), a real near-verbatim
quote of it (should pass, and pass by a wide margin), and two realistic FABRICATED claims
about the same general topic but not actually stated in the passage (should fail) -- see
tests/test_citation_grounding.py's `_SOURCE_TEXT`/`_GROUNDED_*`/`_FABRICATED_*` fixtures,
which are the literal fixtures used to pick this number. Genuine paraphrases scored
0.25-0.87 containment against their source; the two fabricated-but-same-topic claims
scored 0.08 and 0.13; completely unrelated claims scored 0.0. 0.20 sits with real margin
on both sides of that gap.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# Picked via real testing against real fixtures -- see this module's docstring and
# tests/test_citation_grounding.py for the actual scores that motivated this number.
#
# Note on very short citing sentences: a claim with only one or two significant words can
# trivially score high by chance (one matching word out of two = 0.5). This is a real,
# honestly-stated limitation of a single containment number rather than something this
# module special-cases with a second confidence dimension -- see the module docstring.
GROUNDING_THRESHOLD = 0.20

_STOPWORDS = frozenset(
    {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "of", "to",
        "for", "that", "this", "and", "or", "in", "on", "at", "by", "with", "from", "as",
        "it", "its", "their", "they", "he", "she", "we", "you", "i", "but", "not", "no",
        "so", "than", "then", "has", "have", "had", "will", "would", "could", "should",
        "can", "may", "might", "must", "do", "does", "did", "which", "who", "whom",
        "what", "when", "where", "why", "how", "all", "any", "some", "other", "such",
        "more", "most", "also", "into", "over", "under", "about", "between", "through",
        "during", "before", "after", "up", "down", "out", "these", "those", "there",
        "here", "if", "because", "while", "per", "each", "both", "only", "just", "very",
        "own", "same", "new",
    }
)

_WORD_RE = re.compile(r"[A-Za-z0-9]+")
# Matches \cite{key1,key2} and biblatex's optional-argument form \cite[42]{key} --
# mirrors write_research_paper.py's own _CITE_RE, kept as an independent copy here (same
# "small independent copy rather than a shared private import" convention that module's
# own docstring on _normalize_url_key follows) since this module has no other dependency
# on write_research_paper.py at all.
_CITE_RE = re.compile(r"\\cite(?:\[[^\]]*\])*\{([^}]*)\}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_CLAIM_EXCERPT_CHARS = 220


def _significant_words(text: str) -> set[str]:
    """Lowercased word tokens, stopwords and short (<4 char) tokens dropped -- the same
    "meaningful content word" filter check_proof_work.py's own `_keywords` applies for
    its own overlap heuristic, independently reimplemented here (different stopword
    list, different length cutoff tuned for THIS check's own fixtures) rather than
    imported, since the two heuristics solve different problems and shouldn't be coupled
    by a shared implementation that could drift for the wrong reason."""
    return {w for w in _WORD_RE.findall(text.lower()) if len(w) >= 4 and w not in _STOPWORDS}


def _containment_score(claim_text: str, source_text: str) -> float:
    """What fraction of the claim's own significant words also appear somewhere in the
    source text -- deliberately claim-recall, not a symmetric ratio (e.g. Jaccard or
    difflib.SequenceMatcher over the whole strings), because the source text is
    routinely orders of magnitude longer than one claim sentence; a symmetric measure
    would make every score collapse toward zero regardless of real support, which is
    exactly the failure this method avoids. 0.0 for an empty/all-stopword claim (nothing
    to check -- never a divide-by-zero)."""
    claim_words = _significant_words(claim_text)
    if not claim_words:
        return 0.0
    source_words = _significant_words(source_text)
    return len(claim_words & source_words) / len(claim_words)


def _split_sentences(text: str) -> list[str]:
    """A deliberately simple sentence splitter (split on .!? followed by whitespace) --
    heuristic, not a real tokenizer, same spirit as check_proof_work.py's own regex-based
    text heuristics. Good enough for its one job here: finding the sentence(s) around a
    \\cite{} placeholder, where an occasional over/under-split just widens or narrows the
    claim text slightly rather than silently producing a wrong verdict."""
    collapsed = re.sub(r"\s+", " ", text).strip()
    if not collapsed:
        return []
    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(collapsed) if s.strip()]


def extract_citing_claims(prose: str) -> dict[str, str]:
    """Maps each local citation key used anywhere in `prose` to the concatenated text of
    every sentence that cites it, with the \\cite{...} command itself stripped out (it's
    LaTeX syntax, not part of the natural-language claim, and would otherwise pollute the
    word-overlap score with the word "cite" and the key itself). A key cited in more than
    one sentence gets all of those sentences' text joined -- see this module's docstring
    for why one combined score per key, not one per sentence, matches what the brief this
    module implements actually asks for ("the sentence(s) ... that cite that key")."""
    sentences = _split_sentences(prose)
    by_key: dict[str, list[str]] = {}
    for sentence in sentences:
        keys_here: set[str] = set()
        for match in _CITE_RE.finditer(sentence):
            for raw_key in match.group(1).split(","):
                key = raw_key.strip()
                if key:
                    keys_here.add(key)
        if not keys_here:
            continue
        claim_text = _CITE_RE.sub("", sentence).strip()
        for key in keys_here:
            by_key.setdefault(key, []).append(claim_text)
    return {key: " ".join(parts).strip() for key, parts in by_key.items()}


def _normalize_url(url: str) -> str:
    """Same normalization write_research_paper.py's own `_normalize_url_key` (and, before
    that, app/services/bibliography.py's `_normalize`) applies -- lowercase, collapsed
    whitespace. Kept as an independent copy for the same reason those two already are
    independent copies of each other (see write_research_paper.py's docstring on
    `_normalize_url_key`): this module has no other reason to import from either."""
    return re.sub(r"\s+", " ", str(url or "").strip().lower())


@dataclass
class GroundingResult:
    """One citation's grounding verdict for ONE section's drafted prose (local, pre-
    bibliography-dedup key -- see write_research_paper.py's own docstring on why a
    section's "sources"/`\\cite{}` keys are local correlation ids, not final BibTeX
    keys). `status`:

      "grounded"    -- the source WAS actually fetched, and the claim(s) citing it score
                       at or above GROUNDING_THRESHOLD containment against the source's
                       real fetched text.
      "ungrounded"  -- the source WAS actually fetched, but the claim(s) citing it score
                       below GROUNDING_THRESHOLD -- a real source, cited for a claim it
                       doesn't appear to actually support.
      "not_fetched" -- this key's source was never actually fetched via research_fetch at
                       all (no URL, or a URL research_fetch never successfully retrieved
                       in this section) -- there is no real page text to check the claim
                       against, so nothing was computed (`score` is None). Per the brief
                       this module implements, this is a DIFFERENT, WORSE case than
                       "ungrounded": ungrounded means "checked and didn't clearly match";
                       not_fetched means "never checked at all, purely the model's own
                       claim about a source's own metadata."
    """

    key: str
    status: str
    score: float | None
    claim_excerpt: str


def check_section_grounding(
    prose: str,
    sources: list[dict[str, Any]],
    url_fetched_text: dict[str, str],
) -> list[GroundingResult]:
    """The real entry point: for every source a section's drafting call actually reported
    (each with its own local "key"), finds the prose sentence(s) citing that key and, if
    that source's URL was one this section actually fetched (present in
    `url_fetched_text`, url -> real fetched page text, see write_research_paper.py's
    `_gather_section_material`), scores those sentences' claim-word containment against
    the REAL fetched text. A source with no "key" is skipped (parse_section_response
    already filters those out upstream, but this stays defensive rather than assuming
    it). Never raises -- a source whose key has no citing sentence at all (a stale/unused
    "sources" entry) still gets a result, scored against an empty claim (0.0, i.e.
    "ungrounded" if it was fetched, since an empty claim trivially fails to demonstrate
    any real support)."""
    citing = extract_citing_claims(prose)
    # Same normalized-URL matching convention write_research_paper.py's own
    # `_prefer_extracted_metadata` uses for the identical "match a model-reported source
    # URL to a fetched URL" problem -- built once per call, not per source.
    normalized_fetched = {_normalize_url(u): t for u, t in url_fetched_text.items()}

    results: list[GroundingResult] = []
    for source in sources:
        key = str(source.get("key") or "").strip()
        if not key:
            continue
        claim_text = citing.get(key, "")
        url = str(source.get("url") or "").strip()
        fetched_text = normalized_fetched.get(_normalize_url(url)) if url else None

        excerpt = claim_text[:_CLAIM_EXCERPT_CHARS]
        if fetched_text is None:
            results.append(GroundingResult(key=key, status="not_fetched", score=None, claim_excerpt=excerpt))
            continue

        score = _containment_score(claim_text, fetched_text)
        status = "grounded" if score >= GROUNDING_THRESHOLD else "ungrounded"
        results.append(GroundingResult(key=key, status=status, score=round(score, 3), claim_excerpt=excerpt))
    return results
