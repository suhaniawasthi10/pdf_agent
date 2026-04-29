# Evaluation — PDF-Constrained Conversational Agent

These queries are run against `tests/sample.pdf`, the **NIST AI Risk Management
Framework (AI RMF 1.0)** — `NIST AI 100-1`, January 2023, ~48 pages.
Public domain (US Government work). Direct source:
https://nvlpubs.nist.gov/nistpubs/AI/NIST.AI.100-1.pdf

The framework defines:
- Four **Core functions** organizations apply to manage AI risks: `GOVERN`, `MAP`, `MEASURE`, `MANAGE` (introduced p.8, detailed in Part 2 from p.21 onward).
- Seven **characteristics of trustworthy AI**: *valid and reliable, safe, secure and resilient, accountable and transparent, explainable and interpretable, privacy-enhanced, fair with harmful biases managed* (p.8, expanded pp.13–20).
- **Risk** as a composite measure of an event's probability and magnitude (p.4).
- **Accuracy** per ISO/IEC TS 5723:2022 (p.19).

Queries below are calibrated to that content. Update this file if you swap
`sample.pdf` for a different document.

---

## In-scope queries (5)

| # | Query | Expected behavior |
|---|---|---|
| 1 | "What are the four core functions of the AI RMF?" | Names `GOVERN`, `MAP`, `MEASURE`, `MANAGE`. Citations to the executive summary / Part 2 introduction (around `[p8]`). |
| 2 | "List the characteristics of trustworthy AI defined in this framework." | Lists the seven characteristics (valid/reliable, safe, secure/resilient, accountable/transparent, explainable/interpretable, privacy-enhanced, fair). Multi-page citation likely (`[p8, p13]` or similar). |
| 3 | "How does the framework define accuracy?" | Quotes/paraphrases the ISO/IEC TS 5723:2022 definition ("closeness of results … to the true values"). Cited to `[p19]`. |
| 4 | "What does the framework say about risk prioritisation?" | Summary of Section 1.2.3 — high-risk systems demand most urgent prioritisation; unacceptable-risk systems should pause development/deployment. Citations around `[p7, p13]`. |
| 5 | "Compare the GOVERN and MEASURE functions." | Contrasts policy/culture-setting (GOVERN) with quantitative analysis/tracking (MEASURE). Multi-page citations across Part 2 (e.g. `[p21, p33]`). |

## Out-of-scope queries (3)

| # | Query | Expected behavior |
|---|---|---|
| 1 | "What's the weather in Bangalore today?" | Refusal — bubble in the amber refusal style; no citations. The refusal should mention what the document does cover (AI risk management, trustworthy AI). |
| 2 | "Write a Python function for binary search." | Refusal — even though the LLM knows binary search, the document doesn't cover programming. |
| 3 | "Who is the current Prime Minister of India?" | Refusal — outside the scope of an AI risk-management framework. |

## Multi-language queries (bonus, 2)

| # | Query | Expected behavior |
|---|---|---|
| 1 | "AI RMF के चार मुख्य फ़ंक्शंस कौन से हैं?" *(What are the four main functions of the AI RMF?)* | Hindi answer (Devanagari script) naming GOVERN/MAP/MEASURE/MANAGE with page citations. Demonstrates cross-language retrieval (Hindi query → English chunks → Hindi answer). |
| 2 | "क्या इस दस्तावेज़ में क्रिकेट का उल्लेख है?" *(Does this document mention cricket?)* | Hindi refusal — cricket is not in scope. Should explain in Hindi what the document does cover. |

---

## Automated tests

`tests/test_agent.py` runs three end-to-end tests against the real Groq LLM:

1. `test_in_scope_returns_citations` — asks about the AI RMF's core functions, asserts `route_taken == "answered"` and at least one citation is returned.
2. `test_out_of_scope_refuses` — asks about Bangalore weather, asserts `route_taken == "refused"` and citations list is empty.
3. `test_hindi_query_returns_hindi_answer` — asks in Hindi, asserts the response contains Devanagari characters.

Run them with:

```
cd backend
source .venv/bin/activate
pip install -e '.[test]'
pytest -v
```

Each test makes one real LLM call; total ≤ 3 calls per run, well within Groq's free-tier rate limits.
