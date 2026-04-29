"""End-to-end agent tests against the real Groq LLM and a real Chroma collection.

Slow but truthful — no mocks. Requires GROQ_API_KEY to be set.

Calibrated to the NIST AI Risk Management Framework PDF in `tests/sample.pdf`.
"""

import re

from app.agent import run_agent

DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")


def test_in_scope_returns_citations(sample_pdf_id: str) -> None:
    result = run_agent(
        "What are the four core functions of the AI RMF?", sample_pdf_id
    )
    assert result["route_taken"] == "answered"
    assert len(result["citations"]) >= 1
    answer = result["answer"].upper()
    # The four core functions: GOVERN, MAP, MEASURE, MANAGE.
    for fn in ("GOVERN", "MAP", "MEASURE", "MANAGE"):
        assert fn in answer, f"expected {fn} in answer, got: {result['answer']!r}"


def test_out_of_scope_refuses(sample_pdf_id: str) -> None:
    result = run_agent("What's the weather in Bangalore today?", sample_pdf_id)
    assert result["route_taken"] == "refused"
    assert result["citations"] == []


def test_hindi_query_returns_hindi_answer(sample_pdf_id: str) -> None:
    result = run_agent(
        "AI RMF के चार मुख्य फ़ंक्शंस कौन से हैं?", sample_pdf_id
    )
    assert result["route_taken"] == "answered"
    assert DEVANAGARI_RE.search(result["answer"]) is not None, (
        f"expected Devanagari in answer, got: {result['answer']!r}"
    )
