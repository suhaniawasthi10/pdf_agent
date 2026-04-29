# PDF-Constrained Conversational Agent — Minimal Spec

**Project:** STAIR x Scaler — Task 3
**Stack:** FastAPI · React/TypeScript · LangGraph (2 nodes) · ChromaDB · Groq (Llama 3.3 70B) · bge-m3 embeddings
**Build time:** ~2 days
**Goal:** Hit every rubric point. Nothing extra.

---

## 1. What This Project Does (in one paragraph)

User uploads a PDF. The system extracts text page-by-page, chunks it, embeds the chunks with a multilingual model, and stores them in ChromaDB. User then chats with the PDF. Every question goes through a 2-node agent: **retrieve** the most relevant chunks, then **answer** them — strictly grounded in the PDF, with page citations, refusing politely if the answer isn't there. Works in English, Hindi, and any language the embedding model and LLM both support.

---

## 2. Why 2 Nodes (Not 1, Not 6)

**Why not 1 node:** A single function doing retrieval + LLM call is fine, but you lose the explicit `retrieve → answer` separation that makes the agent inspectable. The rubric explicitly grades "retrieval and grounding quality" — having retrieval as its own visible step makes it easy to demo and test.

**Why not 6 nodes:** Classifying greetings, grading retrieval relevance, separate refuse paths — these are nice-to-haves that don't score marks on this rubric. A well-prompted Llama 3.3 70B handles refusals natively when given a strict prompt.

**The 2 nodes:**
1. `retrieve` — embed the query, pull top-k chunks from ChromaDB filtered by `pdf_id`.
2. `answer` — send chunks + query to the LLM with a strict prompt that either answers with `[p<n>]` citations or refuses explicitly.

That's the entire agent. Observable, testable, minimal.

---

## 3. End-to-End Flow

### Upload
```
PDF file
   ↓
PyMuPDF extracts text per page (preserves page numbers)
   ↓
Detect document language (langdetect, used for metadata only)
   ↓
Split into chunks (~800 chars each, 100 char overlap)
   ↓
Embed chunks with bge-m3 (multilingual, runs locally)
   ↓
Store in ChromaDB with metadata: {pdf_id, page, chunk_index}
```

### Chat
```
User question
   ↓
[Node 1] retrieve
   - Embed query
   - ChromaDB top-6 chunks where pdf_id = current PDF
   ↓
[Node 2] answer
   - Build prompt: chunks (with page tags) + question + strict rules
   - Call Groq Llama 3.3 70B
   - Parse [p<n>] markers from response → structured citations
   ↓
Return: { answer, citations, route_taken: "answered" | "refused" }
```

`route_taken` is set by post-processing the LLM's output — if the response contains the refusal sentinel string, mark `refused`; otherwise `answered`. Free observability with no extra LLM calls.

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI | Standard, async, free OpenAPI docs at `/docs`. |
| Agent framework | LangGraph (2 nodes) | Explicit graph = observable, testable. Rubric requirement. |
| LLM | Groq + `llama-3.3-70b-versatile` | Free tier, ultra-fast, OpenAI-compatible API. Strong instruction following for citations and refusals. |
| Embeddings | `BAAI/bge-m3` (local via sentence-transformers) | Free, multilingual (covers English, Hindi, 100+ langs) → bonus criterion satisfied. |
| Vector DB | ChromaDB (local persistence) | Zero-config, supports metadata filtering by `pdf_id`. |
| PDF parsing | PyMuPDF | Best page-number fidelity. |
| Storage | Local filesystem | One PDF, one session — no DB needed. |
| Lang detection | `langdetect` | For tagging the PDF's primary language. |
| Frontend | React + Vite + TypeScript + Tailwind | Standard. |
| PDF preview | `react-pdf` | For citation click-to-jump. |
| HTTP client | `axios` | Standard. |

**Not used (intentionally):** Postgres, SQLite, Alembic, sessions, streaming, multi-PDF, multi-conversation, authentication. Conversation lives in browser memory only — refresh = new chat. That's fine for a demo.

---

## 5. Project Structure

```
pdf-agent/
├── backend/
│   ├── pyproject.toml
│   ├── .env.example
│   ├── app/
│   │   ├── main.py              # FastAPI app, 3 endpoints
│   │   ├── config.py            # pydantic-settings
│   │   ├── ingestion.py         # extract + chunk + embed + store
│   │   ├── vectorstore.py       # ChromaDB client + bge-m3 wiring
│   │   ├── agent.py             # LangGraph: retrieve + answer nodes
│   │   ├── prompts.py           # the single strict prompt
│   │   └── citations.py         # parse [p<n>] markers
│   ├── data/                    # gitignored
│   │   ├── chroma/
│   │   └── uploads/
│   ├── tests/
│   │   ├── sample.pdf
│   │   ├── test_agent.py
│   │   └── EVALUATION.md
│   └── README.md
└── frontend/
    ├── package.json
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api.ts               # upload + chat
    │   ├── components/
    │   │   ├── Uploader.tsx
    │   │   ├── ChatWindow.tsx
    │   │   ├── Message.tsx
    │   │   ├── CitationChip.tsx
    │   │   └── PdfPreview.tsx
    │   └── styles.css
    └── public/
```

