# PDF-Constrained Conversational Agent — Backend

FastAPI + 2-node LangGraph (`retrieve → answer`) on top of ChromaDB and
Groq Llama 3.3 70B with `bge-m3` multilingual embeddings.

See the project root `req.md` for the full spec.

## Setup

```
cd backend
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env       # then add GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Get a free Groq API key from [console.groq.com](https://console.groq.com).

## `.env`

```
GROQ_API_KEY=gsk_...
EMBEDDING_MODEL=BAAI/bge-m3
CHROMA_DIR=./data/chroma
ANSWER_MODEL=llama-3.3-70b-versatile
TOP_K=6
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe. |
| `GET` | `/info` | Reports the configured embedding model, answer model, and `top_k`. |
| `POST` | `/upload` | Multipart PDF upload. Validates `.pdf` suffix + `%PDF-` magic bytes + 50 MB cap, then kicks off ingestion in `BackgroundTasks` and returns `{pdf_id, status: "processing"}`. |
| `GET` | `/pdf/status/{pdf_id}` | Returns `processing` / `ready` / `failed`. |
| `GET` | `/pdf/file/{pdf_id}` | Returns the raw PDF bytes (used by the in-app preview). |
| `POST` | `/chat` | Body `{pdf_id, message, history?}` → `{answer, citations, route_taken, retrieved_chunks}`. |
| `POST` | `/chat/stream` | Same body as `/chat`. Returns Server-Sent Events: `meta` (retrieved chunks), `delta` (token), `done` (final payload). Used by the frontend. |

OpenAPI docs auto-served at `http://localhost:8000/docs`.

## Smoke test

```
# Upload
curl -F "file=@tests/sample.pdf" http://localhost:8000/upload
# → {"pdf_id":"abc-123","status":"processing"}

# Wait until status: ready
curl http://localhost:8000/pdf/status/abc-123

# Chat
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"pdf_id":"abc-123","message":"What causes ocean tides?"}'
```

## Tests

```
pip install -e '.[test]'
pytest -v
```

Three real-LLM end-to-end tests live in `tests/test_agent.py`. Manual evaluation
queries (5 in-scope + 3 out-of-scope + 2 multilingual) are documented in
`tests/EVALUATION.md`.

## Layout

```
app/
  main.py          FastAPI app + 5 endpoints
  config.py        pydantic-settings
  ingestion.py     PyMuPDF extract → chunk → embed → Chroma
  vectorstore.py   ChromaDB collection wired with bge-m3
  agent.py         LangGraph: START → retrieve → answer → END
  prompts.py       The single strict grounding prompt
  citations.py     Parse [p<n>] markers into structured citations
tests/
  sample.pdf       Tiny 3-page test document
  conftest.py      Session-scoped ingestion fixture
  test_agent.py    3 end-to-end tests
  EVALUATION.md    Manual evaluation queries
```
