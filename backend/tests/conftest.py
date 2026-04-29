"""Session-scoped fixture that ingests the sample PDF once for all tests."""

from pathlib import Path

import pytest

from app.ingestion import ingest_pdf
from app.vectorstore import get_collection

SAMPLE_PDF_ID = "test-sample"
SAMPLE_PDF_PATH = Path(__file__).parent / "sample.pdf"


@pytest.fixture(scope="session")
def sample_pdf_id() -> str:
    collection = get_collection()
    existing = collection.get(where={"pdf_id": SAMPLE_PDF_ID})
    ids = existing.get("ids") or []
    if ids:
        collection.delete(ids=ids)

    status: dict[str, dict] = {}
    ingest_pdf(SAMPLE_PDF_ID, str(SAMPLE_PDF_PATH), status)
    assert status[SAMPLE_PDF_ID]["status"] == "ready", status[SAMPLE_PDF_ID]
    return SAMPLE_PDF_ID