Six Python files in the backend. Five components in the frontend. That's the whole project.

---

## 6. Backend — How Each Piece Works

### 6.1 Ingestion (`app/ingestion.py`)

Three steps, executed once per PDF upload:

**Step 1 — Extract text per page using PyMuPDF.** For each page in the PDF, grab its text and store it alongside its page number. Skip empty pages. Output: a list of `{page, text}` dicts.

**Step 2 — Chunk each page's text.** Use `RecursiveCharacterTextSplitter` from LangChain with a chunk size of 800 characters (~200 tokens English, ~120 tokens Hindi) and 100 character overlap. Each chunk inherits the page number of the page it came from. The page number metadata is the entire backbone of citations — without it, you cannot cite.

**Step 3 — Embed and store.** Send all chunks to ChromaDB. ChromaDB itself runs the bge-m3 embedder on each chunk (configured at collection creation time). Store metadata `{pdf_id, page, chunk_index}` alongside each chunk so we can later filter retrieval by PDF and reconstruct citations.

This entire function is **synchronous** and runs in FastAPI's `BackgroundTasks` so the upload endpoint returns immediately while ingestion finishes in the background.

### 6.2 Vector Store (`app/vectorstore.py`)

A single Chroma collection called `pdf_chunks`. The bge-m3 embedder is wired in **at collection creation** via `embedding_function=...` — without this explicit wiring, Chroma silently uses its default MiniLM embedder, which would store one kind of vector and search with another, breaking retrieval.

The collection has `hnsw:space: cosine` set so similarity is cosine-based, which is what bge-m3 is trained for.

### 6.3 The Agent (`app/agent.py`)

**State:**
```
{
  query: str
  pdf_id: str
  retrieved_chunks: list[{text, page, score}]
  answer: str
  citations: list[{page, snippet}]
  route_taken: "answered" | "refused"
}
```

**Node 1 — `retrieve`:**
Take the query, run ChromaDB's `query()` with `n_results=6` and `where={"pdf_id": state.pdf_id}`. Return chunks with their distance scores attached. If retrieval returns nothing (e.g. empty PDF), set `retrieved_chunks=[]` — the answer node will handle this gracefully.

**Node 2 — `answer`:**
Build a prompt that contains the retrieved chunks (each prefixed with `[Page <n>]`) plus the user's question plus strict formatting rules. Call Groq Llama 3.3 70B with this prompt. The LLM produces a response that either contains `[p<n>]` markers (an answer) or contains the exact refusal sentinel `THIS_IS_NOT_IN_THE_DOCUMENT` followed by a friendly explanation in the user's language.

After the LLM returns:
- If the response contains the sentinel → `route_taken = "refused"`, strip the sentinel from the visible text.
- Otherwise → `route_taken = "answered"`, parse `[p<n>]` markers into structured citations.

**Graph wiring:** `START → retrieve → answer → END`. Linear, no branches. LangGraph still gives you observability per node (every node logs entry/exit and state diff), which is what the rubric grades.

### 6.4 The Single Strict Prompt (`app/prompts.py`)

The entire grounding behavior comes from one carefully written prompt. The LLM is told:

1. You may **only** use information from the excerpts below.
2. After every factual claim, append `[p<page>]` citing the page the fact came from.
3. If the excerpts do not contain the answer, respond with exactly: `THIS_IS_NOT_IN_THE_DOCUMENT` followed by a brief, polite refusal in the user's language explaining what kinds of questions the document *does* cover.
4. Answer in the same language as the question.
5. Be concise. No filler.

The sentinel `THIS_IS_NOT_IN_THE_DOCUMENT` is a string the user will never accidentally write — it's our reliable signal for refusal detection. We strip it before showing the response to the user; it's purely an internal route marker.

### 6.5 Citation Parsing (`app/citations.py`)

After the answer comes back, regex out every `[p<n>]` (also handling multi-page like `[p3, p7]`). For each cited page, find the **best-scoring chunk** from that page in the retrieved set (lowest distance = most relevant) and use the first 240 characters of its text as the citation snippet. Return a list of `{page, snippet, chunk_id}` for the frontend to render as clickable chips.

