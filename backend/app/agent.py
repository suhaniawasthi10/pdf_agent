"""Two-node LangGraph agent: retrieve → answer."""

import json
import logging
from collections.abc import Iterator
from functools import lru_cache
from typing import Literal, TypedDict

from groq import Groq
from langgraph.graph import END, START, StateGraph

from app.citations import parse_citations
from app.config import settings
from app.prompts import REFUSAL_SENTINEL, build_answer_prompt
from app.vectorstore import get_collection

log = logging.getLogger(__name__)


class RetrievedChunk(TypedDict):
    text: str
    page: int
    score: float
    chunk_id: str


class Citation(TypedDict):
    page: int
    snippet: str
    chunk_id: str


class HistoryTurn(TypedDict):
    role: Literal["user", "assistant"]
    content: str


class State(TypedDict, total=False):
    query: str
    pdf_id: str
    history: list[HistoryTurn]
    retrieved_chunks: list[RetrievedChunk]
    answer: str
    citations: list[Citation]
    route_taken: Literal["answered", "refused"]


# Send at most this many trailing turns to the LLM as context.
_MAX_HISTORY_TURNS = 6  # 3 user + 3 assistant pairs


def retrieve(state: State) -> dict:
    """Embed the query and pull top-k chunks scoped to one pdf_id.

    Returns a partial state update — LangGraph merges it into State.
    """
    query = state["query"]
    pdf_id = state["pdf_id"]

    collection = get_collection()
    result = collection.query(
        query_texts=[query],
        n_results=settings.top_k,
        where={"pdf_id": pdf_id},
    )

    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]
    ids = (result.get("ids") or [[]])[0]

    chunks: list[RetrievedChunk] = [
        {
            "text": doc,
            "page": int(meta.get("page", 0)),
            "score": float(dist),
            "chunk_id": cid,
        }
        for doc, meta, dist, cid in zip(docs, metas, dists, ids)
    ]

    log.info(
        "retrieve pdf_id=%s query=%r hits=%d",
        pdf_id, query[:80], len(chunks),
    )
    return {"retrieved_chunks": chunks}


_groq_client: Groq | None = None


def _get_groq() -> Groq:
    global _groq_client
    if _groq_client is None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not set in environment")
        _groq_client = Groq(api_key=settings.groq_api_key)
    return _groq_client


def _format_excerpts(chunks: list[RetrievedChunk]) -> str:
    return "\n\n".join(f"[Page {c['page']}]\n{c['text']}" for c in chunks)


def answer(state: State) -> dict:
    """Call Groq with retrieved excerpts; classify answered vs refused.

    Returns a partial state update — LangGraph merges it into State.
    """
    query = state["query"]
    chunks = state.get("retrieved_chunks") or []
    history = (state.get("history") or [])[-_MAX_HISTORY_TURNS:]

    if not chunks:
        log.info("answer route=refused reason=no_retrieval")
        return {
            "answer": (
                "I couldn't find anything relevant in this document. "
                "Try asking about a topic the document actually covers."
            ),
            "citations": [],
            "route_taken": "refused",
        }

    prompt = build_answer_prompt(_format_excerpts(chunks), query, history=history)
    completion = _get_groq().chat.completions.create(
        model=settings.answer_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    raw = (completion.choices[0].message.content or "").strip()

    if REFUSAL_SENTINEL in raw:
        cleaned = raw.replace(REFUSAL_SENTINEL, "").strip()
        log.info("answer route=refused")
        return {
            "answer": cleaned or (
                "This question isn't covered by the document."
            ),
            "citations": [],
            "route_taken": "refused",
        }

    citations = parse_citations(raw, chunks)
    log.info("answer route=answered citations=%d", len(citations))
    return {
        "answer": raw,
        "citations": citations,
        "route_taken": "answered",
    }


@lru_cache(maxsize=1)
def get_graph():
    """Compile START → retrieve → answer → END once and cache it."""
    g = StateGraph(State)
    g.add_node("retrieve", retrieve)
    g.add_node("answer", answer)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "answer")
    g.add_edge("answer", END)
    return g.compile()


