# PDF-Constrained Conversational Agent

> STAIR x Scaler — Task 3

Chat with any PDF. The agent answers strictly from the document, cites every claim with page numbers, and refuses out-of-scope questions in the user's language. Tested in English and Hindi.

---

## Live demo

| | URL |
|---|---|
| Frontend (Vercel) | https://pdf-agent-gamma.vercel.app/ |
| Backend (Railway) | https://pdfagent-production.up.railway.app |
| Health check | https://pdfagent-production.up.railway.app/health |

> If the backend cold-starts, the first PDF upload may take ~10s while the bge-m3 embedder loads.

---

## Test instructions for evaluators (5 minutes)

1. Open the **frontend URL** above.
2. Download the sample PDF: [`backend/tests/sample.pdf`](backend/tests/sample.pdf) — NIST AI Risk Management Framework, 48 pages, public domain. (Or use any PDF up to 50 MB.)
3. Drag-drop it into the uploader. Wait for status `ready`.
4. Run the 8 documented queries from [`backend/tests/EVALUATION.md`](backend/tests/EVALUATION.md):
   - **5 in-scope** → expect grounded answers with `[p<n>]` citations; clicking a citation jumps the PDF preview to that page.
   - **3 out-of-scope** → expect explicit refusals styled in amber, no citations.
   - **2 multilingual (Hindi)** → expect Hindi answers with page citations (cross-language retrieval).

`EVALUATION.md` lists each query and the exact expected behavior, calibrated to the sample PDF's content.

---

## Architecture

```
Upload                                  Chat
─────                                   ────
PDF                                     User question
  │                                       │
  ▼                                       ▼
PyMuPDF (per-page text)                 ┌────────────┐
  │                                     │  retrieve  │  embed query → top-6 chunks
  ▼                                     │   (Chroma) │  filtered by pdf_id
RecursiveCharacterTextSplitter           └─────┬──────┘
(800 chars, 100 overlap)                       │
  │                                            ▼
  ▼                                     ┌────────────┐
bge-m3 embeddings                       │   answer   │  strict prompt → Groq
  │                                     │   (Groq)   │  Llama 3.3 70B
  ▼                                     └─────┬──────┘
ChromaDB                                      │
{pdf_id, page, chunk_index}                   ▼
                                        {answer, citations[],
                                         route_taken, retrieved_chunks[]}
```

**Two-node LangGraph: `retrieve → answer`.** Linear, no branches. The strict answer prompt enforces grounding and emits either `[p<n>]` citation markers or a `THIS_IS_NOT_IN_THE_DOCUMENT` sentinel. Post-processing parses citations or routes to refusal. Both `/chat` (JSON) and `/chat/stream` (SSE) are exposed.

Full technical note with every decision and trade-off: [`req.md`](req.md).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI + LangGraph | Async + auto OpenAPI docs; LangGraph makes the 2 nodes inspectable. |
| LLM | Groq `llama-3.3-70b-versatile` | Free tier, sub-second latency, strong instruction following. |
| Embeddings | `BAAI/bge-m3` | Multilingual (100+ langs, incl. Hindi); same vector space across languages. |
| Vector DB | ChromaDB (persistent, cosine) | Zero-config, metadata filter by `pdf_id`. |
| PDF parsing | PyMuPDF | Best page-number fidelity. |
| Frontend | React + Vite + Tailwind + react-pdf | Click-to-jump citations. |
| Deploy | Railway (backend) + Vercel (frontend) | Free tiers cover the demo. |

---

## Key decisions & trade-offs

- **Two nodes, not six.** A query classifier or relevance grader doesn't move the rubric — the strict prompt handles grounding and refusals natively. Fewer nodes = clearer observability.
- **Refusal via sentinel, not a second LLM call.** `THIS_IS_NOT_IN_THE_DOCUMENT` token in the LLM output → post-process into `refused` route. Zero extra latency or cost.
- **No translation step.** bge-m3 + Llama 3.3 70B are both multilingual; the prompt instructs the LLM to answer in the question's language.
- **In-memory PDF status.** No DB; one PDF per browser session. Refresh = re-upload. Backend has a Chroma-rehydration fallback so warm restarts don't break in-progress sessions.
- **`temperature=0.1`** on the answer call — stability over creativity, since the rubric grades determinism and grounding.

---

## Run locally

**Backend** (Python 3.10+):

```bash
cd backend
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env          # then add your GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Get a free Groq API key at [console.groq.com](https://console.groq.com) — no credit card required.

**Frontend**:

```bash
cd frontend
pnpm install
pnpm dev                      # http://localhost:5173
```

Frontend reads `VITE_API_URL` (defaults to `http://localhost:8000`).

---

## Tests

```bash
cd backend
pip install -e '.[test]'
pytest -v
```

Three end-to-end tests, real Groq calls (≤3 LLM calls per run, fits Groq's free-tier rate limits):

1. `test_in_scope_returns_citations` — asserts `route_taken == "answered"` and ≥1 citation
2. `test_out_of_scope_refuses` — asserts `route_taken == "refused"` and citations empty
3. `test_hindi_query_returns_hindi_answer` — asserts the answer contains Devanagari characters

Manual evaluation queries: [`backend/tests/EVALUATION.md`](backend/tests/EVALUATION.md).

---

## Observability

Every `/chat` response is fully introspectable:

```json
{
  "answer": "…",
  "citations": [{"page": 8, "snippet": "…", "chunk_id": "…"}],
  "route_taken": "answered",
  "retrieved_chunks": [{"text": "…", "page": 8, "score": 0.41, "chunk_id": "…"}, …]
}
```

Server logs every node entry/exit with `pdf_id`, query prefix, hit count, and route taken — visible in Railway's deployment logs.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe (used by Railway). |
| `GET` | `/info` | Reports configured embedding/answer model and `top_k`. |
| `POST` | `/upload` | Multipart PDF (validated via `.pdf` suffix + `%PDF-` magic + 50 MB cap). Returns `{pdf_id, status: "processing"}`. |
| `GET` | `/pdf/status/{pdf_id}` | `processing` / `ready` / `failed`. |
| `GET` | `/pdf/file/{pdf_id}` | Raw PDF bytes (used by the in-app preview). |
| `POST` | `/chat` | `{pdf_id, message, history?}` → JSON response above. |
| `POST` | `/chat/stream` | Same body, SSE stream (`meta` → `delta`s → `done`). |

OpenAPI docs auto-served at `/docs`.

---

## Known limitations

- Railway's filesystem is ephemeral on redeploy — Chroma index resets, re-upload to re-index. (A persistent volume can be mounted, but it's optional for the demo.)
- bge-m3 cold-starts on the first request after a deploy (~10s).
- One PDF per browser session; refresh keeps state, switching PDFs requires reset.
- 50 MB upload cap (frontend + backend).

---

## Repo layout

```
backend/
  app/                  # 6 Python files: main, config, ingestion, vectorstore, agent, prompts, citations
  tests/                # sample.pdf, EVALUATION.md, conftest.py, test_agent.py
  Procfile, railway.toml
frontend/
  src/                  # App.tsx, api.ts, components/{ChatWindow,Message,CitationChip,PdfPreview,…}
  vite.config.ts
req.md                  # Full technical note (architecture, every decision)
README.md               # This file
```