### 6.6 API Endpoints (`app/main.py`)

Three endpoints. That's all.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Returns `{status: "ok"}`. Used by Railway for liveness probes. |
| `POST` | `/upload` | Accepts a PDF file. Saves it, kicks off ingestion via BackgroundTasks, returns `{pdf_id, status: "processing"}`. Frontend polls until `status: "ready"`. |
| `GET` | `/pdf/status/{pdf_id}` | Returns ingestion status: `processing`, `ready`, or `failed`. |
| `POST` | `/chat` | Body: `{pdf_id, message}`. Runs the agent, returns `{answer, citations, route_taken}`. |
| `GET` | `/pdf/file/{pdf_id}` | Returns the raw PDF for the in-app preview. |

Status is tracked in a tiny **in-memory dict** keyed by `pdf_id`. No database. If the server restarts, you re-upload. That's acceptable for an evaluation.

---

## 7. Frontend — How Each Piece Works

### 7.1 The whole UI is one page

Top half: the chat. Bottom half (or right drawer): the PDF preview. No routing, no dashboard, no conversation list. The user uploads, then chats. Refresh = start over.

### 7.2 Components

**`Uploader.tsx`** — file input. On select, POST to `/upload`, get back `pdf_id`, then poll `/pdf/status/{pdf_id}` every 1.5 seconds until status is `ready`. Show a "Processing..." spinner during ingestion.

**`ChatWindow.tsx`** — array of messages in component state. Input box at the bottom. On send, POST to `/chat` with `{pdf_id, message}`, append user message immediately, append the assistant's response when it returns. No streaming — the full answer arrives at once. Llama on Groq is fast enough that this feels snappy.

**`Message.tsx`** — renders an assistant message. Parses `[p<n>]` markers in the text and replaces each with a `<CitationChip page={n} />` component. Below the message, shows a "Sources:" line listing all unique cited pages.

**`CitationChip.tsx`** — small clickable pill showing "p3". On click, scrolls the PDF preview to page 3.

**`PdfPreview.tsx`** — uses `react-pdf` to render the PDF inline. Has a `currentPage` state controlled by citation clicks.

### 7.3 State management

Plain React `useState`. That's it. No TanStack Query, no Zustand. The state model is:
- Current `pdf_id` (or null if nothing uploaded)
- Array of `messages: [{role, content, citations?}]`
- `currentPage` for the PDF viewer

Three useState hooks, all inside `App.tsx`.

---

## 8. Multi-Language (the Bonus)

Three things make multi-language work for free:

1. **bge-m3 embeddings** create a shared multilingual vector space — a Hindi query retrieves English chunks correctly because their meanings live in the same vector space.
2. **Llama 3.3 70B** is multilingual — it answers in the language of the question.
3. **Page-number citations are language-agnostic** — `[p3]` works regardless of what language the PDF or query is in.

The prompt explicitly tells the LLM to answer in the user's language. No translation step needed.

**Test cases for multi-lang:**
- English PDF + Hindi question → Hindi answer with English snippets in citations.
- Hindi PDF + English question → English answer with Hindi snippets.
- Hindi PDF + Hindi question → fully Hindi answer.

All three should produce grounded, cited responses.

---

## 9. Testability — What to Ship

The rubric requires this. Build these alongside the code, not after.

### `tests/sample.pdf`
A real public-domain document, ~15-25 pages. Suggested: a recent research paper or a well-structured government report. Pick something where out-of-scope is obvious.

### `tests/EVALUATION.md`

**5 valid queries** with expected behavior:

| # | Query | Expected behavior |
|---|---|---|
| 1 | "What is the main topic of this document?" | Concise summary, cited from the intro/abstract pages. |
| 2 | "What methodology does the document describe?" | Methodology paragraph with citations to the relevant section. |
| 3 | "What are the key findings or conclusions?" | Summary of conclusions with citations. |
| 4 | A specific factual question whose answer is on a known page (e.g., "What dataset was used?") | Answers with citation pointing to that exact page. |
| 5 | A multi-page question (e.g., "Summarize the limitations mentioned") | Multi-page citations, e.g. `[p7, p12]`. |

**3 out-of-scope queries** with expected behavior:

| # | Query | Expected behavior |
|---|---|---|
| 1 | "What's the weather in Bangalore today?" | Refusal: explains this isn't in the document. |
| 2 | "Write a Python script for binary search." | Refusal: even though the LLM knows it, the document doesn't. |
| 3 | "Who is the prime minister of India?" | Refusal. |

**Multi-language tests (bonus):**
- Ask query #1 in Hindi → expect Hindi answer with citations.
- Ask query #5 in Hindi → expect Hindi multi-page answer.

