"""The single strict prompt that drives grounding, citations, and refusals."""

import re

REFUSAL_SENTINEL = "THIS_IS_NOT_IN_THE_DOCUMENT"

# Match the same pattern as app/citations.py so we can strip prior citations
# from history without leaking them into the new turn's prompt.
_CITATION_RE = re.compile(r"\[p\d+(?:\s*,\s*p?\d+)*\]", re.IGNORECASE)

ANSWER_PROMPT = """You are a strict question-answering assistant for a single PDF document.

RULES — follow exactly:
1. You may ONLY use information from the EXCERPTS below. Do NOT use outside knowledge or guess.
2. After every factual claim, append a citation marker [p<page>] using the page number from the excerpt the fact came from. For multi-page facts, write [p3, p7].
3. If the EXCERPTS do not contain the information needed to answer the question, your reply MUST begin with this exact sentinel on its own line:
{sentinel}
   Then on the next line, write a brief, polite refusal in the SAME LANGUAGE as the user's question, mentioning what kinds of topics the document does cover.
4. Always answer in the same language as the user's question.
5. Be concise. No filler, no preamble, no headings.
{history_block}
EXCERPTS:
{excerpts}

QUESTION:
{question}
"""


def _format_history(turns: list[dict]) -> str:
    """Render the prior conversation for inclusion in the prompt.

    Strip citation markers from prior assistant answers so the LLM doesn't
    feel compelled to reuse those same page numbers on a new question. We also
    strip the refusal sentinel if it ever made it into stored history.
    """
    if not turns:
        return ""
    lines: list[str] = []
    for t in turns:
        role = (t.get("role") or "").lower()
        content = (t.get("content") or "").strip()
        if not content:
            continue
        if role == "assistant":
            content = _CITATION_RE.sub("", content)
            content = content.replace(REFUSAL_SENTINEL, "").strip()
        if role not in {"user", "assistant"}:
            continue
        label = "USER" if role == "user" else "ASSISTANT"
        lines.append(f"{label}: {content}")
    return "\n".join(lines)


def build_answer_prompt(
    excerpts: str,
    question: str,
    history: list[dict] | None = None,
) -> str:
    history_text = _format_history(history or [])
    if history_text:
        history_block = (
            "\n"
            "PRIOR CONVERSATION (context only — answer ONLY from EXCERPTS, never from this):\n"
            f"{history_text}\n"
        )
    else:
        history_block = ""
    return ANSWER_PROMPT.format(
        sentinel=REFUSAL_SENTINEL,
        history_block=history_block,
        excerpts=excerpts,
        question=question,
    )
