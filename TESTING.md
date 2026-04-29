# Test Instructions for Evaluators

> STAIR × Scaler — Task 3 · PDF-Constrained Conversational Agent

This document is self-contained — every query and expected behavior you need is inline. Follow the 3 steps and the agent is fully exercised against the rubric in ~5 minutes.

---

## Setup (≈ 1 min)

1. **Open the deployed app:** https://pdf-agent-gamma.vercel.app/
2. **Download the sample PDF:** [`backend/tests/sample.pdf`](backend/tests/sample.pdf) — NIST AI Risk Management Framework (NIST AI 100-1, January 2023, ~48 pages, US Government public-domain document). You may also test with any PDF up to 50 MB.
3. **Drag-drop the PDF** into the uploader on the landing page. Wait for status to flip to **ready** (~5–15 seconds for this PDF; first request after a cold deploy can take a bit longer while bge-m3 loads).

After ingestion, the chat opens on the left with the PDF preview on the right. Citation chips in answers click-jump the preview to that page.

---

## Test queries (10 total)

Queries below are calibrated to the NIST AI RMF sample PDF. The framework defines four core functions (`GOVERN`, `MAP`, `MEASURE`, `MANAGE`) and seven characteristics of trustworthy AI.

### A. In-scope queries (5) — agent must answer with citations

| # | Query | Expected behavior |
|---|---|---|
| 1 | What are the four core functions of the AI RMF? | Names `GOVERN`, `MAP`, `MEASURE`, `MANAGE`. Citation around `[p8]` (executive summary / Part 2 intro). |
| 2 | List the characteristics of trustworthy AI defined in this framework. | Lists the seven characteristics (valid/reliable, safe, secure/resilient, accountable/transparent, explainable/interpretable, privacy-enhanced, fair). Multi-page citations like `[p8, p13]`. |
| 3 | How does the framework define accuracy? | Quotes/paraphrases the ISO/IEC TS 5723:2022 definition ("closeness of results … to true values"). Citation `[p19]`. |
| 4 | What does the framework say about risk prioritisation? | Summary of Section 1.2.3 — high-risk systems demand most urgent prioritisation; unacceptable-risk systems should pause development/deployment. Citations around `[p7, p13]`. |
| 5 | Compare the GOVERN and MEASURE functions. | Contrasts policy/culture-setting (GOVERN) with quantitative analysis/tracking (MEASURE). Multi-page citations across Part 2 (e.g. `[p21, p33]`). |

### B. Out-of-scope queries (3) — agent must refuse explicitly

| # | Query | Expected behavior |
|---|---|---|
| 1 | What's the weather in Bangalore today? | Refusal in the amber refusal style; **no citations**. The refusal mentions what the document does cover (AI risk management, trustworthy AI). |
| 2 | Write a Python function for binary search. | Refusal — even though the LLM knows binary search, the document doesn't cover programming. |
| 3 | Who is the current Prime Minister of India? | Refusal — outside the scope of an AI risk-management framework. |

### C. Multilingual queries (2 — bonus criterion)

| # | Query | Expected behavior |
|---|---|---|
| 1 | AI RMF के चार मुख्य फ़ंक्शंस कौन से हैं? *(What are the four main functions of the AI RMF?)* | Hindi answer (Devanagari script) naming GOVERN/MAP/MEASURE/MANAGE with page citations. Demonstrates cross-language retrieval (Hindi query → English chunks → Hindi answer). |
| 2 | क्या इस दस्तावेज़ में क्रिकेट का उल्लेख है? *(Does this document mention cricket?)* | Hindi refusal — cricket is not in scope. Should explain in Hindi what the document does cover. |

---

## What to look for (mapped to rubric)

| Rubric criterion | What the agent does | Where to verify |
|---|---|---|
| **Accuracy of responses relative to source** | Answers paraphrase the actual content of cited pages. | Click any citation chip — preview jumps to that page; the snippet should support the claim. |
| **Robustness against hallucination** | When excerpts don't cover the question, refuses. Doesn't fall back on Llama's general knowledge (queries B-1 and B-2 prove this). | Run B-1 and B-2 — both refuse despite the LLM "knowing" the answer. |
| **Quality of refusal** | Refuses politely, in the question's language, mentioning what the document **does** cover. | Look at refusals from B-1, B-2, B-3, and the Hindi C-2. |
| **Retrieval & grounding quality** | bge-m3 multilingual embeddings + cosine, top-6, `pdf_id`-scoped. Hindi query retrieves English chunks correctly. | Multi-page citations on A-2 and A-5. C-1 retrieving English chunks for a Hindi query proves cross-language grounding. |
| **Observability & testability** | Every `/chat` response includes `route_taken` and `retrieved_chunks` with similarity scores. Network tab shows full responses. | DevTools → Network tab → click a `/chat/stream` request → see `done` SSE event with the full payload. |
| **Bonus — multilingual** | Same vector space, same LLM, no translation step. | C-1 (Hindi answer) and C-2 (Hindi refusal). |

---

## Optional: run the automated test suite

```bash
cd backend
uv venv && source .venv/bin/activate
uv pip install -e '.[test]'
echo "GROQ_API_KEY=gsk_..." > .env   # free at console.groq.com
pytest -v
```

Three end-to-end tests against the real Groq LLM (≤3 LLM calls per run):

1. `test_in_scope_returns_citations` — asserts `route_taken == "answered"` and ≥1 citation
2. `test_out_of_scope_refuses` — asserts `route_taken == "refused"` and citations empty
3. `test_hindi_query_returns_hindi_answer` — asserts the answer contains Devanagari characters

---

## Optional: poke the API directly

```bash
# Upload (returns {pdf_id, status: "processing"})
curl -F "file=@backend/tests/sample.pdf" \
  https://pdfagent-production.up.railway.app/upload

# Wait until status: ready
curl https://pdfagent-production.up.railway.app/pdf/status/<pdf_id>

# Chat
curl -X POST https://pdfagent-production.up.railway.app/chat \
  -H "Content-Type: application/json" \
  -d '{"pdf_id":"<pdf_id>","message":"What are the four core functions?"}'
```

OpenAPI docs: https://pdfagent-production.up.railway.app/docs

---

## Known limitations (so they don't surprise you)

- bge-m3 cold-starts on the first request after a deploy (~10s). Subsequent requests are fast.
- Railway's filesystem is ephemeral on redeploy — Chroma index resets, but re-upload re-indexes in seconds.
- One PDF per browser session; refresh keeps state, switching PDFs requires reset.
- 50 MB upload cap (frontend + backend).
