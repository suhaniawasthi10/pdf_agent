# Technical Note — PDF-Constrained Conversational Agent

> STAIR × Scaler — Task 3 · Suhani Awasthi

## What it does

User uploads a PDF, then chats with it. Every answer is grounded in retrieved excerpts from that PDF and tagged with `[p<n>]` page citations the user can click to jump to in the in-app PDF preview. Out-of-scope questions are refused explicitly, in the user's language. Tested in English and Hindi.

## Architecture

```
Upload pipeline                         Chat pipeline (per turn)
───────────────                         ───────────────────────
PDF                                     User question
  │                                       │
  ▼                                       ▼
PyMuPDF — extract text per page         ┌────────────┐
  │                                     │  retrieve  │  embed query → top-6 chunks
  ▼                                     │   (Chroma) │  filtered by pdf_id
RecursiveCharacterTextSplitter          └─────┬──────┘
(800 chars, 100 overlap)                      │
  │                                           ▼
  ▼                                     ┌────────────┐
bge-m3 embeddings (multilingual)        │   answer   │  strict prompt → Groq
  │                                     │   (Groq)   │  Llama 3.3 70B, T=0.1
  ▼                                     └─────┬──────┘
ChromaDB (cosine, persistent)                 │
metadata = {pdf_id, page, chunk_index}        ▼
                                        post-process: parse [p<n>] OR
                                        detect refusal sentinel
                                              │
                                              ▼
                                        { answer, citations[],
                                          route_taken, retrieved_chunks[] }
```

The agent is a 2-node LangGraph: `START → retrieve → answer → END`. Linear, no branches.

## How grounding is enforced

A single strict answer prompt does the entire grounding job:

1. The LLM may use **only** information from the retrieved excerpts. No outside knowledge.
2. Every factual claim must end with `[p<page>]` (or `[p3, p7]` for multi-page facts).
3. If the excerpts don't answer the question, the LLM must begin its reply with the exact sentinel `THIS_IS_NOT_IN_THE_DOCUMENT` followed by a polite refusal in the user's language.
4. Always answer in the same language as the question.

Post-processing does the rest: if the sentinel is in the response → strip it, set `route_taken = "refused"`, return zero citations. Otherwise → regex `[p<n>]` markers, back each cited page with the best-scoring retrieved chunk on that page, return as structured citations.

## Key decisions & trade-offs

| Decision | Why | Trade-off accepted |
|---|---|---|
| **Two nodes, not six.** | A query classifier + relevance grader doesn't move the rubric — Llama 3.3 70B with a strict prompt handles refusals natively. | No automatic re-query on weak retrieval. Acceptable: top-6 with bge-m3 has been reliable. |
| **Refusal via sentinel, not a second LLM call.** | Zero added latency or cost; one prompt, one call. | Depends on the LLM emitting the sentinel correctly. Llama 3.3 70B is reliable here; tested with the 3 OOS queries. |
| **bge-m3 multilingual embeddings (local).** | One embedder for English + Hindi + 100 langs in the same vector space. Hindi query retrieves English chunks correctly. | First request after deploy cold-starts the model (~10s). |
| **Groq Llama 3.3 70B.** | Free tier, sub-second latency, strong instruction-following → consistent citation formatting. | Free tier rate limits; production would move to Anthropic/OpenAI. |
| **No translation step.** | Both embedder and LLM are multilingual; the prompt enforces "answer in the user's language". | None observed across English/Hindi tests. |
| **In-memory PDF status, no DB.** | One PDF per browser session is enough for this rubric; refresh = re-upload. | Status forgets across server restarts. Mitigated by a Chroma-rehydration fallback that reconstructs `ready` status from disk + collection contents. |
| **`temperature=0.1`.** | The rubric grades determinism; near-greedy decoding stabilizes citation formatting and refusal phrasing. | Slight loss of variety; not a goal here. |
| **Streaming (SSE) endpoint.** | Better perceived latency for long answers. | Refusal sentinel handling required a 64-char buffer before deciding whether to forward tokens — implemented in `stream_agent`. |
| **Local Chroma volume.** | Zero-config, persistent across uvicorn reloads. | Ephemeral on Railway redeploy unless a volume is mounted; acceptable since reindexing one PDF takes seconds. |

## Tech stack

| Layer | Choice |
|---|---|
| Backend framework | FastAPI |
| Agent framework | LangGraph (2 nodes) |
| LLM | Groq `llama-3.3-70b-versatile` |
| Embeddings | `BAAI/bge-m3` via sentence-transformers (local) |
| Vector DB | ChromaDB (persistent client, cosine space) |
| PDF parsing | PyMuPDF |
| Frontend | React + Vite + TypeScript + Tailwind + react-pdf |
| Deploy | Railway (backend) + Vercel (frontend) |

## Observability

Every `/chat` response is fully introspectable — the API returns `answer`, `citations[]`, `route_taken`, **and** the full `retrieved_chunks[]` (text + page + similarity score + chunk_id). The streaming endpoint emits the same data over SSE: `meta` (retrieved chunks) → `delta` (token) → `done` (final payload).

Server logs every node entry/exit with `pdf_id`, query prefix, hit count, and route taken — visible in Railway's deployment logs.

## What's intentionally out of scope

Postgres / SQLite / Alembic; sessions; multi-PDF; multi-conversation; auth. These don't move the Task 3 rubric. The system is designed for one PDF, one chat session, one evaluator at a time.

## Repository

```
backend/
  app/
    main.py          # FastAPI: /health /info /upload /pdf/status /pdf/file /chat /chat/stream
    config.py        # pydantic-settings
    ingestion.py     # PyMuPDF → split → embed → Chroma (runs in BackgroundTasks)
    vectorstore.py   # ChromaDB collection wired with bge-m3 at creation time
    agent.py         # LangGraph: retrieve → answer; sync + streaming variants
    prompts.py       # The single strict grounding prompt + sentinel
    citations.py     # [p<n>] regex → structured citations backed by best-scoring chunk
  tests/
    sample.pdf       # NIST AI RMF (48p, public domain)
    EVALUATION.md    # 5 valid + 3 OOS + 2 multilingual queries with expected behavior
    test_agent.py    # 3 real-LLM end-to-end tests
frontend/
  src/
    App.tsx          # Split-pane: chat ↔ PDF preview
    api.ts           # axios + SSE client
    components/      # ChatWindow, Message, CitationChip, PdfPreview, Landing, Header
README.md            # Project landing
TECHNICAL_NOTE.md    # This file
TESTING.md           # Evaluator script
req.md               # Full internal spec (extended technical note)
```
