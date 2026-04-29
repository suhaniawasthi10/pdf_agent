import logging
from pathlib import Path

import fitz
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langdetect import DetectorFactory, detect

from app.vectorstore import get_collection

DetectorFactory.seed = 0
log = logging.getLogger(__name__)


def _extract_pages(pdf_path: Path) -> list[dict]:
    pages = []
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if text:
                pages.append({"page": i, "text": text})
    return pages


def _chunk_pages(pages: list[dict]) -> list[dict]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = []
    for p in pages:
        for chunk_text in splitter.split_text(p["text"]):
            chunks.append({"page": p["page"], "text": chunk_text})
    return chunks


def _detect_language(pages: list[dict]) -> str:
    sample = " ".join(p["text"][:500] for p in pages[:5])
    try:
        return detect(sample)
    except Exception:
        return "unknown"


def ingest_pdf(pdf_id: str, pdf_path: str, status_store: dict) -> None:
    """Sync function — runs inside FastAPI BackgroundTasks."""
    try:
        log.info("ingest start pdf_id=%s", pdf_id)
        pages = _extract_pages(Path(pdf_path))
        if not pages:
            raise ValueError("no extractable text in PDF")

        chunks = _chunk_pages(pages)
        if not chunks:
            raise ValueError("chunker produced 0 chunks")

        language = _detect_language(pages)

        collection = get_collection()
        ids = [f"{pdf_id}:{i}" for i in range(len(chunks))]
        documents = [c["text"] for c in chunks]
        metadatas = [
            {"pdf_id": pdf_id, "page": c["page"], "chunk_index": i}
            for i, c in enumerate(chunks)
        ]
        collection.add(ids=ids, documents=documents, metadatas=metadatas)

        prior = status_store.get(pdf_id, {})
        status_store[pdf_id] = {
            **prior,
            "status": "ready",
            "pages": len(pages),
            "chunks": len(chunks),
            "language": language,
        }
        log.info(
            "ingest done pdf_id=%s pages=%d chunks=%d lang=%s",
            pdf_id, len(pages), len(chunks), language,
        )
    except Exception as e:
        log.exception("ingest failed pdf_id=%s", pdf_id)
        prior = status_store.get(pdf_id, {})
        status_store[pdf_id] = {**prior, "status": "failed", "error": str(e)}