def run_agent(
    query: str,
    pdf_id: str,
    history: list[HistoryTurn] | None = None,
) -> dict:
    """Synchronous one-shot invocation used by the /chat endpoint."""
    final = get_graph().invoke(
        {"query": query, "pdf_id": pdf_id, "history": history or []}
    )
    return {
        "answer": final.get("answer", ""),
        "citations": final.get("citations", []),
        "route_taken": final.get("route_taken", "answered"),
        "retrieved_chunks": final.get("retrieved_chunks", []),
    }


def _sse(event: str, data: dict) -> bytes:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


def _retrieve_chunks(query: str, pdf_id: str) -> list[RetrievedChunk]:
    collection = get_collection()
    result = collection.query(
        query_texts=[query],
        n_results=settings.top_k,
        where={"pdf_id": pdf_id},
    )
    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]
    ids = (result.get("ids") or [[]])[0]
    return [
        {
            "text": doc,
            "page": int(meta.get("page", 0)),
            "score": float(dist),
            "chunk_id": cid,
        }
        for doc, meta, dist, cid in zip(docs, metas, dists, ids)
    ]


# Hold the first N chars before deciding whether to stream them. The refusal
# sentinel is 26 chars; 64 leaves slack for any leading whitespace.
_STREAM_HOLDOFF = 64


def stream_agent(
    query: str,
    pdf_id: str,
    history: list[HistoryTurn] | None = None,
) -> Iterator[bytes]:
    """SSE generator: emits `meta` once, then `delta` per token, then `done`.

    Buffers the first ~64 characters so we can detect the refusal sentinel
    without leaking it to the user before the cleaned refusal text arrives.
    """
    chunks = _retrieve_chunks(query, pdf_id)
    history = (history or [])[-_MAX_HISTORY_TURNS:]
    log.info(
        "stream retrieve pdf_id=%s query=%r hits=%d turns=%d",
        pdf_id, query[:80], len(chunks), len(history),
    )
    yield _sse("meta", {"retrieved_chunks": chunks})

    if not chunks:
        log.info("stream route=refused reason=no_retrieval")
        yield _sse(
            "done",
            {
                "answer": (
                    "I couldn't find anything relevant in this document. "
                    "Try asking about a topic the document actually covers."
                ),
                "citations": [],
                "route_taken": "refused",
                "retrieved_chunks": chunks,
            },
        )
        return

    prompt = build_answer_prompt(_format_excerpts(chunks), query, history=history)
    completion = _get_groq().chat.completions.create(
        model=settings.answer_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        stream=True,
    )

    raw_parts: list[str] = []
    buffer = ""
    decided = False
    emit = True

    for piece in completion:
        delta = piece.choices[0].delta.content if piece.choices else None
        if not delta:
            continue
        raw_parts.append(delta)
        if decided:
            if emit:
                yield _sse("delta", {"text": delta})
            continue
        buffer += delta
        if len(buffer) >= _STREAM_HOLDOFF:
            if buffer.lstrip().startswith(REFUSAL_SENTINEL):
                emit = False
            else:
                yield _sse("delta", {"text": buffer})
                buffer = ""
                emit = True
            decided = True

    # Stream ended before holdoff: small response. Decide now.
    if not decided and buffer:
        if not buffer.lstrip().startswith(REFUSAL_SENTINEL):
            yield _sse("delta", {"text": buffer})

    raw = "".join(raw_parts).strip()

    if REFUSAL_SENTINEL in raw:
        cleaned = raw.replace(REFUSAL_SENTINEL, "").strip()
        log.info("stream route=refused")
        yield _sse(
            "done",
            {
                "answer": cleaned or "This question isn't covered by the document.",
                "citations": [],
                "route_taken": "refused",
                "retrieved_chunks": chunks,
            },
        )
        return

    citations = parse_citations(raw, chunks)
    log.info("stream route=answered citations=%d", len(citations))
    yield _sse(
        "done",
        {
            "answer": raw,
            "citations": citations,
            "route_taken": "answered",
            "retrieved_chunks": chunks,
        },
    )