### `tests/test_agent.py` — minimal automated tests

Three tests, that's enough:
1. `test_in_scope_returns_citations` — ask a known-good question, assert `route_taken == "answered"` and at least one citation is returned.
2. `test_out_of_scope_refuses` — ask "what's the weather", assert `route_taken == "refused"` and citations list is empty.
3. `test_hindi_query_returns_hindi_answer` — ask in Hindi, assert response contains Devanagari characters.

These tests will run against a pre-ingested sample PDF. Don't bother mocking — actually call the real agent with the real LLM. Slow but truthful.

---

## 10. Setup & Run

### Backend

```
cd backend
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env       # add GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend

```
cd frontend
pnpm install
pnpm dev                   # http://localhost:5173
```

### `.env`

```
GROQ_API_KEY=gsk_...
EMBEDDING_MODEL=BAAI/bge-m3
CHROMA_DIR=./data/chroma
ANSWER_MODEL=llama-3.3-70b-versatile
TOP_K=6
```

Get a free Groq API key from console.groq.com — no credit card needed.

### Smoke test

```
# Upload
curl -F "file=@tests/sample.pdf" http://localhost:8000/upload
# → {"pdf_id": "abc-123", "status": "processing"}

# Wait until status: ready
curl http://localhost:8000/pdf/status/abc-123

# Chat
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"pdf_id":"abc-123","message":"What is this document about?"}'
```

---

## 11. Mapping Spec → Rubric

| Rubric criterion | How we satisfy it |
|---|---|
| Accuracy of responses relative to source | Strict citation prompt + retrieval scoped to `pdf_id` + page-tagged chunks. |
| Robustness against hallucination | Prompt forbids outside knowledge; retrieval-only context; refusal sentinel for missing info. |
| Quality of refusal | Dedicated sentinel-based refusal path; LLM explains in user's language what the document *does* cover. |
| Retrieval and grounding quality | bge-m3 multilingual embeddings, top-6 retrieval, cosine similarity, metadata-filtered by PDF. |
| Citations | Every claim cited as `[p<n>]`; backend parses into structured citations; frontend renders as clickable chips. |
| Multi-language (bonus) | Multilingual embeddings + multilingual LLM + language-aware prompt. |
| Testability | Sample PDF + 5 valid + 3 invalid queries documented in `EVALUATION.md`; automated test file. |

---

## 12. Demo Video Outline (3 minutes)

1. **Upload** (15 sec) — drag PDF, show "processing" → "ready".
2. **In-scope answer** (45 sec) — ask a content question, show answer with citations, click a chip → PDF jumps to that page.
3. **Out-of-scope refusal** (30 sec) — ask "what's the weather", show explicit refusal.
4. **Multi-language** (45 sec) — ask the same content question in Hindi, show Hindi answer with English-snippet citations.
5. **Logs** (15 sec) — show terminal logs proving the agent's `retrieve` and `answer` nodes ran, with chunk scores visible.
6. **EVALUATION.md walkthrough** (15 sec) — point at the file showing all 8 documented test queries.

---

## 13. Build Order

Do these in order. Each step is independently testable.

1. **Backend skeleton** — FastAPI app + `/health` endpoint. `uvicorn` runs.
2. **Ingestion** — upload endpoint + extractor + chunker + ChromaDB write. Test by uploading sample.pdf and inspecting Chroma directly.
3. **Retrieval node** — given a `pdf_id` and query, return top-6 chunks. Test in a Python REPL.
4. **Answer node** — given chunks + query, call Groq, parse output. Test refusal vs answer paths in REPL.
5. **LangGraph wiring** — connect retrieve → answer. One full call works end to end.
6. **`/chat` endpoint** — wraps the graph, returns JSON.
7. **Frontend skeleton** — Vite app, Tailwind set up, single page.
8. **Uploader + status polling** — uploads, shows ready state.
9. **Chat window** — sends messages, displays responses.
10. **Citation chips + PDF preview** — click-to-jump works.
11. **EVALUATION.md + automated tests** — write the 8 queries, run the 3 tests.
12. **README + demo video**.

Roughly: backend = 1 day, frontend = ½ day, polish + tests + video = ½ day. Total ~2 days.

---

## TL;DR

Two-node LangGraph (`retrieve → answer`) on top of FastAPI + ChromaDB + Groq Llama 3.3 70B. One PDF, one chat session, no DB. Strict prompt enforces grounding, citations, and refusals — no separate classifier or grader needed. Multi-language works because bge-m3 and Llama are both multilingual. Six Python files, five React components, two days of work, every rubric point covered.