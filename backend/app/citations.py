"""Parse [p<n>] markers from an LLM answer into structured citations."""

import re

# [p3] and [p3, p7] / [p3, 7] only — won't match prose like [plug] or [part].
CITATION_RE = re.compile(r"\[p\d+(?:\s*,\s*p?\d+)*\]", re.IGNORECASE)
PAGE_NUM_RE = re.compile(r"\d+")
SNIPPET_LEN = 240


def parse_citations(text: str, retrieved: list[dict]) -> list[dict]:
    """Pull every [p<n>] marker (incl. [p3, p7]) and back each cited page
    with the best-scoring retrieved chunk on that page.
    """
    pages_in_order: list[int] = []
    for match in CITATION_RE.finditer(text):
        for num in PAGE_NUM_RE.findall(match.group(0)):
            page = int(num)
            if page not in pages_in_order:
                pages_in_order.append(page)

    best_by_page: dict[int, dict] = {}
    for chunk in retrieved:
        page = chunk["page"]
        existing = best_by_page.get(page)
        if existing is None or chunk["score"] < existing["score"]:
            best_by_page[page] = chunk

    citations: list[dict] = []
    for page in pages_in_order:
        chunk = best_by_page.get(page)
        if chunk is None:
            continue
        snippet = chunk["text"][:SNIPPET_LEN].strip()
        citations.append(
            {"page": page, "snippet": snippet, "chunk_id": chunk["chunk_id"]}
        )
    return citations
